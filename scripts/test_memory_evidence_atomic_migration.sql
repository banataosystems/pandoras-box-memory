\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'create role authenticator nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'create role service_role nologin bypassrls';
  end if;
end;
$roles$;

create table public.memory_capture_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  namespace text not null,
  source text not null,
  source_ref text,
  raw_excerpt text,
  redacted_excerpt text,
  memory_type text,
  title text,
  summary text,
  importance integer,
  sensitivity text,
  confidence numeric,
  should_capture boolean,
  requires_review boolean,
  status text,
  reason text,
  people jsonb default '[]'::jsonb,
  projects jsonb default '[]'::jsonb,
  risks jsonb default '[]'::jsonb,
  tags jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,
  usefulness_score numeric,
  confidence_score numeric,
  freshness_score numeric,
  retrieval_weight numeric,
  stale_status text,
  scoring_version text,
  scored_at timestamptz
);

create unique index memory_capture_candidates_projectos_source_unique
  on public.memory_capture_candidates (
    user_id,
    namespace,
    source,
    source_ref
  )
  where source = 'projectos-post-task' and source_ref is not null;

create table public.memory_review_queue_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  namespace text not null,
  status text not null,
  candidate_type text not null,
  normalized_text text,
  evidence_snapshot jsonb default '{}'::jsonb,
  sensitivity_snapshot jsonb default '{}'::jsonb,
  namespace_snapshot jsonb default '{}'::jsonb,
  source_metadata jsonb default '{}'::jsonb,
  audit_metadata jsonb default '{}'::jsonb,
  append_only boolean,
  proposed_operation text,
  requires_review boolean,
  source_ref text,
  request_hash text,
  fingerprint text,
  persistence_execution_metadata jsonb default '{}'::jsonb
);

create unique index memory_review_queue_items_projectos_source_unique
  on public.memory_review_queue_items (
    user_id,
    namespace,
    source_ref
  )
  where candidate_type = 'projectos_outcome' and source_ref is not null;

create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  body text
);

create table public.pandora_projects (
  id uuid primary key,
  project_key text not null,
  memory_namespace text not null,
  lifecycle_status text not null
);

create table public.pandora_service_principals (
  principal_key text primary key,
  provider text not null,
  environment text not null,
  memory_user_id uuid not null,
  allowed_namespaces text[] not null,
  scopes text[] not null,
  is_active boolean not null
);

create table public.pandora_project_grants (
  principal_key text not null,
  project_id uuid not null,
  environment text not null,
  is_active boolean not null,
  can_propose boolean not null,
  revoked_at timestamptz,
  primary key (principal_key, project_id, environment)
);

insert into public.pandora_projects (
  id,
  project_key,
  memory_namespace,
  lifecycle_status
) values (
  '24c07df4-d34e-4a43-9997-d803060d6503'::uuid,
  'mcpmaster-pandoras-box',
  'real_life',
  'active'
);

insert into public.pandora_service_principals (
  principal_key,
  provider,
  environment,
  memory_user_id,
  allowed_namespaces,
  scopes,
  is_active
) values (
  'projectos-mcpmaster-production',
  'vercel_oidc',
  'production',
  '11111111-1111-4111-8111-111111111111'::uuid,
  array['real_life'],
  array[
    'memory:health',
    'memory:read',
    'memory:evidence-candidate:submit'
  ],
  true
);

insert into public.pandora_project_grants (
  principal_key,
  project_id,
  environment,
  is_active,
  can_propose,
  revoked_at
) values (
  'projectos-mcpmaster-production',
  '24c07df4-d34e-4a43-9997-d803060d6503'::uuid,
  'production',
  true,
  true,
  null
);

grant usage on schema public to anon, authenticated, authenticator, service_role;
grant select, insert, update, delete
  on public.memory_capture_candidates,
     public.memory_review_queue_items,
     public.memory_items,
     public.pandora_projects,
     public.pandora_service_principals,
     public.pandora_project_grants
  to service_role;
grant insert on public.memory_capture_candidates to authenticated;

\ir ../supabase/migrations/20260820073000_atomic_projectos_evidence_candidate_review_queue.sql

create schema test_support authorization postgres;

