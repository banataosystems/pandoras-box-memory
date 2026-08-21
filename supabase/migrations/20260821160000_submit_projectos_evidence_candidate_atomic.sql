begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A successful ProjectOS evidence intake must have exactly one candidate,
-- exactly one pending-review row, and exactly one append-only audit record.
-- The RPC below owns that transaction boundary; the Edge Function must never
-- reproduce these writes as separate service-role requests.

create unique index if not exists audit_logs_projectos_evidence_candidate_atomic_unique
  on public.audit_logs (record_id)
  where action = 'projectos_evidence_candidate_atomic_created'
    and table_name = 'memory_capture_candidates';

do $atomic_audit_index_assertion$
declare
  v_is_unique boolean;
  v_predicate text;
begin
  select i.indisunique, pg_get_expr(i.indpred, i.indrelid)
    into v_is_unique, v_predicate
  from pg_catalog.pg_index i
  where i.indexrelid =
    'public.audit_logs_projectos_evidence_candidate_atomic_unique'::regclass;

  if v_is_unique is not true
    or v_predicate not like '%projectos_evidence_candidate_atomic_created%'
    or v_predicate not like '%memory_capture_candidates%'
  then
    raise exception 'projectos evidence atomic audit index drift';
  end if;
end;
$atomic_audit_index_assertion$;

create or replace function public.prevent_projectos_evidence_intake_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'projectos evidence intake audit is immutable';
end;
$function$;

revoke all on function public.prevent_projectos_evidence_intake_audit_mutation()
  from public;
revoke all on function public.prevent_projectos_evidence_intake_audit_mutation()
  from anon, authenticated, service_role;

drop trigger if exists prevent_projectos_evidence_intake_audit_mutation
  on public.audit_logs;

create trigger prevent_projectos_evidence_intake_audit_mutation
before update or delete on public.audit_logs
for each row
when (
  old.action = 'projectos_evidence_candidate_atomic_created'
  and old.table_name = 'memory_capture_candidates'
)
execute function public.prevent_projectos_evidence_intake_audit_mutation();

