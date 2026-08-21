-- Roll back the governed forward activation only.
--
-- Restore and verify the recovered live bridge source from commit
-- 523fec111bfb2c327f69c2abdf0784775ab49a90 before running this SQL. That
-- ordering makes the public route fail closed before authorization is narrowed.
-- Preserve the activation audit and all pending review-gated candidates.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

select pg_advisory_xact_lock(20260821, 113000);

lock table public.pandora_service_principals in share row exclusive mode;
lock table public.pandora_projects in share mode;
lock table public.pandora_project_grants in share mode;
lock table public.audit_logs in share row exclusive mode;

do $forward_rollback_guard$
declare
  v_principal public.pandora_service_principals%rowtype;
  v_project public.pandora_projects%rowtype;
  v_grant public.pandora_project_grants%rowtype;
  v_other_active_can_propose integer;
  v_write_principal_count integer;
  v_activation_audit_count integer;
  v_existing_rollback_audit_count integer;
  v_scope_constraint_count integer;
  v_scope_constraint_definition text;
  v_atomic_audit_trigger_count integer;
  v_reserved_trigger_count integer;
begin
  select count(*)::integer
    into v_atomic_audit_trigger_count
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.audit_logs'::regclass
    and t.tgname = 'prevent_projectos_evidence_intake_audit_mutation'
    and t.tgfoid =
      'public.prevent_projectos_evidence_intake_audit_mutation()'::regprocedure
    and t.tgtype = 27
    and not t.tgisinternal
    and t.tgenabled = 'O';

  select count(*)::integer
    into v_reserved_trigger_count
  from pg_catalog.pg_trigger t
  where t.tgfoid = 'public.protect_projectos_evidence_reserved_rows()'::regprocedure
    and t.tgtype = 31
    and not t.tgisinternal
    and t.tgenabled = 'O'
    and (
      (
        t.tgrelid = 'public.memory_capture_candidates'::regclass
        and t.tgname = 'protect_projectos_evidence_reserved_candidate'
      ) or (
        t.tgrelid = 'public.memory_review_queue_items'::regclass
        and t.tgname = 'protect_projectos_evidence_reserved_review'
      ) or (
        t.tgrelid = 'public.audit_logs'::regclass
        and t.tgname = 'protect_projectos_evidence_reserved_audit'
      )
    );

  if v_atomic_audit_trigger_count <> 1 or v_reserved_trigger_count <> 3 then
    raise exception 'projectos evidence forward rollback blocked: atomic audit boundary drift';
  end if;

  select *
    into v_principal
  from public.pandora_service_principals
  where principal_key = 'projectos-mcpmaster-production';

  if not found then
    raise exception 'projectos evidence forward rollback blocked: principal missing';
  end if;
  if not v_principal.is_active
     or v_principal.provider <> 'vercel_oidc'
     or v_principal.environment <> 'production'
     or v_principal.project_name <> 'mcpmaster'
     or v_principal.project_id <> 'prj_Y5rZVcq8xJVzHVt4uvfmg9wPvXMk'
     or v_principal.memory_user_id is null then
    raise exception 'projectos evidence forward rollback blocked: principal identity drift';
  end if;
  if not (
    v_principal.allowed_namespaces <@ array['real_life']::text[]
    and array['real_life']::text[] <@ v_principal.allowed_namespaces
  ) then
    raise exception 'projectos evidence forward rollback blocked: namespace scope drift';
  end if;
  if not (
    v_principal.scopes <@ array['memory:health', 'memory:read', 'memory:write']::text[]
    and array['memory:health', 'memory:read', 'memory:write']::text[] <@ v_principal.scopes
  ) then
    raise exception 'projectos evidence forward rollback blocked: exact activated scopes missing';
  end if;

  select count(*)::integer, min(pg_get_constraintdef(oid, true))
    into v_scope_constraint_count, v_scope_constraint_definition
  from pg_constraint
  where conrelid = 'public.pandora_service_principals'::regclass
    and conname = 'pandora_service_principals_scopes_check'
    and contype = 'c'
    and convalidated;

  if v_scope_constraint_count <> 1
     or v_scope_constraint_definition <>
       'CHECK (scopes <@ ARRAY[''memory:health''::text, ''memory:read''::text, ''memory:write''::text])' then
    raise exception 'projectos evidence forward rollback blocked: activated scope constraint drift';
  end if;

  select count(*)::integer
    into v_write_principal_count
  from public.pandora_service_principals
  where 'memory:write' = any(scopes);

  if v_write_principal_count <> 1
     or not ('memory:write' = any(v_principal.scopes)) then
    raise exception 'projectos evidence forward rollback blocked: write scope escaped target principal';
  end if;

  select *
    into v_project
  from public.pandora_projects
  where project_key = 'mcpmaster-pandoras-box';

  if not found
     or v_project.id <> '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid
     or v_project.memory_namespace <> 'real_life'
     or v_project.lifecycle_status <> 'active' then
    raise exception 'projectos evidence forward rollback blocked: canonical project drift';
  end if;

  select *
    into v_grant
  from public.pandora_project_grants
  where principal_key = 'projectos-mcpmaster-production'
    and project_id = '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid
    and environment = 'production';

  if not found
     or not v_grant.is_active
     or v_grant.revoked_at is not null
     or not v_grant.can_read
     or not v_grant.can_propose
     or v_grant.can_approve then
    raise exception 'projectos evidence forward rollback blocked: governed project grant drift';
  end if;

  select count(*)::integer
    into v_other_active_can_propose
  from public.pandora_project_grants
  where principal_key = 'projectos-mcpmaster-production'
    and is_active
    and revoked_at is null
    and can_propose
    and (
      project_id <> '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid
      or environment <> 'production'
    );

  if v_other_active_can_propose <> 0 then
    raise exception 'projectos evidence forward rollback blocked: additional proposal grants exist';
  end if;

  select count(*)::integer
    into v_activation_audit_count
  from public.audit_logs
  where user_id = v_principal.memory_user_id
    and namespace = 'real_life'
    and action = 'projectos_evidence_candidate_write_scope_activated'
    and table_name = 'pandora_service_principals'
    and record_id = v_principal.id
    and metadata ->> 'activation_id' =
      'memory-evidence-atomic-successor-prod-activation-20260821'
    and metadata ->> 'authorization_id' =
      'memory-evidence-atomic-successor-exact-artifact-authorization'
    and metadata ->> 'authorized_head' ~ '^[0-9a-f]{40}$'
    and metadata ->> 'authorized_tree' ~ '^[0-9a-f]{40}$'
    and metadata ->> 'independent_review_id' <> ''
    and metadata ->> 'independent_review_verdict' = 'PASS'
    and metadata ->> 'issue_56_predecessor_only' = 'true'
    and before_snapshot = jsonb_build_object(
      'scopes', to_jsonb(array['memory:health', 'memory:read']::text[])
    )
    and after_snapshot = jsonb_build_object(
      'scopes', to_jsonb(array['memory:health', 'memory:read', 'memory:write']::text[])
    )
    and metadata ->> 'issue_56_authorizes_successor' = 'false'
    and metadata ->> 'atomic_migration' = '20260821160000_submit_projectos_evidence_candidate_atomic'
    and metadata ->> 'atomic_migration_sha256' = 'ed97a4254879c1acea18a08aefa3dce0612339bdf1b55dc64df015aa3479af81'
    and metadata ->> 'forward_migration' = '20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope'
    and metadata ->> 'bridge_index_sha256' = '383c1cac600f0381aba21fe492bc5d04777a91e361ba5bd2ac0e088449103d83'
    and metadata ->> 'import_map_sha256' = '5089831e8691c1b4183e7d5f5c0703ca861d4bb46d5fc7f8dbee0c0f76d3a88b';

  if v_activation_audit_count <> 1 then
    raise exception 'projectos evidence forward rollback blocked: activation audit mismatch';
  end if;

  select count(*)::integer
    into v_existing_rollback_audit_count
  from public.audit_logs
  where namespace = 'real_life'
    and metadata ->> 'rollback_id' =
      'memory-evidence-atomic-successor-prod-rollback-20260821';

  if v_existing_rollback_audit_count <> 0 then
    raise exception 'projectos evidence forward rollback blocked: rollback audit already exists';
  end if;
