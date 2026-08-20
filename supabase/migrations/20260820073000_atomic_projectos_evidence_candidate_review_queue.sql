begin;

-- A ProjectOS evidence submission is one governed unit: the immutable capture
-- candidate and its pending-review queue item. The trigger below keeps those
-- writes in the same PostgreSQL transaction. It never writes canonical Memory.
do $preflight$
declare
  v_candidate_index regclass := to_regclass(
    'public.memory_capture_candidates_projectos_source_unique'
  );
  v_review_index regclass := to_regclass(
    'public.memory_review_queue_items_projectos_source_unique'
  );
  v_candidate_definition text;
  v_review_definition text;
begin
  if v_candidate_index is null then
    raise exception 'projectos_candidate_unique_index_missing';
  end if;
  if v_review_index is null then
    raise exception 'projectos_review_unique_index_missing';
  end if;

  select regexp_replace(pg_get_indexdef(v_candidate_index), '\s+', ' ', 'g')
  into v_candidate_definition;
  select regexp_replace(pg_get_indexdef(v_review_index), '\s+', ' ', 'g')
  into v_review_definition;

  if v_candidate_definition is distinct from
    'CREATE UNIQUE INDEX memory_capture_candidates_projectos_source_unique ON public.memory_capture_candidates USING btree (user_id, namespace, source, source_ref) WHERE ((source = ''projectos-post-task''::text) AND (source_ref IS NOT NULL))'
  then
    raise exception 'projectos_candidate_unique_index_drift';
  end if;

  if v_review_definition is distinct from
    'CREATE UNIQUE INDEX memory_review_queue_items_projectos_source_unique ON public.memory_review_queue_items USING btree (user_id, namespace, source_ref) WHERE ((candidate_type = ''projectos_outcome''::text) AND (source_ref IS NOT NULL))'
  then
    raise exception 'projectos_review_unique_index_drift';
  end if;
end;
$preflight$;

create or replace function public.memory_enqueue_projectos_evidence_review()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_metadata jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_intake_kind text := v_metadata ->> 'intake_kind';
  v_project_id text := v_metadata ->> 'project_id';
  v_project_key text := v_metadata ->> 'project_key';
  v_proof_stage text := v_metadata ->> 'proof_stage';
  v_claim text := v_metadata ->> 'claim';
  v_idempotency_key text := v_metadata ->> 'idempotency_key';
  v_fingerprint text := v_metadata ->> 'fingerprint';
  v_privacy_policy text := v_metadata ->> 'privacy_policy';
  v_expected_source_ref text;
