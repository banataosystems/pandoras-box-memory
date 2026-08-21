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

psql -X -v ON_ERROR_STOP=1 \
  -f scripts/fixtures/memory_evidence_atomic_rpc_schema.sql
psql -X -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260821160000_submit_projectos_evidence_candidate_atomic.sql
psql -X -v ON_ERROR_STOP=1 \
  -f scripts/fixtures/memory_evidence_atomic_rpc_assertions.sql

task_tmp="$(mktemp -d)"
cleanup() {
  rm -rf -- "$task_tmp"
}
trap cleanup EXIT

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
    ) <> 1
  then
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

echo "Governed Memory atomic evidence RPC integration tests: PASS"
