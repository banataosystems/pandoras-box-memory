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
begin
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
    and metadata ->> 'activation_id' = 'memory-evidence-candidate-bridge-prod-activation-20260821'
    and metadata ->> 'governance_issue' = 'banataosystems/pandoras-box-memory#56';

  if v_activation_audit_count <> 1 then
    raise exception 'projectos evidence forward rollback blocked: activation audit mismatch';
  end if;

  select count(*)::integer
    into v_existing_rollback_audit_count
  from public.audit_logs
  where namespace = 'real_life'
    and metadata ->> 'rollback_id' = 'memory-evidence-candidate-bridge-prod-rollback-20260821';

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
      'rollback_id', 'memory-evidence-candidate-bridge-prod-rollback-20260821',
      'activation_id', 'memory-evidence-candidate-bridge-prod-activation-20260821',
      'governance_issue', 'banataosystems/pandoras-box-memory#56',
      'forward_migration', '20260821014442_forward_reactivate_projectos_evidence_candidate_write_scope',
      'rollback_source_commit', '523fec111bfb2c327f69c2abdf0784775ab49a90',
      'canonical_project_key', 'mcpmaster-pandoras-box',
      'preserve_pending_candidates', true,
      'canonical_memory_deleted', false,
      'privacy_policy', 'metadata_only_v1'
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
    and metadata ->> 'rollback_id' = 'memory-evidence-candidate-bridge-prod-rollback-20260821'
    and metadata ->> 'activation_id' = 'memory-evidence-candidate-bridge-prod-activation-20260821';

  if v_exact_audit_count <> 1 then
    raise exception 'projectos evidence forward rollback failed: exact audit readback mismatch';
  end if;
end;
$forward_rollback_audit_and_assertion$;

comment on constraint pandora_service_principals_scopes_check
  on public.pandora_service_principals
  is 'Allowlisted Memory workload scopes. Evidence-candidate write scope is disabled.';

commit;