begin
  -- The runtime bridge uses the service_role PostgREST role. Any direct user
  -- attempt to impersonate the ProjectOS source fails before review insertion.
  if current_user is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'projectos_evidence_candidate_role_not_allowed';
  end if;

  -- This trigger is deliberately scoped to the reviewed v1 evidence envelope.
  if new.source is distinct from 'projectos-post-task'
    or v_intake_kind is distinct from 'projectos_evidence_candidate_v1'
  then
    return new;
  end if;

  if new.user_id is null
    or new.namespace not in ('real_life', 'au')
    or new.source_ref is null
    or new.title is null
    or new.summary is null
    or length(new.title) < 1
    or length(new.title) > 200
    or length(new.summary) < 1
    or length(new.summary) > 1800
  then
    raise exception 'projectos_evidence_candidate_shape_invalid';
  end if;

  if new.raw_excerpt is not null
    or new.redacted_excerpt is distinct from new.summary
    or new.memory_type is distinct from 'business_fact'
    or new.status is distinct from 'pending'
    or new.requires_review is distinct from true
    or new.should_capture is distinct from true
    or new.sensitivity is distinct from 'low'
    or new.importance is distinct from 8
    or new.confidence is distinct from 0.95::numeric
    or new.usefulness_score is distinct from 0.9::numeric
    or new.confidence_score is distinct from 0.95::numeric
    or new.freshness_score is distinct from 1::numeric
    or new.retrieval_weight is distinct from 0.9::numeric
    or new.stale_status is distinct from 'active'
    or new.scoring_version is distinct from 'projectos-evidence-v1'
  then
    raise exception 'projectos_evidence_candidate_policy_invalid';
  end if;

  if v_project_id is null
    or v_project_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or v_project_key is null
    or v_project_key !~ '^[a-z0-9][a-z0-9._-]{1,95}$'
    or v_proof_stage not in (
      'documented',
      'implemented',
      'tested',
      'deployed',
      'production_verified'
    )
    or v_claim is null
    or length(v_claim) < 1
    or length(v_claim) > 1000
    or v_idempotency_key is null
    or v_idempotency_key !~ '^[A-Za-z0-9._:-]{16,160}$'
    or v_fingerprint is null
    or v_fingerprint !~ '^[a-f0-9]{64}$'
  then
    raise exception 'projectos_evidence_candidate_metadata_invalid';
  end if;

  if jsonb_typeof(v_metadata -> 'evidence_refs') is distinct from 'array'
    or jsonb_typeof(v_metadata -> 'provenance') is distinct from 'object'
  then
    raise exception 'projectos_evidence_candidate_evidence_invalid';
  end if;
  if jsonb_array_length(v_metadata -> 'evidence_refs') < 1
    or jsonb_array_length(v_metadata -> 'evidence_refs') > 20
  then
    raise exception 'projectos_evidence_candidate_evidence_invalid';
  end if;

  if v_privacy_policy is distinct from 'metadata_only_v2_fail_closed'
    or v_metadata ->> 'privacy_scan_version' is distinct from 'evidence_privacy_v2'
    or v_metadata ->> 'privacy_scan_scope' is distinct from 'canonicalized_candidate_payload'
    or v_metadata -> 'privacy_scan_passed' is distinct from 'true'::jsonb
    or v_metadata -> 'imported_raw_arguments' is distinct from 'false'::jsonb
    or v_metadata -> 'imported_raw_results' is distinct from 'false'::jsonb
    or v_metadata -> 'imported_raw_errors' is distinct from 'false'::jsonb
  then
    raise exception 'projectos_evidence_candidate_privacy_invalid';
  end if;

  if jsonb_typeof(new.people) is distinct from 'array'
    or new.people <> '[]'::jsonb
    or jsonb_typeof(new.risks) is distinct from 'array'
    or new.risks <> '[]'::jsonb
    or jsonb_typeof(new.projects) is distinct from 'array'
    or not new.projects @> jsonb_build_array(v_project_key)
    or jsonb_typeof(new.tags) is distinct from 'array'
    or not new.tags @> jsonb_build_array('projectos')
    or not new.tags @> jsonb_build_array('evidence_candidate')
    or not new.tags @> jsonb_build_array(v_proof_stage)
  then
    raise exception 'projectos_evidence_candidate_project_binding_invalid';
  end if;

  v_expected_source_ref := format(
    'projectos-evidence:%s:%s',
    v_project_id,
    v_idempotency_key
  );
  if new.source_ref is distinct from v_expected_source_ref then
    raise exception 'projectos_evidence_candidate_source_ref_invalid';
  end if;

  -- Re-check current runtime authority inside the insert transaction. This
  -- closes a revoke/grant race between the Edge lookup and persistence.
  if not exists (
    select 1
    from public.pandora_projects project
    join public.pandora_service_principals principal
      on principal.principal_key = 'projectos-mcpmaster-production'
    join public.pandora_project_grants project_grant
      on project_grant.principal_key = principal.principal_key
      and project_grant.project_id = project.id
      and project_grant.environment = principal.environment
    where project.id = v_project_id::uuid
      and project.project_key = v_project_key
      and project.memory_namespace = new.namespace
      and project.lifecycle_status = 'active'
      and principal.provider = 'vercel_oidc'
      and principal.is_active = true
      and principal.memory_user_id = new.user_id
      and new.namespace = any(principal.allowed_namespaces)
      and 'memory:evidence-candidate:submit' = any(principal.scopes)
      and project_grant.is_active = true
      and project_grant.can_propose = true
      and project_grant.revoked_at is null
  ) then
    raise exception using
      errcode = '42501',
      message = 'projectos_evidence_candidate_authority_not_allowed';
  end if;

  -- AFTER INSERT trigger work belongs to the candidate transaction. Any error
  -- below rolls the candidate insert back, eliminating the no-retry orphan gap.
  insert into public.memory_review_queue_items (
    user_id,
    namespace,
    status,
    candidate_type,
    normalized_text,
    evidence_snapshot,
    sensitivity_snapshot,
    namespace_snapshot,
    source_metadata,
    audit_metadata,
    append_only,
    proposed_operation,
    requires_review,
    source_ref,
    request_hash,
    fingerprint,
    persistence_execution_metadata
  ) values (
    new.user_id,
    new.namespace,
    'pending_review',
    'projectos_outcome',
    new.summary,
    jsonb_build_object(
      'hasEvidence', true,
      'intakeKind', 'projectos_evidence_candidate_v1',
      'sourceRef', new.source_ref,
      'proofStage', v_proof_stage,
      'claim', v_claim,
      'evidenceRefs', v_metadata -> 'evidence_refs',
      'provenance', v_metadata -> 'provenance',
      'candidateId', new.id
    ),
    jsonb_build_object(
      'classification', 'low',
      'containsSecrets', false,
      'containsPersonalData', false,
      'containsRawArguments', false,
      'containsRawResults', false,
      'containsRawErrors', false
    ),
    jsonb_build_object(
      'sourceNamespace', new.namespace,
      'targetNamespace', new.namespace,
      'namespaceMatch', true
    ),
    jsonb_build_object(
      'source', 'projectos-post-task',
      'sourceKind', 'projectos_evidence',
      'sourceRef', new.source_ref,
      'projectId', v_project_id,
      'projectKey', v_project_key,
      'proofStage', v_proof_stage
    ),
    jsonb_build_object(
      'schemaVersion', 1,
      'candidateId', new.id,
      'appendOnly', true,
      'reviewRequired', true,
      'idempotencyKey', v_idempotency_key,
      'fingerprint', v_fingerprint
    ),
    true,
    'append',
    true,
    new.source_ref,
    v_fingerprint,
    v_fingerprint,
    '{}'::jsonb
  )
  on conflict do nothing;

  if not exists (
    select 1
    from public.memory_review_queue_items review
    where review.user_id = new.user_id
      and review.namespace = new.namespace
      and review.status = 'pending_review'
      and review.candidate_type = 'projectos_outcome'
      and review.source_ref = new.source_ref
      and review.normalized_text = new.summary
      and review.fingerprint = v_fingerprint
      and review.request_hash = v_fingerprint
      and review.evidence_snapshot ->> 'candidateId' = new.id::text
      and review.audit_metadata ->> 'candidateId' = new.id::text
      and review.append_only = true
      and review.proposed_operation = 'append'
      and review.requires_review = true
  ) then
    raise exception 'projectos_evidence_review_atomic_insert_failed';
  end if;

  return new;
