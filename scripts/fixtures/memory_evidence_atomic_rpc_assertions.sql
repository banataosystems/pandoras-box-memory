\set ON_ERROR_STOP on

create or replace function public.test_submit_projectos_evidence(
  p_idempotency_key text,
  p_claim text
)
returns jsonb
language sql
as $function$
  select public.submit_projectos_evidence_candidate_atomic(
    'projectos-mcpmaster-production',
    '11111111-1111-4111-8111-111111111111'::uuid,
    'production',
    'real_life',
    '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid,
    'mcpmaster-pandoras-box',
    'Atomic evidence candidate',
    'Metadata-only evidence prepared for review.',
    'tested',
    p_claim,
    jsonb_build_array(
      jsonb_build_object(
        'type', 'sha256',
        'ref', repeat('a', 64),
        'sha256', repeat('a', 64)
      )
    ),
    jsonb_build_object(
      'source_type', 'github_exact_head',
      'source_locator', 'banataosystems/pandoras-box-memory@478105057c1ca5fb5b356750ba1fa1fb58b1f42c',
      'source_sha', '478105057c1ca5fb5b356750ba1fa1fb58b1f42c',
      'observed_at', '2026-08-21T08:00:00Z'
    ),
    p_idempotency_key
  );
$function$;

create or replace function public.test_fail_atomic_review_insert()
returns trigger
language plpgsql
as $function$
begin
  if new.source_ref like '%atomic-fail-review-0001' then
    raise exception 'injected review failure';
  end if;
  return new;
end;
$function$;

create or replace function public.test_fail_atomic_audit_insert()
returns trigger
language plpgsql
as $function$
begin
  if new.metadata ->> 'idempotency_key' = 'atomic-fail-audit-0001' then
    raise exception 'injected audit failure';
  end if;
  return new;
end;
$function$;

do $privilege_assertions$
begin
  if has_function_privilege(
    'anon',
    'public.submit_projectos_evidence_candidate_atomic(text,uuid,text,text,uuid,text,text,text,text,text,jsonb,jsonb,text)',
    'execute'
  ) then
    raise exception 'anon must not execute atomic evidence RPC';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.submit_projectos_evidence_candidate_atomic(text,uuid,text,text,uuid,text,text,text,text,text,jsonb,jsonb,text)',
    'execute'
  ) then
    raise exception 'authenticated must not execute atomic evidence RPC';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.submit_projectos_evidence_candidate_atomic(text,uuid,text,text,uuid,text,text,text,text,text,jsonb,jsonb,text)',
    'execute'
  ) then
    raise exception 'service_role must execute atomic evidence RPC';
  end if;
end;
$privilege_assertions$;

do $idempotency_and_conflict_assertions$
declare
  v_created jsonb;
  v_replay jsonb;
  v_conflict jsonb;
begin
  v_created := public.test_submit_projectos_evidence(
    'atomic-sequential-0001',
    'The exact source candidate passed isolated checks.'
  );
  if v_created ->> 'outcome' <> 'created' then
    raise exception 'first atomic submission must create';
  end if;

  v_replay := public.test_submit_projectos_evidence(
    'atomic-sequential-0001',
    'The exact source candidate passed isolated checks.'
  );
  if v_replay ->> 'outcome' <> 'deduplicated'
    or v_replay ->> 'candidate_id' <> v_created ->> 'candidate_id'
    or v_replay ->> 'review_item_id' <> v_created ->> 'review_item_id'
    or v_replay ->> 'audit_id' <> v_created ->> 'audit_id'
  then
    raise exception 'identical replay must deduplicate to the same lifecycle unit';
  end if;

  v_conflict := public.test_submit_projectos_evidence(
    'atomic-sequential-0001',
    'Changed content under the same idempotency key.'
  );
  if v_conflict ->> 'outcome' <> 'idempotency_conflict' then
    raise exception 'changed content must conflict';
  end if;

  if (select count(*) from public.memory_capture_candidates) <> 1
    or (select count(*) from public.memory_review_queue_items) <> 1
    or (select count(*) from public.audit_logs) <> 1
  then
    raise exception 'idempotency/conflict must preserve exactly one atomic lifecycle unit';
  end if;
end;
$idempotency_and_conflict_assertions$;

do $immutability_assertions$
begin
  begin
    update public.audit_logs
      set metadata = metadata || jsonb_build_object('mutated', true)
    where action = 'projectos_evidence_candidate_atomic_created';
    raise exception 'immutable audit update unexpectedly succeeded';
  exception
    when sqlstate '55000' then null;
  end;

  begin
    delete from public.audit_logs
    where action = 'projectos_evidence_candidate_atomic_created';
    raise exception 'immutable audit delete unexpectedly succeeded';
  exception
    when sqlstate '55000' then null;
  end;

  if (select count(*) from public.audit_logs) <> 1 then
    raise exception 'immutable audit must remain present';
  end if;
end;
$immutability_assertions$;
