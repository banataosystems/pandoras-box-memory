-- Superseded ProjectOS evidence-candidate activation.
--
-- This historical source migration is deliberately fail-closed. It must never
-- grant memory:write, widen the scope allowlist, or emit an activation audit.
-- The sole governed read-to-write transition lives in the later forward
-- activation, after the atomic RPC/provenance boundary and exact successor
-- authorization have been installed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.pandora_service_principals in share mode;
lock table public.pandora_projects in share mode;
lock table public.pandora_project_grants in share mode;

do $superseded_activation_read_only_assertion$
declare
  v_principal public.pandora_service_principals%rowtype;
  v_project public.pandora_projects%rowtype;
  v_grant public.pandora_project_grants%rowtype;
  v_write_principal_count integer;
  v_other_active_can_propose integer;
  v_scope_constraint_count integer;
  v_scope_constraint_definition text;
begin
  select *
    into v_principal
  from public.pandora_service_principals
  where principal_key = 'projectos-mcpmaster-production';

  if not found
     or not v_principal.is_active
     or v_principal.provider <> 'vercel_oidc'
     or v_principal.environment <> 'production'
     or v_principal.project_name <> 'mcpmaster'
     or v_principal.project_id <> 'prj_Y5rZVcq8xJVzHVt4uvfmg9wPvXMk'
     or v_principal.memory_user_id is null
     or not (
       v_principal.allowed_namespaces <@ array['real_life']::text[]
       and array['real_life']::text[] <@ v_principal.allowed_namespaces
     )
     or not (
       v_principal.scopes <@ array['memory:health', 'memory:read']::text[]
       and array['memory:health', 'memory:read']::text[] <@ v_principal.scopes
     ) then
    raise exception 'superseded projectos evidence activation blocked: exact read-only principal drift';
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
       'CHECK (scopes <@ ARRAY[''memory:health''::text, ''memory:read''::text])' then
    raise exception 'superseded projectos evidence activation blocked: read-only constraint drift';
  end if;

  select count(*)::integer
    into v_write_principal_count
  from public.pandora_service_principals
  where 'memory:write' = any(scopes);

  if v_write_principal_count <> 0 then
    raise exception 'superseded projectos evidence activation blocked: write scope already present';
  end if;

  select *
    into v_project
  from public.pandora_projects
  where project_key = 'mcpmaster-pandoras-box';

  if not found
     or v_project.id <> '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid
     or v_project.memory_namespace <> 'real_life'
     or v_project.lifecycle_status <> 'active' then
    raise exception 'superseded projectos evidence activation blocked: canonical project drift';
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
    raise exception 'superseded projectos evidence activation blocked: governed grant drift';
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
    raise exception 'superseded projectos evidence activation blocked: additional proposal grants exist';
  end if;
end;
$superseded_activation_read_only_assertion$;

comment on constraint pandora_service_principals_scopes_check
  on public.pandora_service_principals
  is 'Legacy ProjectOS evidence activation is superseded and remains read-only. Only the exact successor forward activation may add memory:write after atomic DB protections and independent authorization.';

commit;