end;
$forward_rollback_guard$;

update public.pandora_service_principals
set scopes = array['memory:health', 'memory:read']::text[],
    updated_at = now()
where principal_key = 'projectos-mcpmaster-production';

alter table public.pandora_service_principals
  drop constraint pandora_service_principals_scopes_check;

alter table public.pandora_service_principals
  add constraint pandora_service_principals_scopes_check
  check (
    scopes <@ array[
      'memory:health'::text,
      'memory:read'::text
    ]
  );

do $forward_rollback_audit_and_assertion$
declare
  v_principal public.pandora_service_principals%rowtype;
  v_audit_id uuid;
  v_exact_audit_count integer;
  v_write_principal_count integer;
  v_scope_constraint_count integer;
  v_activation_metadata jsonb;
begin
  select *
    into v_principal
  from public.pandora_service_principals
  where principal_key = 'projectos-mcpmaster-production';

  if not found
     or not (
       v_principal.scopes <@ array['memory:health', 'memory:read']::text[]
       and array['memory:health', 'memory:read']::text[] <@ v_principal.scopes
     ) then
    raise exception 'projectos evidence forward rollback failed: exact scope readback mismatch';
  end if;

  select count(*)::integer
    into v_scope_constraint_count
  from pg_constraint
  where conrelid = 'public.pandora_service_principals'::regclass
    and conname = 'pandora_service_principals_scopes_check'
    and contype = 'c'
    and convalidated
    and pg_get_constraintdef(oid, true) =
      'CHECK (scopes <@ ARRAY[''memory:health''::text, ''memory:read''::text])';

  if v_scope_constraint_count <> 1 then
    raise exception 'projectos evidence forward rollback failed: exact scope constraint readback mismatch';
  end if;

  select count(*)::integer
    into v_write_principal_count
  from public.pandora_service_principals
  where 'memory:write' = any(scopes);

  if v_write_principal_count <> 0 then
    raise exception 'projectos evidence forward rollback failed: write scope remains';
  end if;

  select metadata
    into v_activation_metadata
  from public.audit_logs
  where action = 'projectos_evidence_candidate_write_scope_activated'
    and table_name = 'pandora_service_principals'
    and metadata ->> 'activation_id' =
      'memory-evidence-atomic-successor-prod-activation-20260821';

  if not found then
    raise exception 'projectos evidence forward rollback failed: activation authorization missing';
  end if;

  insert into public.audit_logs (
    user_id,
    namespace,
    action,
    table_name,
    record_id,
    before_snapshot,
    after_snapshot,
    metadata
  ) values (
    v_principal.memory_user_id,
    'real_life',
    'projectos_evidence_candidate_write_scope_deactivated',
    'pandora_service_principals',
    v_principal.id,
    jsonb_build_object(
      'scopes', to_jsonb(array['memory:health', 'memory:read', 'memory:write']::text[])
    ),
    jsonb_build_object(
      'scopes', to_jsonb(array['memory:health', 'memory:read']::text[])
    ),
    jsonb_build_object(
      'rollback_id', 'memory-evidence-atomic-successor-prod-rollback-20260821',
      'activation_id', 'memory-evidence-atomic-successor-prod-activation-20260821',
      'authorization_id', v_activation_metadata ->> 'authorization_id',
      'authorized_head', v_activation_metadata ->> 'authorized_head',
      'authorized_tree', v_activation_metadata ->> 'authorized_tree',
      'independent_review_id', v_activation_metadata ->> 'independent_review_id',
      'independent_review_verdict', v_activation_metadata ->> 'independent_review_verdict',
      'issue_56_predecessor_only', true,
      'issue_56_authorizes_successor', false,
      'atomic_migration', '20260821160000_submit_projectos_evidence_candidate_atomic',
      'atomic_migration_sha256', 'ed97a4254879c1acea18a08aefa3dce0612339bdf1b55dc64df015aa3479af81',
      'forward_migration', '20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope',
      'bridge_index_sha256', '383c1cac600f0381aba21fe492bc5d04777a91e361ba5bd2ac0e088449103d83',
      'import_map_sha256', '5089831e8691c1b4183e7d5f5c0703ca861d4bb46d5fc7f8dbee0c0f76d3a88b',
      'rollback_source_commit', '523fec111bfb2c327f69c2abdf0784775ab49a90',
      'canonical_project_key', 'mcpmaster-pandoras-box',
      'preserve_pending_candidates', true,
      'canonical_memory_deleted', false,
      'privacy_policy', 'metadata_only_v2_fail_closed'
    )
  )
  returning id into v_audit_id;

  if v_audit_id is null then
    raise exception 'projectos evidence forward rollback failed: audit insert missing';
  end if;

  select count(*)::integer
    into v_exact_audit_count
  from public.audit_logs
  where id = v_audit_id
    and user_id = v_principal.memory_user_id
    and namespace = 'real_life'
    and action = 'projectos_evidence_candidate_write_scope_deactivated'
    and table_name = 'pandora_service_principals'
    and record_id = v_principal.id
    and before_snapshot = jsonb_build_object(
      'scopes', to_jsonb(array['memory:health', 'memory:read', 'memory:write']::text[])
    )
    and after_snapshot = jsonb_build_object(
      'scopes', to_jsonb(array['memory:health', 'memory:read']::text[])
    )
    and metadata ->> 'rollback_id' =
      'memory-evidence-atomic-successor-prod-rollback-20260821'
    and metadata ->> 'activation_id' =
      'memory-evidence-atomic-successor-prod-activation-20260821'
    and metadata ->> 'authorization_id' =
      'memory-evidence-atomic-successor-exact-artifact-authorization'
    and metadata ->> 'authorized_head' = v_activation_metadata ->> 'authorized_head'
    and metadata ->> 'authorized_tree' = v_activation_metadata ->> 'authorized_tree'
    and metadata ->> 'independent_review_id' = v_activation_metadata ->> 'independent_review_id'
    and metadata ->> 'independent_review_verdict' = 'PASS'
    and metadata ->> 'issue_56_predecessor_only' = 'true'
    and metadata ->> 'issue_56_authorizes_successor' = 'false'
    and metadata ->> 'atomic_migration_sha256' = 'ed97a4254879c1acea18a08aefa3dce0612339bdf1b55dc64df015aa3479af81'
    and metadata ->> 'forward_migration' = '20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope'
    and metadata ->> 'bridge_index_sha256' = '383c1cac600f0381aba21fe492bc5d04777a91e361ba5bd2ac0e088449103d83';

  if v_exact_audit_count <> 1 then
    raise exception 'projectos evidence forward rollback failed: exact audit readback mismatch';
  end if;
end;
$forward_rollback_audit_and_assertion$;

comment on constraint pandora_service_principals_scopes_check
  on public.pandora_service_principals
  is 'Allowlisted Memory workload scopes. Evidence-candidate write scope is disabled.';

commit;
