#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=postgres}"
export PGHOST PGPORT PGUSER PGDATABASE

command -v psql >/dev/null 2>&1 || {
  echo "psql is required for the atomic RPC integration test" >&2
  exit 1
}

if [[ "${MEMORY_ATOMIC_TEST_ALLOW_DISPOSABLE_DATABASE:-}" != "1" ]]; then
  echo "atomic RPC integration test requires explicit disposable-database authorization" >&2
  exit 1
fi

task_tmp="$(mktemp -d)"
control_database="$PGDATABASE"
test_database="memory_evidence_atomic_rpc_test_$$"
test_database_created=0
cleanup() {
  if [[ "$test_database_created" = "1" ]]; then
    PGDATABASE="$control_database" psql -X -v ON_ERROR_STOP=1 -Atq \
      -c "drop database if exists \"$test_database\" with (force);" \
      >/dev/null 2>&1 || true
  fi
  rm -rf -- "$task_tmp"
}
trap cleanup EXIT

if [[ "$PGHOST" != "127.0.0.1" ]]; then
  echo "atomic RPC integration test requires the exact numeric IPv4 loopback host" >&2
  exit 1
fi
if [[ "$control_database" != "postgres" ]]; then
  echo "atomic RPC integration test control database must be exactly postgres" >&2
  exit 1
fi
if [[ ! "$test_database" =~ ^memory_evidence_atomic_rpc_test_[0-9]+$ ]]; then
  echo "atomic RPC integration test database name is unsafe" >&2
  exit 1
fi

control_identity="$(PGDATABASE="$control_database" psql -X -v ON_ERROR_STOP=1 -Atq \
  -c 'select current_database();')"
if [[ "$control_identity" != "postgres" ]]; then
  echo "atomic RPC integration test control connection is not the explicit postgres database" >&2
  exit 1
fi

PGDATABASE="$control_database" psql -X -v ON_ERROR_STOP=1 -Atq \
  -c "create database \"$test_database\";"
test_database_created=1
PGDATABASE="$test_database"
export PGDATABASE

connected_database="$(psql -X -v ON_ERROR_STOP=1 -Atq -c 'select current_database();')"
if [[ "$connected_database" != "$test_database" ]]; then
  echo "atomic RPC integration test did not connect to its unique disposable database" >&2
  exit 1
fi

schema_fixture="scripts/fixtures/memory_evidence_atomic_rpc_schema.sql"
authorization_fixture="scripts/fixtures/memory_evidence_atomic_rpc_authorization.sql"
assertions_fixture="scripts/fixtures/memory_evidence_atomic_rpc_assertions.sql"
legacy_migration="supabase/migrations/20260820113000_enable_projectos_evidence_candidate_write_scope.sql"
atomic_migration="supabase/migrations/20260821160000_submit_projectos_evidence_candidate_atomic.sql"
forward_migration="supabase/migrations/20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope.sql"
rollback_sql="supabase/recovery/20260821_disable_projectos_evidence_candidate_write_scope_forward_recovery.sql"

psql -X -v ON_ERROR_STOP=1 -f "$schema_fixture"

# A database that still has the historical write scope must be rolled back
# before the atomic boundary can be installed; otherwise the RPC would become
# callable before exact successor authorization.
psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
alter table public.pandora_service_principals
  drop constraint pandora_service_principals_scopes_check;
alter table public.pandora_service_principals
  add constraint pandora_service_principals_scopes_check
  check (scopes <@ array['memory:health', 'memory:read', 'memory:write']::text[]);
update public.pandora_service_principals
set scopes = array['memory:health', 'memory:read', 'memory:write']::text[]
where principal_key = 'projectos-mcpmaster-production';
SQL

if psql -X -v ON_ERROR_STOP=1 -f "$atomic_migration" \
  >"$task_tmp/active-window.out" 2>"$task_tmp/active-window.err"; then
  echo "atomic migration unexpectedly installed while write was active" >&2
  exit 1