create or replace function test_support.insert_candidate(
  p_idempotency text,
  p_fingerprint text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_candidate_id uuid;
  v_project_id constant uuid :=
    '24c07df4-d34e-4a43-9997-d803060d6503'::uuid;
begin
  insert into public.memory_capture_candidates (
    user_id,
    namespace,
    source,
    source_ref,
    raw_excerpt,
    redacted_excerpt,
    memory_type,
    title,
    summary,
    importance,
    sensitivity,
    confidence,
    should_capture,
    requires_review,
    status,
    reason,
    people,
    projects,
    risks,
    tags,
    metadata,
    usefulness_score,
    confidence_score,
    freshness_score,
    retrieval_weight,
    stale_status,
    scoring_version,
    scored_at
  ) values (
    '11111111-1111-4111-8111-111111111111'::uuid,
    'real_life',
    'projectos-post-task',
    format('projectos-evidence:%s:%s', v_project_id, p_idempotency),
    null,
    'Atomic evidence candidate fixture summary',
    'business_fact',
    'Atomic evidence candidate fixture',
    'Atomic evidence candidate fixture summary',
    8,
    'low',
    0.95,
    true,
    true,
    'pending',
    'Review-gated isolated transaction fixture.',
    '[]'::jsonb,
    jsonb_build_array('mcpmaster-pandoras-box'),
    '[]'::jsonb,
    jsonb_build_array('projectos', 'evidence_candidate', 'tested'),
    jsonb_build_object(
      'schema_version', 1,
      'intake_kind', 'projectos_evidence_candidate_v1',
      'project_id', v_project_id::text,
      'project_key', 'mcpmaster-pandoras-box',
      'proof_stage', 'tested',
      'claim', 'Candidate and review item share one transaction.',
      'evidence_refs', jsonb_build_array(
        jsonb_build_object(
          'type', 'isolated_postgres_fixture',
          'ref', p_idempotency,
          'observed_at', '2026-08-20T08:00:00Z'
        )
      ),
      'provenance', jsonb_build_object(
        'source_type', 'isolated_postgres_fixture',
        'source_locator', 'scripts/test_memory_evidence_atomic_migration.sql',
        'observed_at', '2026-08-20T08:00:00Z'
      ),
      'idempotency_key', p_idempotency,
      'fingerprint', p_fingerprint,
      'privacy_policy', 'metadata_only_v2_fail_closed',
      'privacy_scan_version', 'evidence_privacy_v2',
      'privacy_scan_passed', true,
      'privacy_scan_scope', 'canonicalized_candidate_payload',
      'imported_raw_arguments', false,
      'imported_raw_results', false,
      'imported_raw_errors', false
    ),
    0.9,
    0.95,
    1,
    0.9,
    'active',
    'projectos-evidence-v1',
    clock_timestamp()
  )
  returning id into v_candidate_id;

  return v_candidate_id;
end;
$function$;

grant usage on schema test_support to service_role, authenticated;
grant execute on function test_support.insert_candidate(text, text)
  to service_role, authenticated;

-- Valid service-role insertion creates both rows in one transaction.
set role service_role;
select test_support.insert_candidate(
  'atomic-valid-00000001',
  repeat('a', 64)
);
reset role;

do $assert_valid$
declare
  v_candidates integer;
  v_reviews integer;
begin
  select count(*) into v_candidates
  from public.memory_capture_candidates
  where source_ref =
    'projectos-evidence:24c07df4-d34e-4a43-9997-d803060d6503:atomic-valid-00000001';

  select count(*) into v_reviews
  from public.memory_review_queue_items
  where source_ref =
    'projectos-evidence:24c07df4-d34e-4a43-9997-d803060d6503:atomic-valid-00000001'
    and status = 'pending_review'
    and candidate_type = 'projectos_outcome'
    and fingerprint = repeat('a', 64);

  if v_candidates <> 1 or v_reviews <> 1 then
    raise exception 'valid_atomic_insert_failed candidates=% reviews=%',
      v_candidates,
      v_reviews;
  end if;
end;
$assert_valid$;

-- A caller other than service_role is rejected by the trigger itself.
set role authenticated;
do $assert_role$
declare
  v_denied boolean := false;
  v_message text;
begin
  begin
    perform test_support.insert_candidate(
      'atomic-role-denied-0002',
      repeat('b', 64)
    );
  exception
    when insufficient_privilege then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'projectos_evidence_candidate_role_not_allowed' then
        raise;
      end if;
      v_denied := true;
  end;

  if not v_denied then
    raise exception 'non_service_role_was_accepted';
  end if;
end;
$assert_role$;
reset role;

-- A revoked project grant is re-checked in the insert transaction.
update public.pandora_project_grants
set revoked_at = clock_timestamp()
where principal_key = 'projectos-mcpmaster-production'
  and project_id = '24c07df4-d34e-4a43-9997-d803060d6503'::uuid
  and environment = 'production';

set role service_role;
do $assert_revoke$
declare
  v_denied boolean := false;
  v_message text;
begin
  begin
    perform test_support.insert_candidate(
      'atomic-grant-denied-0003',
      repeat('c', 64)
    );
  exception
    when insufficient_privilege then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'projectos_evidence_candidate_authority_not_allowed' then
        raise;
      end if;
      v_denied := true;
  end;

  if not v_denied then
    raise exception 'revoked_project_grant_was_accepted';
  end if;
end;
$assert_revoke$;
reset role;

update public.pandora_project_grants
set revoked_at = null
where principal_key = 'projectos-mcpmaster-production'
  and project_id = '24c07df4-d34e-4a43-9997-d803060d6503'::uuid
  and environment = 'production';

-- Review-table failure rolls the candidate insert back.
revoke insert on public.memory_review_queue_items from service_role;
set role service_role;
do $assert_review_permission$
declare
  v_denied boolean := false;
begin
  begin
    perform test_support.insert_candidate(
      'atomic-review-denied-0004',
      repeat('d', 64)
    );
  exception
    when insufficient_privilege then
      v_denied := true;
  end;

  if not v_denied then
    raise exception 'review_permission_failure_was_not_propagated';
  end if;
end;
$assert_review_permission$;
reset role;
grant insert on public.memory_review_queue_items to service_role;

do $assert_review_rollback$
begin
  if exists (
    select 1
    from public.memory_capture_candidates
    where source_ref =
      'projectos-evidence:24c07df4-d34e-4a43-9997-d803060d6503:atomic-review-denied-0004'
  ) then
    raise exception 'candidate_survived_failed_review_insert';
  end if;
end;
$assert_review_rollback$;

-- A conflicting pre-existing review item cannot be silently adopted.
insert into public.memory_review_queue_items (
  user_id,
  namespace,
  status,
  candidate_type,
  normalized_text,
  evidence_snapshot,
  audit_metadata,
  append_only,
  proposed_operation,
  requires_review,
  source_ref,
  request_hash,
  fingerprint
) values (
  '11111111-1111-4111-8111-111111111111'::uuid,
  'real_life',
  'pending_review',
  'projectos_outcome',
  'Mismatched pre-existing review',
  '{}'::jsonb,
  '{}'::jsonb,
  true,
  'append',
  true,
  'projectos-evidence:24c07df4-d34e-4a43-9997-d803060d6503:atomic-conflict-00005',
  repeat('f', 64),
  repeat('f', 64)
);

set role service_role;
do $assert_conflict$
declare
  v_rejected boolean := false;
  v_message text;
begin
  begin
    perform test_support.insert_candidate(
      'atomic-conflict-00005',
      repeat('e', 64)
    );
  exception
    when raise_exception then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'projectos_evidence_review_atomic_insert_failed' then
        raise;
      end if;
      v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'mismatched_review_was_silently_adopted';
  end if;
end;
$assert_conflict$;
reset role;

do $assert_conflict_rollback$
begin
  if exists (
    select 1
    from public.memory_capture_candidates
    where source_ref =
      'projectos-evidence:24c07df4-d34e-4a43-9997-d803060d6503:atomic-conflict-00005'
  ) then
    raise exception 'candidate_survived_review_postcondition_failure';
  end if;
end;
$assert_conflict_rollback$;

-- Candidate intake never writes canonical Memory.
do $assert_no_canon$
begin
  if exists (select 1 from public.memory_items) then
    raise exception 'atomic_intake_wrote_canonical_memory';
  end if;
end;
$assert_no_canon$;

-- Exercise the documented rollback in the isolated database.
drop trigger memory_projectos_evidence_candidate_review_atomic
  on public.memory_capture_candidates;
drop function public.memory_enqueue_projectos_evidence_review();

do $assert_rollback$
begin
  if to_regprocedure(
    'public.memory_enqueue_projectos_evidence_review()'
  ) is not null then
    raise exception 'atomic_trigger_function_rollback_failed';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
      'public.memory_capture_candidates'::regclass
      and trigger_row.tgname =
        'memory_projectos_evidence_candidate_review_atomic'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'atomic_trigger_rollback_failed';
  end if;
end;
$assert_rollback$;

select 'Atomic ProjectOS evidence migration behavior: PASS' as result;
