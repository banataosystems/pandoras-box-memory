begin;

create table if not exists public.gateway_service_actions (
  service_key text not null,
  action_key text not null,
  capability_class text not null check (capability_class in ('read','validate','write','export','admin')),
  approval_required boolean not null default false,
  enabled boolean not null default false,
  provider_status text not null default 'planned' check (provider_status in ('planned','implemented','tested','production_verified')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(service_key, action_key)
);

alter table public.gateway_service_actions enable row level security;
revoke all on public.gateway_service_actions from public, anon, authenticated;
grant select, insert, update, delete on public.gateway_service_actions to service_role;

insert into public.gateway_service_actions(service_key, action_key, capability_class, approval_required, enabled, provider_status, metadata)
values
  ('pandora_memory','health','read',false,true,'implemented','{"surface":"mcp"}'::jsonb),
  ('pandora_memory','search','read',false,true,'implemented','{"surface":"mcp","canon_only":true}'::jsonb),
  ('projectos','inspect','read',false,false,'planned','{}'::jsonb),
  ('github','repo.read','read',false,false,'planned','{}'::jsonb),
  ('github','repo.write','write',true,false,'planned','{}'::jsonb),
  ('vercel','deployment.read','read',false,false,'planned','{}'::jsonb),
  ('vercel','deploy','write',true,false,'planned','{}'::jsonb),
  ('supabase','inspect','read',false,false,'planned','{}'::jsonb),
  ('supabase','schema.write','admin',true,false,'planned','{}'::jsonb),
  ('posthog','analytics.read','read',false,false,'planned','{}'::jsonb),
  ('resend','delivery.read','read',false,false,'planned','{}'::jsonb),
  ('resend','email.send','write',true,false,'planned','{}'::jsonb),
  ('flutterflow','project.list','read',false,false,'planned','{"api":"project_api_v2_beta"}'::jsonb),
  ('flutterflow','yaml.files.list','read',false,false,'planned','{"api":"project_api_v2_beta"}'::jsonb),
  ('flutterflow','yaml.read','read',false,false,'planned','{"api":"project_api_v2_beta"}'::jsonb),
  ('flutterflow','yaml.validate','validate',false,false,'planned','{"api":"project_api_v2_beta"}'::jsonb),
  ('flutterflow','yaml.update','write',true,false,'planned','{"api":"project_api_v2_beta"}'::jsonb),
  ('flutterflow','code.export','export',true,false,'planned','{"transport":"flutterflow_cli_or_supported_export"}'::jsonb)
on conflict(service_key, action_key) do update set
  capability_class = excluded.capability_class,
  approval_required = excluded.approval_required,
  metadata = excluded.metadata,
  updated_at = now();

create or replace function public.gateway_authorize_oauth(
  p_user_id uuid,
  p_client_id text,
  p_service_key text,
  p_action_key text,
  p_environment text,
  p_resource_key text default null
)
returns table(principal_id uuid, principal_key text, allowed boolean, reason_code text)
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  with a as (
    select 1
    from public.gateway_service_actions gsa
    where gsa.service_key = p_service_key
      and gsa.action_key = p_action_key
      and gsa.enabled
    limit 1
  ), p as (
    select gp.id, gp.principal_key
    from public.gateway_principals gp
    where gp.principal_type = 'oauth_user_client'
      and gp.user_id = p_user_id
      and gp.oauth_client_id = p_client_id
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
      and exists(select 1 from a)
    limit 1
  )
  select
    p.id,
    p.principal_key,
    exists(select 1 from g),
    case
      when not exists(select 1 from a) then 'capability_not_enabled'
      when p.id is null then 'unknown_principal'
      when exists(select 1 from g) then 'authorized'
      else 'missing_grant'
    end
  from (select 1) seed
  left join p on true;
$$;

revoke all on function public.gateway_authorize_oauth(uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.gateway_authorize_oauth(uuid,text,text,text,text,text) to service_role;

commit;
