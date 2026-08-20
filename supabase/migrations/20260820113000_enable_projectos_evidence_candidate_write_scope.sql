-- Governed activation for review-gated ProjectOS evidence candidates.
-- This migration does not create projects, grants, candidates, review decisions,
-- or canonical Memory. It only permits the existing production workload identity
-- to propose evidence for its one existing allowlisted project.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.pandora_service_principals in share row exclusive mode;
lock table public.pandora_projects in share mode;
lock table public.pandora_project_grants in share mode;

do $activation_guard$
declare
  v_principal public.pandora_service_principals%rowtype;
  v_project public.pandora_projects%rowtype;
  v_grant public.pandora_project_grants%rowtype;
  v_other_active_can_propose integer;
begin
  select *
    into v_principal
  from public.pandora_service_principals
  where principal_key = 'projectos-mcpmaster-production';

  if not found then
    raise exception 'projectos evidence activation blocked: principal missing';
  end if;
  if not v_principal.is_active
     or v_principal.provider <> 'vercel_oidc'
     or v_principal.environment <> 'production'
     or v_principal.project_name <> 'mcpmaster'
     or v_principal.project_id <> 'prj_Y5rZVcq8xJVzHVt4uvfmg9wPvXMk' then
    raise exception 'projectos evidence activation blocked: principal identity drift';
  end if;
  if not (
    v_principal.allowed_namespaces <@ array['real_life']::text[]
    and array['real_life']::text[] <@ v_principal.allowed_namespaces
  ) then
    raise exception 'projectos evidence activation blocked: namespace scope drift';
  end if;
  if not (
    array['memory:health', 'memory:read']::text[] <@ v_principal.scopes
    and v_principal.scopes <@ array['memory:health', 'memory:read', 'memory:write']::text[]
  ) then
    raise exception 'projectos evidence activation blocked: unexpected principal scopes';
  end if;

  select *
    into v_project
  from public.pandora_projects
  where project_key = 'mcpmaster-pandoras-box';

  if not found
     or v_project.id <> '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid
     or v_project.memory_namespace <> 'real_life'
     or v_project.lifecycle_status <> 'active' then
    raise exception 'projectos evidence activation blocked: canonical project drift';
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
    raise exception 'projectos evidence activation blocked: governed project grant drift';
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
    raise exception 'projectos evidence activation blocked: additional proposal grants exist';
  end if;
end;
$activation_guard$;

alter table public.pandora_service_principals
  drop constraint if exists pandora_service_principals_scopes_check;

alter table public.pandora_service_principals
  add constraint pandora_service_principals_scopes_check
  check (
    scopes <@ array[
      'memory:health'::text,
      'memory:read'::text,
      'memory:write'::text
    ]
  );

update public.pandora_service_principals
set scopes = array['memory:health', 'memory:read', 'memory:write']::text[],
    updated_at = now()
where principal_key = 'projectos-mcpmaster-production';

do $activation_assertion$
declare
  v_scopes text[];
  v_count integer;
begin
  select scopes
    into v_scopes
  from public.pandora_service_principals
  where principal_key = 'projectos-mcpmaster-production';

  if v_scopes is null
     or not (
       v_scopes <@ array['memory:health', 'memory:read', 'memory:write']::text[]
       and array['memory:health', 'memory:read', 'memory:write']::text[] <@ v_scopes
     ) then
    raise exception 'projectos evidence activation failed: exact scope readback mismatch';
  end if;

  select count(*)::integer
    into v_count
  from public.pandora_project_grants
  where principal_key = 'projectos-mcpmaster-production'
    and project_id = '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid
    and environment = 'production'
    and is_active
    and revoked_at is null
    and can_read
    and can_propose
    and not can_approve;

  if v_count <> 1 then
    raise exception 'projectos evidence activation failed: exact grant readback mismatch';
  end if;
end;
$activation_assertion$;

comment on constraint pandora_service_principals_scopes_check
  on public.pandora_service_principals
  is 'Allowlisted Memory workload scopes. memory:write is review-gated candidate proposal only; it does not authorize canonical promotion.';

commit;