fi
grep -q "exact read-only principal drift" "$task_tmp/active-window.err"
psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
update public.pandora_service_principals
set scopes = array['memory:health', 'memory:read']::text[]
where principal_key = 'projectos-mcpmaster-production';
alter table public.pandora_service_principals
  drop constraint pandora_service_principals_scopes_check;
alter table public.pandora_service_principals
  add constraint pandora_service_principals_scopes_check
  check (scopes <@ array['memory:health', 'memory:read']::text[]);
SQL

# Zero-to-head checkpoint 1: the historical migration remains universally
# read-only and records no activation audit.
psql -X -v ON_ERROR_STOP=1 -f "$legacy_migration"
psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
insert into supabase_migrations.schema_migrations (version, name)
values (
  '20260820113000',
  'enable_projectos_evidence_candidate_write_scope'
);

do $legacy_read_only_checkpoint$
begin
  if exists (
    select 1
    from public.pandora_service_principals
    where 'memory:write' = any(scopes)
  ) then
    raise exception 'legacy migration granted write before atomic protections';
  end if;
  if to_regprocedure(
    'public.submit_projectos_evidence_candidate_atomic(text,uuid,text,text,uuid,text,text,text,text,text,jsonb,jsonb,text)'
  ) is not null then
    raise exception 'atomic RPC unexpectedly existed at legacy checkpoint';
  end if;
  if exists (
    select 1
    from public.audit_logs
    where action like 'projectos_evidence_candidate_write_scope_%'
  ) then
    raise exception 'legacy migration emitted an activation audit';
  end if;
end;
$legacy_read_only_checkpoint$;

create function public.submit_projectos_evidence_candidate_atomic(
  text, uuid, text, text, uuid, text, text, text, text, text, jsonb, jsonb, text
)
returns jsonb
language sql
as $function$
  select '{}'::jsonb;
$function$;
alter function public.submit_projectos_evidence_candidate_atomic(
  text, uuid, text, text, uuid, text, text, text, text, text, jsonb, jsonb, text
) owner to service_role;
grant execute on function public.submit_projectos_evidence_candidate_atomic(
  text, uuid, text, text, uuid, text, text, text, text, text, jsonb, jsonb, text
) to untrusted_rpc_role with grant option;
SQL

# Same-name wrong-key and wrong-predicate indexes must both fail closed.
psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
create unique index audit_logs_projectos_evidence_candidate_atomic_unique
  on public.audit_logs (user_id)
  where action = 'projectos_evidence_candidate_atomic_created'
    and table_name = 'memory_capture_candidates';
SQL

if psql -X -v ON_ERROR_STOP=1 -f "$atomic_migration" \
  >"$task_tmp/wrong-key-index.out" 2>"$task_tmp/wrong-key-index.err"; then
  echo "wrong-key atomic audit index unexpectedly passed migration guard" >&2
  exit 1
fi
grep -q "projectos evidence atomic audit index drift" \
  "$task_tmp/wrong-key-index.err"
psql -X -v ON_ERROR_STOP=1 -Atq \
  -c "drop index public.audit_logs_projectos_evidence_candidate_atomic_unique;"

psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
create unique index audit_logs_projectos_evidence_candidate_atomic_unique
  on public.audit_logs (record_id);
SQL

if psql -X -v ON_ERROR_STOP=1 -f "$atomic_migration" \
  >"$task_tmp/wrong-predicate-index.out" 2>"$task_tmp/wrong-predicate-index.err"; then
  echo "wrong-predicate atomic audit index unexpectedly passed migration guard" >&2
  exit 1
fi
grep -q "projectos evidence atomic audit index drift" \
  "$task_tmp/wrong-predicate-index.err"
psql -X -v ON_ERROR_STOP=1 -Atq \
  -c "drop index public.audit_logs_projectos_evidence_candidate_atomic_unique;"

psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
create function public.test_unexpected_candidate_trigger()
returns trigger
language plpgsql
as $function$
begin
  return new;
end;
$function$;
create trigger aaa_unexpected_candidate_trigger
before insert on public.memory_capture_candidates
for each row execute function public.test_unexpected_candidate_trigger();
SQL

if psql -X -v ON_ERROR_STOP=1 -f "$atomic_migration" \
  >"$task_tmp/unexpected-trigger.out" 2>"$task_tmp/unexpected-trigger.err"; then
  echo "unexpected preexisting trigger passed atomic migration guard" >&2
  exit 1
fi
grep -q "unexpected preexisting trigger requires reconciliation" \
  "$task_tmp/unexpected-trigger.err"
psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
drop trigger aaa_unexpected_candidate_trigger
  on public.memory_capture_candidates;
drop function public.test_unexpected_candidate_trigger();
SQL

# A forged row claiming this successor activation is not grandfathered as
# historical predecessor evidence.
psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
insert into public.audit_logs (
  user_id, namespace, action, table_name, record_id, metadata
) values (
  '11111111-1111-4111-8111-111111111111',
  'real_life',
  'projectos_evidence_candidate_write_scope_activated',
  'pandora_service_principals',
  (select id from public.pandora_service_principals
   where principal_key = 'projectos-mcpmaster-production'),
  jsonb_build_object(
    'activation_id',
    'memory-evidence-atomic-successor-prod-activation-20260821'
  )
);
SQL

if psql -X -v ON_ERROR_STOP=1 -f "$atomic_migration" \
  >"$task_tmp/successor-audit-preseed.out" 2>"$task_tmp/successor-audit-preseed.err"; then
  echo "successor activation audit preseed passed atomic migration guard" >&2
  exit 1
fi
grep -q "atomic reserved preseed requires reconciliation" \
  "$task_tmp/successor-audit-preseed.err"
psql -X -v ON_ERROR_STOP=1 -Atq \
  -c "delete from public.audit_logs where metadata ->> 'activation_id' = 'memory-evidence-atomic-successor-prod-activation-20260821';"

# Zero-to-head checkpoint 2: atomic DB protections exist, the low-role stub
# owner has been repaired, and write is still unavailable.
psql -X -v ON_ERROR_STOP=1 -f "$atomic_migration"
psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
insert into supabase_migrations.schema_migrations (version, name)
values ('20260821160000', 'submit_projectos_evidence_candidate_atomic');

do $atomic_read_only_checkpoint$
declare
  v_owner name;
  v_reserved_trigger_count integer;
begin
  select pg_get_userbyid(p.proowner)
    into v_owner
  from pg_catalog.pg_proc p
  where p.oid = to_regprocedure(
    'public.submit_projectos_evidence_candidate_atomic(text,uuid,text,text,uuid,text,text,text,text,text,jsonb,jsonb,text)'
  );
  if v_owner is distinct from current_user
     or v_owner::text in ('anon', 'authenticated', 'service_role') then
    raise exception 'atomic RPC low-role owner was not repaired';
  end if;
  if has_function_privilege(
    'untrusted_rpc_role',
    'public.submit_projectos_evidence_candidate_atomic(text,uuid,text,text,uuid,text,text,text,text,text,jsonb,jsonb,text)',
    'execute'
  ) then
    raise exception 'atomic RPC stale custom execute grant was not removed';
  end if;
  if exists (
    select 1
    from public.pandora_service_principals
    where 'memory:write' = any(scopes)
  ) then
    raise exception 'atomic migration granted write before authorization';
  end if;
  select count(*)::integer
    into v_reserved_trigger_count
  from pg_catalog.pg_trigger t
  where t.tgfoid = 'public.protect_projectos_evidence_reserved_rows()'::regprocedure
    and t.tgtype = 31
    and not t.tgisinternal
    and t.tgenabled = 'O';
  if v_reserved_trigger_count <> 3 then
    raise exception 'atomic reserved-row triggers missing';
  end if;
