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

create or replace function public.test_submit_projectos_evidence_fields(
  p_idempotency_key text,
  p_title text,
  p_summary text,
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
    p_title,
    p_summary,
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

revoke all on function public.test_submit_projectos_evidence_fields(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.test_submit_projectos_evidence_fields(text, text, text, text)
  to service_role;

create or replace function public.test_submit_projectos_evidence_stage(
  p_idempotency_key text,
  p_proof_stage text
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
    p_proof_stage,
    'Exact source passed isolated checks.',
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

revoke all on function public.test_submit_projectos_evidence_stage(text, text)
  from public, anon, authenticated;
grant execute on function public.test_submit_projectos_evidence_stage(text, text)
  to service_role;

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
  if has_table_privilege(
      'service_role',
      'public.memory_capture_candidates',
      'TRUNCATE'
    )
    or has_table_privilege(
      'service_role',
      'public.memory_review_queue_items',
      'TRUNCATE'
    )
    or has_table_privilege('service_role', 'public.audit_logs', 'TRUNCATE')
    or has_table_privilege(
      'service_role',
      'public.memory_capture_candidates',
      'TRIGGER'
    )
    or has_table_privilege(
      'service_role',
      'public.memory_review_queue_items',
      'TRIGGER'
    )
    or has_table_privilege('service_role', 'public.audit_logs', 'TRIGGER') then
    raise exception 'service_role must not truncate or replace protected triggers';
  end if;
end;
$privilege_assertions$;

set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set role authenticated;

do $authenticated_reserved_preseed_assertions$
begin
  begin
    insert into public.memory_capture_candidates (
      user_id, namespace, source, source_ref
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'real_life',
      'projectos-post-task',
      'projectos-evidence:7c686cbd-d968-49d5-86cc-918f5e777bd2:forged-auth-candidate-0001'
    );
    raise exception 'authenticated reserved candidate preseed unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;

  begin
    insert into public.memory_review_queue_items (
      user_id, namespace, status, candidate_type, normalized_text,
      evidence_snapshot, sensitivity_snapshot, namespace_snapshot,
      source_metadata, audit_metadata, append_only, proposed_operation,
      requires_review, source_ref
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'real_life',
      'pending_review',
      'projectos_outcome',
      'forged',
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      true,
      'append',
      true,
      'projectos-evidence:7c686cbd-d968-49d5-86cc-918f5e777bd2:forged-auth-review-0001'
    );
    raise exception 'authenticated reserved review preseed unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;

  begin
    insert into public.audit_logs (
      user_id, namespace, action, table_name, record_id, metadata
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'real_life',
      'projectos_evidence_candidate_atomic_created',
      'memory_capture_candidates',
      gen_random_uuid(),
      '{}'::jsonb
    );
    raise exception 'authenticated reserved audit preseed unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end;
$authenticated_reserved_preseed_assertions$;

reset role;
reset request.jwt.claim.sub;
set role service_role;

do $service_role_reserved_boundary_assertions$
declare
  v_benign_audit_id uuid;
begin
  begin
    insert into public.memory_capture_candidates (
      user_id, namespace, source, source_ref
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'real_life',
      'projectos-post-task',
      'projectos-evidence:7c686cbd-d968-49d5-86cc-918f5e777bd2:forged-service-candidate-0001'
    );
    raise exception 'service_role reserved candidate preseed unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;

  begin
    insert into public.memory_review_queue_items (
      user_id, namespace, status, candidate_type, normalized_text,
      evidence_snapshot, sensitivity_snapshot, namespace_snapshot,
      source_metadata, audit_metadata, append_only, proposed_operation,
      requires_review, source_ref
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'real_life',
      'pending_review',
      'projectos_outcome',
      'forged',
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      true,
      'append',
      true,
      'projectos-evidence:7c686cbd-d968-49d5-86cc-918f5e777bd2:forged-service-review-0001'
    );
    raise exception 'service_role reserved review preseed unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;

  begin
    insert into public.audit_logs (
      user_id, namespace, action, table_name, record_id, metadata
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'real_life',
      'projectos_evidence_candidate_atomic_created',
      'memory_capture_candidates',
      gen_random_uuid(),
      '{}'::jsonb
    );
    raise exception 'service_role reserved audit preseed unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;

  insert into public.audit_logs (
    user_id, namespace, action, table_name, record_id, metadata
  ) values (
    '11111111-1111-4111-8111-111111111111',
    'real_life',
    'test_benign_action',
    'test_table',
    gen_random_uuid(),
    '{}'::jsonb
  ) returning id into v_benign_audit_id;

  begin
    update public.audit_logs
    set action = 'projectos_evidence_successor_activation_authorized',
        table_name = 'release_authorizations'
    where id = v_benign_audit_id;
    raise exception 'service_role benign-to-reserved audit relabel unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;

  delete from public.audit_logs where id = v_benign_audit_id;

  begin
    execute 'truncate table public.audit_logs';
    raise exception 'service_role protected audit truncate unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end;
$service_role_reserved_boundary_assertions$;

do $service_role_durable_privacy_assertions$
declare
  v_attack text;
begin
  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-base64-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'cGFzc3dvcmQ9aHVudGVyMi1zdXBlci1zZWNyZXQ='
    );
    raise exception 'service_role base64 privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-base64-short-name-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'SmFuZSBEb2U='
    );
    raise exception 'service_role short base64 name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-base64-padded-name-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'Sm9obiBTbWl0aA=='
    );
    raise exception 'service_role padded base64 name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-data-url-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'data:text/plain;base64,cGFzc3dvcmQ9aHVudGVyMi1zdXBlci1zZWNyZXQ='
    );
    raise exception 'service_role data-url privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-embedded-base64-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'Encoded credential: cGFzc3dvcmQ9aHVudGVyMi1zdXBlci1zZWNyZXQ='
    );
    raise exception 'service_role embedded base64 privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-quoted-base64-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      '''cGFzc3dvcmQ9aHVudGVyMi1zdXBlci1zZWNyZXQ='''
    );
    raise exception 'service_role quoted base64 privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-prefixed-base64-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'base64:cGFzc3dvcmQ9aHVudGVyMi1zdXBlci1zZWNyZXQ='
    );
    raise exception 'service_role prefixed base64 privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-split1-base64-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'c G F z c 3 d v c m Q 9 a H V u d G V y M i 1 z d X B l c i 1 z Z W N y Z X Q ='
    );
    raise exception 'service_role 1-character split base64 privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-split2-base64-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'cG Fz c3 dv cm Q9 aH Vu dG Vy Mi 1z dX Bl ci 1z ZW Ny ZX Q='
    );
    raise exception 'service_role 2-character split base64 privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-split3-base64-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'cGF zc3 dvc mQ9 aHV udG VyM i1z dXB lci 1zZ WNy ZXQ ='
    );
    raise exception 'service_role 3-character split base64 privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-name-0001',
      'Atomic evidence candidate',
      'Jane Doe',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role person-name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-standalone-uppercase-name-0001',
      'Atomic evidence candidate',
      'JANE DOE',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role standalone uppercase name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-unicode-name-0001',
      'Atomic evidence candidate',
      'José García',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role Unicode name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-leading-prose-name-0001',
      'Atomic evidence candidate',
      'Jane Doe completed validation.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role leading prose name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-verb-prefix-name-0001',
      'Atomic evidence candidate',
      'Reviewed Jane Doe output.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role verb-prefix name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-met-prefix-name-0001',
      'Atomic evidence candidate',
      'Met Jane Doe yesterday.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role met-prefix name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-owner-prose-name-0001',
      'Atomic evidence candidate',
      'Evidence owner is Jane Doe.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role owner prose name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-allcaps-prose-name-0001',
      'Atomic evidence candidate',
      'MARY ANN SMITH completed validation.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role all-caps prose name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-unicode-prose-name-0001',
      'Atomic evidence candidate',
      'José García completed validation.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role Unicode prose name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-prose-name-0001',
      'Atomic evidence candidate',
      'Candidate Jane Doe supplied evidence.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role prose person-name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-uppercase-name-0001',
      'Atomic evidence candidate',
      'Candidate JANE DOE supplied evidence.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role uppercase prose name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-uppercase-long-name-0001',
      'Atomic evidence candidate',
      'Contact JUAN DELA CRUZ for proof.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role uppercase long name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-artifact-prefix-name-0001',
      'Atomic evidence candidate',
      'Candidate Atomic Jane Doe supplied evidence.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role artifact-prefix person name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-atomic-prefix-name-0001',
      'Atomic evidence candidate',
      'Atomic Jane Doe',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role atomic-prefix person name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-memory-prefix-name-0001',
      'Atomic evidence candidate',
      'Contact Memory Jane Doe for proof.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role memory-prefix person name privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-dob-0001',
      'Atomic evidence candidate',
      'Born 1990-01-31',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role birth-date privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-prose-dob-0001',
      'Atomic evidence candidate',
      'Candidate DOB is 1990-01-31.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role prose birth-date privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-slash-dob-0001',
      'Atomic evidence candidate',
      'DOB: 31/01/1990',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role slash birth-date privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-dash-dob-0001',
      'Atomic evidence candidate',
      'DOB is 01-31-1990',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role dash birth-date privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-month-dob-0001',
      'Atomic evidence candidate',
      'Born January 31, 1990',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role month-name birth-date privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-phone-0001',
      'Atomic evidence candidate',
      'Call +1 (415) 555-1212 for proof.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role formatted-phone privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-quoted-secret-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'password="hunter2-super-secret"'
    );
    raise exception 'service_role quoted-secret privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;


  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-sas-secret-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'SharedAccessSignature=super-secret-signature'
    );
    raise exception 'service_role shared-access-signature privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-entity-secret-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'passw&#x6f;rd=hunter2-super-secret'
    );
    raise exception 'service_role encoded-entity privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-b64-entity-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'cGFzc3cmI3g2ZjtyZD1odW50ZXIyLXN1cGVyLXNlY3JldA=='
    );
    raise exception 'service_role base64 encoded-entity privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'privacy-benign-percent-ref-0001',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'https://example.test/a%20b'
    );
    raise exception 'service_role encoded-text parity rejection unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  foreach v_attack in array array[
    'Jane Q. Doe completed validation.',
    'J. Doe completed validation.',
    'Candidate J Doe supplied evidence.',
    'Jane O''Connor completed validation.',
    'José de la Cruz completed validation.',
    'Juan dela Cruz completed validation.',
    'Birth date: 1990-01-31',
    'Birthdate: 1990-01-31',
    'Birthday: January 31, 1990',
    'Born on 1990-01-31',
    'Phone: 4155552671',
    'Phone number: +14155552671',
    'Telephone: 4155552671',
    'Passport number: P1234567',
    'Card number: 4111111111111111',
    'Bank account: 123456789012'
  ]::text[] loop
    begin
      perform public.test_submit_projectos_evidence_fields(
        'privacy-summary-corpus-' || md5(v_attack),
        'Atomic evidence candidate',
        v_attack,
        'Exact source passed isolated checks.'
      );
      raise exception 'service_role summary privacy corpus bypass: %', v_attack;
    exception when sqlstate '22023' then null;
    end;
  end loop;

  foreach v_attack in array array[
    'password: redacted',
    'password=masked',
    'password: none',
    'password: true',
    'cGFz,c3dv,cmQ9,aHVu,dGVy,Mg==',
    'glpat-abcdefghijklmnopqrst',
    'xoxb-' || '123456789012-123456789012-abcdefghijklmnopqrstuvwx',
    'sk-' || 'proj-abcdefghijklmnopqrstuvwxyz1234567890',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
    'Authorization: Basic abcdefghijklmnopqrstuvwxyz123456'
  ]::text[] loop
    begin
      perform public.test_submit_projectos_evidence_fields(
        'privacy-claim-corpus-' || md5(v_attack),
        'Atomic evidence candidate',
        'Metadata-only evidence prepared for review.',
        v_attack
      );
      raise exception 'service_role claim privacy corpus bypass: %', v_attack;
    exception when sqlstate '22023' then null;
    end;
  end loop;

  begin
    perform public.test_submit_projectos_evidence_stage(
      'privacy-null-stage-0001',
      null
    );
    raise exception 'service_role null proof stage unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.test_submit_projectos_evidence_fields(
      'cGFzc3dvcmQ9aHVudGVyMi1zdXBlci1zZWNyZXQ',
      'Atomic evidence candidate',
      'Metadata-only evidence prepared for review.',
      'Exact source passed isolated checks.'
    );
    raise exception 'service_role idempotency privacy bypass unexpectedly succeeded';
  exception when sqlstate '22023' then null;
  end;

  if exists (
    select 1
    from public.memory_capture_candidates
    where source_ref like '%privacy-%'
       or source_ref like '%cGFzc3dvcmQ9aHVudGVyMi1zdXBlci1zZWNyZXQ'
  ) then
    raise exception 'durable privacy rejection left a candidate row';
  end if;
end;
$service_role_durable_privacy_assertions$;

reset role;

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
    or (
      select count(*)
      from public.audit_logs
      where action = 'projectos_evidence_candidate_atomic_created'
    ) <> 1
  then
    raise exception 'idempotency/conflict must preserve exactly one atomic lifecycle unit';
  end if;
end;
$idempotency_and_conflict_assertions$;

set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set role authenticated;

do $authenticated_post_rpc_mutation_assertions$
begin
  begin
    update public.memory_capture_candidates
    set summary = 'forged post-RPC mutation'
    where source_ref like '%atomic-sequential-0001';
    raise exception 'authenticated reserved candidate update unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;

  begin
    delete from public.memory_capture_candidates
    where source_ref like '%atomic-sequential-0001';
    raise exception 'authenticated reserved candidate delete unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end;
$authenticated_post_rpc_mutation_assertions$;

reset role;
reset request.jwt.claim.sub;

set role service_role;

do $service_role_post_rpc_mutation_assertions$
begin
  begin
    update public.memory_capture_candidates
    set summary = 'service-role forged candidate mutation'
    where source_ref like '%atomic-sequential-0001';
    raise exception 'service_role reserved candidate update unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;

  begin
    delete from public.memory_capture_candidates
    where source_ref like '%atomic-sequential-0001';
    raise exception 'service_role reserved candidate delete unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;

  begin
    update public.memory_review_queue_items
    set normalized_text = 'service-role forged review mutation'
    where source_ref like '%atomic-sequential-0001';
    raise exception 'service_role reserved review update unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;

  begin
    delete from public.memory_review_queue_items
    where source_ref like '%atomic-sequential-0001';
    raise exception 'service_role reserved review delete unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end;
$service_role_post_rpc_mutation_assertions$;

do $immutability_assertions$
declare
  v_action text;
begin
  foreach v_action in array array[
    'projectos_evidence_candidate_atomic_created',
    'projectos_evidence_successor_activation_authorized',
    'projectos_evidence_candidate_write_scope_activated'
  ]::text[] loop
    if (select count(*) from public.audit_logs where action = v_action) <> 1 then
      raise exception 'expected one immutable audit before mutation probe: %', v_action;
    end if;

    begin
      update public.audit_logs
        set metadata = metadata || jsonb_build_object('mutated', true)
      where action = v_action;
      raise exception 'immutable audit update unexpectedly succeeded: %', v_action;
    exception
      when sqlstate '55000' then null;
    end;

    begin
      delete from public.audit_logs where action = v_action;
      raise exception 'immutable audit delete unexpectedly succeeded: %', v_action;
    exception
      when sqlstate '55000' then null;
    end;

    if (select count(*) from public.audit_logs where action = v_action) <> 1 then
      raise exception 'immutable audit must remain present: %', v_action;
    end if;
  end loop;
end;
$immutability_assertions$;

do $safe_artifact_name_acceptance$
declare
  v_result jsonb;
begin
  v_result := public.test_submit_projectos_evidence_fields(
    'safe-artifact-title-0001',
    'Atomic Migration',
    'Metadata-only evidence prepared for review.',
    'Exact source passed isolated checks.'
  );
  if v_result ->> 'outcome' <> 'created' then
    raise exception 'safe capitalized artifact title was rejected';
  end if;

  v_result := public.test_submit_projectos_evidence_fields(
    'safe-artifact-claim-0001',
    'Atomic evidence candidate',
    'Metadata-only evidence prepared for review.',
    'Systems Mastery'
  );
  if v_result ->> 'outcome' <> 'created' then
    raise exception 'safe capitalized artifact claim was rejected';
  end if;

  v_result := public.test_submit_projectos_evidence_fields(
    'safe-artifact-prose-0001',
    'Atomic evidence candidate',
    'Candidate Atomic Migration passed.',
    'Exact source passed isolated checks.'
  );
  if v_result ->> 'outcome' <> 'created' then
    raise exception 'safe capitalized artifact prose was rejected';
  end if;
end;
$safe_artifact_name_acceptance$;

reset role;