end;
$function$;

revoke all on function public.memory_enqueue_projectos_evidence_review()
  from public;
revoke all on function public.memory_enqueue_projectos_evidence_review()
  from anon, authenticated, authenticator;
grant execute on function public.memory_enqueue_projectos_evidence_review()
  to service_role;

drop trigger if exists memory_projectos_evidence_candidate_review_atomic
  on public.memory_capture_candidates;
create trigger memory_projectos_evidence_candidate_review_atomic
after insert on public.memory_capture_candidates
for each row
when (
  new.source = 'projectos-post-task'
  and new.metadata ->> 'intake_kind' = 'projectos_evidence_candidate_v1'
)
execute function public.memory_enqueue_projectos_evidence_review();

comment on function public.memory_enqueue_projectos_evidence_review() is
  'Atomically creates the pending-review row for a validated ProjectOS evidence candidate. It never writes canonical Memory. Rollback: DROP TRIGGER memory_projectos_evidence_candidate_review_atomic ON public.memory_capture_candidates; DROP FUNCTION public.memory_enqueue_projectos_evidence_review();';

do $verify$
declare
  v_search_path text[];
  v_security_definer boolean;
  v_trigger_enabled "char";
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class table_row
      on table_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relname = 'memory_capture_candidates'
      and trigger_row.tgname = 'memory_projectos_evidence_candidate_review_atomic'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'projectos_evidence_atomic_trigger_verification_failed';
  end if;

  select function_row.proconfig, function_row.prosecdef
  into v_search_path, v_security_definer
  from pg_catalog.pg_proc function_row
  where function_row.oid =
    'public.memory_enqueue_projectos_evidence_review()'::regprocedure;

  if v_search_path is distinct from array['search_path=""']::text[] then
    raise exception 'projectos_evidence_atomic_trigger_search_path_invalid';
  end if;
  if v_security_definer is distinct from false then
    raise exception 'projectos_evidence_atomic_trigger_security_mode_invalid';
  end if;

  select trigger_row.tgenabled
  into v_trigger_enabled
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.memory_capture_candidates'::regclass
    and trigger_row.tgname = 'memory_projectos_evidence_candidate_review_atomic'
    and not trigger_row.tgisinternal;
  if v_trigger_enabled is distinct from 'O'::"char" then
    raise exception 'projectos_evidence_atomic_trigger_not_enabled';
  end if;

  if has_function_privilege(
    'anon',
    'public.memory_enqueue_projectos_evidence_review()',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.memory_enqueue_projectos_evidence_review()',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticator',
    'public.memory_enqueue_projectos_evidence_review()',
    'EXECUTE'
  ) then
    raise exception 'projectos_evidence_atomic_trigger_execute_grant_invalid';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.memory_enqueue_projectos_evidence_review()',
    'EXECUTE'
  ) then
    raise exception 'projectos_evidence_atomic_trigger_service_role_missing';
  end if;
end;
$verify$;

commit;