end;
$atomic_read_only_checkpoint$;
SQL

# Test-only exact authorization is inserted by the database owner after the
# exact atomic boundary, matching the governed production ordering.
psql -X -v ON_ERROR_STOP=1 -f "$authorization_fixture"
psql -X -v ON_ERROR_STOP=1 -f "$forward_migration"
psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
insert into supabase_migrations.schema_migrations (version, name)
values (
  '20260821163000',
  'forward_reactivate_projectos_evidence_candidate_write_scope'
);

do $sole_truthful_activation_checkpoint$
begin
  if (
    select count(*)
    from public.pandora_service_principals
    where principal_key = 'projectos-mcpmaster-production'
      and scopes = array['memory:health', 'memory:read', 'memory:write']::text[]
  ) <> 1 then
    raise exception 'forward migration did not perform exact write activation';
  end if;
  if exists (
    select 1
    from public.audit_logs
    where action = 'projectos_evidence_candidate_write_scope_source_replay_activated'
  ) then
    raise exception 'source replay activation audit must not exist';
  end if;
  if (
    select count(*)
    from public.audit_logs
    where action = 'projectos_evidence_candidate_write_scope_activated'
      and table_name = 'pandora_service_principals'
      and before_snapshot = jsonb_build_object(
        'scopes', to_jsonb(array['memory:health', 'memory:read']::text[])
      )
      and after_snapshot = jsonb_build_object(
        'scopes', to_jsonb(array['memory:health', 'memory:read', 'memory:write']::text[])
      )
      and before_snapshot <> after_snapshot
      and metadata ->> 'transition' = 'read_to_write'
      and metadata ->> 'activation_id' =
        'memory-evidence-atomic-successor-prod-activation-20260821'
  ) <> 1 then
    raise exception 'sole truthful activation audit missing';
  end if;
end;
$sole_truthful_activation_checkpoint$;
SQL

psql -X -v ON_ERROR_STOP=1 -f "$assertions_fixture"

for worker in 1 2 3 4 5 6 7 8; do
  psql -X -v ON_ERROR_STOP=1 -Atq \
    -c "select public.test_submit_projectos_evidence('atomic-concurrent-0001', 'Concurrent identical source candidate.') ->> 'outcome';" \
    >"$task_tmp/concurrent-$worker.out" &
done
wait

created_count="$(awk '$0 == "created" { count++ } END { print count + 0 }' "$task_tmp"/concurrent-*.out)"
deduplicated_count="$(awk '$0 == "deduplicated" { count++ } END { print count + 0 }' "$task_tmp"/concurrent-*.out)"
test "$created_count" = "1"
test "$deduplicated_count" = "7"

psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
do $concurrency_assertions$
begin
  if (
    select count(*)
    from public.memory_capture_candidates
    where source_ref like '%atomic-concurrent-0001'
  ) <> 1
    or (
      select count(*)
      from public.memory_review_queue_items
      where source_ref like '%atomic-concurrent-0001'
    ) <> 1
    or (
      select count(*)
      from public.audit_logs
      where metadata ->> 'idempotency_key' = 'atomic-concurrent-0001'
    ) <> 1 then
    raise exception 'concurrent replay did not converge on one atomic lifecycle unit';
  end if;
end;
$concurrency_assertions$;
SQL

psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
create trigger test_fail_atomic_review_insert
before insert on public.memory_review_queue_items
for each row execute function public.test_fail_atomic_review_insert();
SQL

if psql -X -v ON_ERROR_STOP=1 -Atq \
  -c "select public.test_submit_projectos_evidence('atomic-fail-review-0001', 'Review failure injection.');" \
  >"$task_tmp/review-failure.out" 2>"$task_tmp/review-failure.err"; then
  echo "review failure injection unexpectedly succeeded" >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
