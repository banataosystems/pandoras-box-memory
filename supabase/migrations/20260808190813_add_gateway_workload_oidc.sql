begin;

alter table public.gateway_principals
  add column if not exists oidc_audience text null;

alter table public.gateway_principals
  drop constraint if exists gateway_principals_identity_shape;

alter table public.gateway_principals
  add constraint gateway_principals_identity_shape check (
    (principal_type = 'oauth_user_client'
      and user_id is not null
      and oauth_client_id is not null)
    or
    (principal_type = 'workload_oidc'
      and user_id is not null
      and oidc_issuer is not null
      and oidc_audience is not null
      and oidc_subject is not null)
  );

create or replace function public.gateway_authorize_oidc(
  p_issuer text,
  p_audience text,
  p_subject text,
  p_service_key text,
  p_action_key text,
  p_environment text,
  p_resource_key text default null
)
returns table(
  principal_id uuid,
  principal_key text,
  user_id uuid,
  allowed boolean,
  reason_code text
)
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  with capability as (
    select enabled
    from public.gateway_service_actions gsa
    where gsa.service_key = p_service_key
      and gsa.action_key = p_action_key
    limit 1
  ), p as (
    select gp.id, gp.principal_key, gp.user_id
    from public.gateway_principals gp
    where gp.principal_type = 'workload_oidc'
      and gp.oidc_issuer = p_issuer
      and gp.oidc_audience = p_audience
      and gp.oidc_subject = p_subject
      and gp.is_active
    limit 1
  ), g as (
    select 1
    from p
    join public.gateway_grants gg on gg.principal_id = p.id
    where gg.is_active
      and gg.service_key = p_service_key
      and gg.environment = p_environment
      and (gg.action_pattern = p_action_key or gg.action_pattern = p_action_key || ':*')
      and (gg.resource_pattern is null or gg.resource_pattern = p_resource_key)
    limit 1
  )
  select
    p.id,
    p.principal_key,
    p.user_id,
    case
      when coalesce((select enabled from capability), false) = false then false
      when p.id is null then false
      else exists(select 1 from g)
    end,
    case
      when coalesce((select enabled from capability), false) = false then 'capability_not_enabled'
      when p.id is null then 'unknown_principal'
      when exists(select 1 from g) then 'authorized'
      else 'missing_grant'
    end
  from (select 1) seed
  left join p on true;
$$;

revoke all on function public.gateway_authorize_oidc(text,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.gateway_authorize_oidc(text,text,text,text,text,text,text)
  to service_role;

insert into public.gateway_principals (
  principal_key,
  principal_type,
  user_id,
  oidc_issuer,
  oidc_audience,
  oidc_subject,
  display_name,
  is_active
)
select
  'projectos-mcpmaster-production',
  'workload_oidc',
  psp.memory_user_id,
  psp.issuer,
  psp.audience,
  psp.subject,
  'ProjectOS via MCPMaster production',
  true
from public.pandora_service_principals psp
where psp.principal_key = 'projectos-mcpmaster-production'
  and psp.is_active
on conflict (principal_key) do update set
  principal_type = excluded.principal_type,
  user_id = excluded.user_id,
  oauth_client_id = null,
  oidc_issuer = excluded.oidc_issuer,
  oidc_audience = excluded.oidc_audience,
  oidc_subject = excluded.oidc_subject,
  display_name = excluded.display_name,
  is_active = true,
  updated_at = now();

insert into public.gateway_grants (
  principal_id,
  service_key,
  action_pattern,
  environment,
  resource_pattern,
  is_active
)
select gp.id, 'pandora_memory', 'health', 'production', null, true
from public.gateway_principals gp
where gp.principal_key = 'projectos-mcpmaster-production'
  and not exists (
    select 1
    from public.gateway_grants gg
    where gg.principal_id = gp.id
      and gg.service_key = 'pandora_memory'
      and gg.action_pattern = 'health'
      and gg.environment = 'production'
      and gg.resource_pattern is null
  );

insert into public.gateway_grants (
  principal_id,
  service_key,
  action_pattern,
  environment,
  resource_pattern,
  is_active
)
select gp.id, 'pandora_memory', 'search', 'production', 'namespace:real_life', true
from public.gateway_principals gp
where gp.principal_key = 'projectos-mcpmaster-production'
  and not exists (
    select 1
    from public.gateway_grants gg
    where gg.principal_id = gp.id
      and gg.service_key = 'pandora_memory'
      and gg.action_pattern = 'search'
      and gg.environment = 'production'
      and gg.resource_pattern = 'namespace:real_life'
  );

commit;