create or replace function public.submit_projectos_evidence_candidate_atomic(
  p_principal_key text,
  p_user_id uuid,
  p_environment text,
  p_namespace text,
  p_project_id uuid,
  p_project_key text,
  p_title text,
  p_summary text,
  p_proof_stage text,
  p_claim text,
  p_evidence_refs jsonb,
  p_provenance jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  v_principal public.pandora_service_principals%rowtype;
  v_project public.pandora_projects%rowtype;
  v_grant public.pandora_project_grants%rowtype;
  v_proposal_grant_count integer;
  v_source_ref text;
  v_fingerprint_payload jsonb;
  v_fingerprint text;
  v_candidate_id uuid;
  v_review_item_id uuid;
  v_audit_id uuid;
  v_created_at timestamptz := clock_timestamp();
  v_existing_fingerprint text;
  v_created boolean := false;
  v_integrity_count integer;
begin
  if p_principal_key is distinct from 'projectos-mcpmaster-production'
    or p_environment is distinct from 'production'
    or p_namespace is distinct from 'real_life'
    or p_project_id is distinct from '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid
    or p_project_key is distinct from 'mcpmaster-pandoras-box'
  then
    raise exception using
      errcode = '22023',
      message = 'projectos evidence atomic identity is outside the authorized envelope';
  end if;

  if p_user_id is null
    or p_title is null
    or p_title <> btrim(p_title)
    or char_length(p_title) not between 1 and 200
    or p_summary is null
    or p_summary <> btrim(p_summary)
    or char_length(p_summary) not between 1 and 1800
    or p_claim is null
    or p_claim <> btrim(p_claim)
    or char_length(p_claim) not between 1 and 1000
    or p_proof_stage not in (
      'documented',
      'implemented',
      'tested',
      'deployed',
      'production_verified'
    )
    or p_idempotency_key is null
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,160}$'
    or jsonb_typeof(p_evidence_refs) is distinct from 'array'
    or jsonb_typeof(p_provenance) is distinct from 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'projectos evidence atomic payload is invalid';
  end if;

  if jsonb_array_length(p_evidence_refs) = 0 then
    raise exception using
      errcode = '22023',
      message = 'projectos evidence atomic payload is invalid';
  end if;

  select p.*
    into v_principal
  from public.pandora_service_principals p
  where p.principal_key = p_principal_key
    and p.is_active is true
  for share;

  if not found
    or v_principal.memory_user_id is distinct from p_user_id
    or v_principal.environment is distinct from p_environment
    or not coalesce(
      v_principal.allowed_namespaces @> array[p_namespace]::text[],
      false
    )
    or not coalesce(
      v_principal.scopes @> array['memory:write']::text[],
      false
    )
  then
    raise exception using
      errcode = '42501',
      message = 'projectos evidence atomic principal is not authorized';
  end if;

  select p.*
    into v_project
  from public.pandora_projects p
  where p.id = p_project_id
    and p.project_key = p_project_key
    and p.memory_namespace = p_namespace
    and p.lifecycle_status = 'active'
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'projectos evidence atomic project is not authorized';
  end if;

  select g.*
    into v_grant
  from public.pandora_project_grants g
  where g.principal_key = p_principal_key
    and g.project_id = p_project_id
    and g.environment = p_environment
    and g.is_active is true
    and g.can_propose is true
    and g.revoked_at is null
  for share;

  if not found or v_grant.can_approve is not false then
    raise exception using
      errcode = '42501',
      message = 'projectos evidence atomic proposal grant is not authorized';
  end if;

  select count(*)
    into v_proposal_grant_count
  from public.pandora_project_grants g
  where g.principal_key = p_principal_key
    and g.environment = p_environment
    and g.is_active is true
    and g.can_propose is true
    and g.revoked_at is null;

  if v_proposal_grant_count <> 1 then
    raise exception using
      errcode = '42501',
      message = 'projectos evidence atomic additional proposal grants exist';
  end if;

  v_source_ref :=
    'projectos-evidence:' || p_project_id::text || ':' || p_idempotency_key;
  v_fingerprint_payload := jsonb_build_object(
    'namespace', p_namespace,
    'project_id', p_project_id::text,
    'project_key', p_project_key,
    'title', p_title,
    'summary', p_summary,
    'proof_stage', p_proof_stage,
    'claim', p_claim,
    'evidence_refs', p_evidence_refs,
    'provenance', p_provenance,
    'idempotency_key', p_idempotency_key
  );
  v_fingerprint := encode(
    extensions.digest(convert_to(v_fingerprint_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

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
    created_at,
    usefulness_score,
    confidence_score,
    freshness_score,
    retrieval_weight,
    stale_status,
    scoring_version,
    scored_at
  ) values (
    p_user_id,
    p_namespace,
    'projectos-post-task',
    v_source_ref,
    null,
    p_summary,
    'business_fact',
    p_title,
    p_summary,
    8,
    'low',
    0.95,
    true,
    true,
    'pending',
    'ProjectOS evidence intake is review-gated. This candidate cannot become canonical without an authenticated human decision.',
    '[]'::jsonb,
    jsonb_build_array(p_project_key),
    '[]'::jsonb,
    jsonb_build_array('projectos', 'evidence_candidate', p_proof_stage),
    jsonb_build_object(
      'schema_version', 2,
      'intake_kind', 'projectos_evidence_candidate_v1',
      'project_id', p_project_id,
      'project_key', p_project_key,
      'proof_stage', p_proof_stage,
      'claim', p_claim,
      'evidence_refs', p_evidence_refs,
      'provenance', p_provenance,
      'idempotency_key', p_idempotency_key,
      'fingerprint', v_fingerprint,
      'privacy_policy', 'metadata_only_v2_fail_closed',
      'privacy_scan_version', 'evidence_privacy_v2',
      'privacy_scan_passed', true,
      'privacy_scan_scope', 'canonicalized_candidate_payload',
      'imported_raw_arguments', false,
      'imported_raw_results', false,
      'imported_raw_errors', false,
      'atomic_rpc', 'submit_projectos_evidence_candidate_atomic'
    ),
    v_created_at,
    0.9,
    0.95,
    1,
    0.9,
    'active',
    'projectos-evidence-v2-atomic',
    v_created_at
  )
  on conflict (user_id, namespace, source, source_ref)
    where source = 'projectos-post-task' and source_ref is not null
  do nothing
  returning id, created_at
    into v_candidate_id, v_created_at;

  v_created := found;

  if not v_created then
    select c.id, c.created_at, c.metadata ->> 'fingerprint'
      into v_candidate_id, v_created_at, v_existing_fingerprint
    from public.memory_capture_candidates c
    where c.user_id = p_user_id
      and c.namespace = p_namespace
      and c.source = 'projectos-post-task'
      and c.source_ref = v_source_ref
    for update;

    if not found or v_candidate_id is null or v_existing_fingerprint is null then
      raise exception using
        errcode = '55000',
        message = 'projectos evidence atomic candidate recovery failed';
    end if;

    select r.id
      into v_review_item_id
    from public.memory_review_queue_items r
    where r.user_id = p_user_id
      and r.namespace = p_namespace
      and r.candidate_type = 'projectos_outcome'
      and r.source_ref = v_source_ref
      and r.status = 'pending_review'
      and r.requires_review is true
      and r.append_only is true
      and r.fingerprint = v_existing_fingerprint
      and r.evidence_snapshot ->> 'candidateId' = v_candidate_id::text;

    select a.id
      into v_audit_id
    from public.audit_logs a
    where a.record_id = v_candidate_id
      and a.action = 'projectos_evidence_candidate_atomic_created'
      and a.table_name = 'memory_capture_candidates'
      and a.metadata ->> 'review_item_id' = v_review_item_id::text
      and a.metadata ->> 'fingerprint' = v_existing_fingerprint;

    if v_review_item_id is null or v_audit_id is null then
      raise exception using
        errcode = '55000',
        message = 'projectos evidence atomic state is incomplete';
    end if;

    if v_existing_fingerprint <> v_fingerprint then
      return jsonb_build_object(
        'outcome', 'idempotency_conflict',
        'candidate_id', v_candidate_id,
        'review_item_id', v_review_item_id,
        'audit_id', v_audit_id,
        'fingerprint', v_existing_fingerprint,
        'canonical_memory_written', false
      );
    end if;

    return jsonb_build_object(
      'outcome', 'deduplicated',
      'candidate_id', v_candidate_id,
      'review_item_id', v_review_item_id,
      'audit_id', v_audit_id,
      'created_at', v_created_at,
      'fingerprint', v_existing_fingerprint,
      'namespace', p_namespace,
      'project_id', p_project_id,
      'project_key', p_project_key,
      'proof_stage', p_proof_stage,
      'canonical_memory_written', false
    );
  end if;

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
    created_at,
    updated_at,
    persistence_execution_metadata
  ) values (
    p_user_id,
    p_namespace,
    'pending_review',
    'projectos_outcome',
    p_summary,
    jsonb_build_object(
      'hasEvidence', true,
      'intakeKind', 'projectos_evidence_candidate_v1',
      'sourceRef', v_source_ref,
      'proofStage', p_proof_stage,
      'claim', p_claim,
      'evidenceRefs', p_evidence_refs,
      'provenance', p_provenance,
      'candidateId', v_candidate_id
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
      'sourceNamespace', p_namespace,
      'targetNamespace', p_namespace,
      'namespaceMatch', true
    ),
    jsonb_build_object(
      'source', 'projectos-post-task',
      'sourceKind', 'projectos_evidence',
      'sourceRef', v_source_ref,
      'projectId', p_project_id,
      'projectKey', p_project_key,
      'proofStage', p_proof_stage
    ),
    jsonb_build_object(
      'schemaVersion', 2,
      'candidateId', v_candidate_id,
      'appendOnly', true,
      'reviewRequired', true,
      'idempotencyKey', p_idempotency_key,
      'fingerprint', v_fingerprint,
      'atomicTransaction', true,
      'immutableAuditRequired', true
    ),
    true,
    'append',
    true,
    v_source_ref,
    v_fingerprint,
    v_fingerprint,
    v_created_at,
    v_created_at,
    jsonb_build_object(
      'atomicRpc', 'submit_projectos_evidence_candidate_atomic',
      'schemaVersion', 1
    )
  )
  returning id into v_review_item_id;

  insert into public.audit_logs (
    user_id,
    namespace,
    action,
    table_name,
    record_id,
    before_snapshot,
    after_snapshot,
    metadata,
    created_at
  ) values (
    p_user_id,
    p_namespace::public.pandora_namespace,
    'projectos_evidence_candidate_atomic_created',
    'memory_capture_candidates',
    v_candidate_id,
    null,
    jsonb_build_object(
      'candidate_status', 'pending',
      'review_status', 'pending_review',
      'canonical_memory_written', false
    ),
    jsonb_build_object(
      'schema_version', 1,
      'source', 'projectos-post-task',
      'source_ref', v_source_ref,
      'candidate_id', v_candidate_id,
      'review_item_id', v_review_item_id,
      'project_id', p_project_id,
      'project_key', p_project_key,
      'idempotency_key', p_idempotency_key,
      'fingerprint', v_fingerprint,
      'atomic_transaction', true,
      'append_only', true,
      'privacy_policy', 'metadata_only_v2_fail_closed'
    ),
    v_created_at
  )
  returning id into v_audit_id;

  select count(*)
    into v_integrity_count
  from public.memory_capture_candidates c
  join public.memory_review_queue_items r
    on r.user_id = c.user_id
    and r.namespace = c.namespace
    and r.source_ref = c.source_ref
    and r.candidate_type = 'projectos_outcome'
  join public.audit_logs a
    on a.record_id = c.id
    and a.action = 'projectos_evidence_candidate_atomic_created'
    and a.table_name = 'memory_capture_candidates'
  where c.id = v_candidate_id
    and r.id = v_review_item_id
    and a.id = v_audit_id
    and c.status = 'pending'
    and c.requires_review is true
    and r.status = 'pending_review'
    and r.requires_review is true
    and r.append_only is true
    and c.metadata ->> 'fingerprint' = v_fingerprint
    and r.fingerprint = v_fingerprint
    and r.evidence_snapshot ->> 'candidateId' = v_candidate_id::text
    and a.metadata ->> 'review_item_id' = v_review_item_id::text
    and a.metadata ->> 'fingerprint' = v_fingerprint;

  if v_integrity_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'projectos evidence atomic postcondition failed';
  end if;

  return jsonb_build_object(
    'outcome', 'created',
    'candidate_id', v_candidate_id,
    'review_item_id', v_review_item_id,
    'audit_id', v_audit_id,
    'created_at', v_created_at,
    'fingerprint', v_fingerprint,
    'namespace', p_namespace,
    'project_id', p_project_id,
    'project_key', p_project_key,
    'proof_stage', p_proof_stage,
    'canonical_memory_written', false
  );
end;
$function$;

revoke all on function public.submit_projectos_evidence_candidate_atomic(
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  text
) from public;

revoke all on function public.submit_projectos_evidence_candidate_atomic(
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  text
) from anon, authenticated;

grant execute on function public.submit_projectos_evidence_candidate_atomic(
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  text
) to service_role;

comment on function public.submit_projectos_evidence_candidate_atomic(
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  text
) is
  'Atomically persists one review-gated ProjectOS evidence candidate, its pending-review item, and one immutable metadata-only audit record. It never writes canonical memory.';

commit;