drop trigger test_fail_atomic_review_insert on public.memory_review_queue_items;
do $review_failure_assertions$
begin
  if exists (
    select 1 from public.memory_capture_candidates
    where source_ref like '%atomic-fail-review-0001'
  ) or exists (
    select 1 from public.memory_review_queue_items
    where source_ref like '%atomic-fail-review-0001'
  ) or exists (
    select 1 from public.audit_logs
    where metadata ->> 'idempotency_key' = 'atomic-fail-review-0001'
  ) then
    raise exception 'review failure left partial state';
  end if;
end;
$review_failure_assertions$;
SQL

test "$(psql -X -v ON_ERROR_STOP=1 -Atq \
  -c "select public.test_submit_projectos_evidence('atomic-fail-review-0001', 'Review failure injection.') ->> 'outcome';")" = "created"

psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
create trigger test_fail_atomic_audit_insert
before insert on public.audit_logs
for each row execute function public.test_fail_atomic_audit_insert();
SQL

if psql -X -v ON_ERROR_STOP=1 -Atq \
  -c "select public.test_submit_projectos_evidence('atomic-fail-audit-0001', 'Audit failure injection.');" \
  >"$task_tmp/audit-failure.out" 2>"$task_tmp/audit-failure.err"; then
  echo "audit failure injection unexpectedly succeeded" >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
drop trigger test_fail_atomic_audit_insert on public.audit_logs;
do $audit_failure_assertions$
begin
  if exists (
    select 1 from public.memory_capture_candidates
    where source_ref like '%atomic-fail-audit-0001'
  ) or exists (
    select 1 from public.memory_review_queue_items
    where source_ref like '%atomic-fail-audit-0001'
  ) or exists (
    select 1 from public.audit_logs
    where metadata ->> 'idempotency_key' = 'atomic-fail-audit-0001'
  ) then
    raise exception 'audit failure left partial state';
  end if;
end;
$audit_failure_assertions$;
SQL

test "$(psql -X -v ON_ERROR_STOP=1 -Atq \
  -c "select public.test_submit_projectos_evidence('atomic-fail-audit-0001', 'Audit failure injection.') ->> 'outcome';")" = "created"

# Rollback is tested after all write-path behavior so its scope reduction is
# observable and its audit immutability can be probed under service_role.
psql -X -v ON_ERROR_STOP=1 -f "$rollback_sql"
psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
do $rollback_readback$
begin
  if exists (
    select 1
    from public.pandora_service_principals
    where 'memory:write' = any(scopes)
  ) then
    raise exception 'rollback left memory:write active';
  end if;
  if (
    select count(*)
    from public.audit_logs
    where action = 'projectos_evidence_candidate_write_scope_deactivated'
      and metadata ->> 'rollback_id' =
        'memory-evidence-atomic-successor-prod-rollback-20260821'
      and before_snapshot <> after_snapshot
  ) <> 1 then
    raise exception 'truthful rollback audit missing';
  end if;
end;
$rollback_readback$;

set role service_role;
do $rollback_audit_immutability$
declare
  v_action text;
begin
  foreach v_action in array array[
    'projectos_evidence_candidate_write_scope_activated',
    'projectos_evidence_candidate_write_scope_deactivated'
  ]::text[] loop
    begin
      update public.audit_logs
      set metadata = metadata || jsonb_build_object('mutated_after_rollback', true)
      where action = v_action
        and metadata ->> 'activation_id' =
          'memory-evidence-atomic-successor-prod-activation-20260821';
      raise exception 'service_role immutable rollback audit update succeeded: %', v_action;
    exception when sqlstate '55000' then null;
    end;

    begin
      delete from public.audit_logs
      where action = v_action
        and metadata ->> 'activation_id' =
          'memory-evidence-atomic-successor-prod-activation-20260821';
      raise exception 'service_role immutable rollback audit delete succeeded: %', v_action;
    exception when sqlstate '55000' then null;
    end;
  end loop;
end;
$rollback_audit_immutability$;
reset role;
SQL

if psql -X -v ON_ERROR_STOP=1 -Atq \
  -c "select public.test_submit_projectos_evidence('atomic-after-rollback-0001', 'Rollback must remove write authorization.');" \
  >"$task_tmp/after-rollback.out" 2>"$task_tmp/after-rollback.err"; then
  echo "atomic RPC unexpectedly wrote after rollback" >&2
  exit 1
fi
grep -q "projectos evidence atomic principal is not authorized" \
  "$task_tmp/after-rollback.err"

# Hosted-ledger compatibility: predecessor activation/deactivation audits are
# preserved as untrusted history but never consulted as successor authorization,
# deduplication, or activation evidence. The new activation and rollback remain
# distinct and truthful, and the atomic migration makes all such rows immutable
# prospectively.
psql -X -v ON_ERROR_STOP=1 -f "$schema_fixture"
psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
insert into supabase_migrations.schema_migrations (version, name)
values (
  '20260820150902',
  '20260820113000_enable_projectos_evidence_candidate_write_scope'
);

insert into public.audit_logs (
  user_id, namespace, action, table_name, record_id,
  before_snapshot, after_snapshot, metadata
) values
(
  '11111111-1111-4111-8111-111111111111',
  'real_life',
  'projectos_evidence_candidate_write_scope_activated',
  'pandora_service_principals',
  (select id from public.pandora_service_principals where principal_key = 'projectos-mcpmaster-production'),
  jsonb_build_object('scopes', to_jsonb(array['memory:health', 'memory:read']::text[])),
  jsonb_build_object('scopes', to_jsonb(array['memory:health', 'memory:read', 'memory:write']::text[])),
  jsonb_build_object('activation_id', 'predecessor-untrusted-activation')
),
(
  '11111111-1111-4111-8111-111111111111',
  'real_life',
  'projectos_evidence_candidate_write_scope_deactivated',
  'pandora_service_principals',
  (select id from public.pandora_service_principals where principal_key = 'projectos-mcpmaster-production'),
  jsonb_build_object('scopes', to_jsonb(array['memory:health', 'memory:read', 'memory:write']::text[])),
  jsonb_build_object('scopes', to_jsonb(array['memory:health', 'memory:read']::text[])),
  jsonb_build_object('activation_id', 'predecessor-untrusted-activation')
);
SQL

psql -X -v ON_ERROR_STOP=1 -f "$atomic_migration"
psql -X -v ON_ERROR_STOP=1 -Atq \
  -c "insert into supabase_migrations.schema_migrations (version, name) values ('20260821160000', 'submit_projectos_evidence_candidate_atomic');"
psql -X -v ON_ERROR_STOP=1 -f "$authorization_fixture"
psql -X -v ON_ERROR_STOP=1 -f "$forward_migration"
psql -X -v ON_ERROR_STOP=1 -f "$rollback_sql"
psql -X -v ON_ERROR_STOP=1 -Atq <<'SQL'
do $hosted_history_compatibility_assertions$
begin
  if (
    select count(*)
    from public.audit_logs
    where metadata ->> 'activation_id' = 'predecessor-untrusted-activation'
  ) <> 2 then
    raise exception 'predecessor hosted audit history was not preserved';
  end if;
  if (
    select count(*)
    from public.audit_logs
    where metadata ->> 'activation_id' =
      'memory-evidence-atomic-successor-prod-activation-20260821'
      and action in (
        'projectos_evidence_candidate_write_scope_activated',
        'projectos_evidence_candidate_write_scope_deactivated'
      )
      and before_snapshot <> after_snapshot
  ) <> 2 then
    raise exception 'successor hosted activation/rollback evidence mismatch';
  end if;
  if exists (
    select 1
    from public.pandora_service_principals
    where 'memory:write' = any(scopes)
  ) then
    raise exception 'hosted compatibility rollback left write active';
  end if;
end;
$hosted_history_compatibility_assertions$;
SQL

echo "Governed Memory atomic evidence RPC integration tests: PASS"
