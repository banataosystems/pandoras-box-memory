begin;

create table if not exists public.gateway_principals (
  id uuid primary key default gen_random_uuid(),
  principal_key text not null unique,
  principal_type text not null check (principal_type in ('oauth_user_client','workload_oidc')),
  user_id uuid null,
  oauth_client_id text null,
  oidc_issuer text null,
  oidc_subject text null,
  display_name text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (principal_type = 'oauth_user_client' and user_id is not null and oauth_client_id is not null)
    or
    (principal_type = 'workload_oidc' and oidc_issuer is not null and oidc_subject is not null)
  )
);

create unique index if not exists gateway_principals_oauth_identity_uq
  on public.gateway_principals(user_id, oauth_client_id)
  where principal_type = 'oauth_user_client';

create unique index if not exists gateway_principals_oidc_identity_uq
  on public.gateway_principals(oidc_issuer, oidc_subject)
  where principal_type = 'workload_oidc';

create table if not exists public.gateway_grants (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references public.gateway_principals(id) on delete cascade,
  service_key text not null,
  action_pattern text not null,
  environment text not null default 'production',
  resource_pattern text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(principal_id, service_key, action_pattern, environment, resource_pattern)
);

create table if not exists public.gateway_audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  request_id uuid not null,
  principal_id uuid null references public.gateway_principals(id) on delete set null,
  principal_key text null,
  auth_mode text null,
  service_key text null,
  action_key text null,
  environment text null,
  resource_key text null,
  decision text not null check (decision in ('allow','deny','error')),
  reason_code text not null,
  latency_ms integer null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists gateway_audit_events_request_idx on public.gateway_audit_events(request_id);
create index if not exists gateway_audit_events_time_idx on public.gateway_audit_events(occurred_at desc);
create index if not exists gateway_audit_events_principal_idx on public.gateway_audit_events(principal_id, occurred_at desc);

alter table public.gateway_principals enable row level security;
alter table public.gateway_grants enable row level security;
alter table public.gateway_audit_events enable row level security;

revoke all on public.gateway_principals from public, anon, authenticated;
revoke all on public.gateway_grants from public, anon, authenticated;
revoke all on public.gateway_audit_events from public, anon, authenticated;

grant select, insert, update, delete on public.gateway_principals to service_role;
grant select, insert, update, delete on public.gateway_grants to service_role;
grant select, insert on public.gateway_audit_events to service_role;
grant usage, select on sequence public.gateway_audit_events_id_seq to service_role;

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
  with p as (
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
      and (
        gg.resource_pattern is null
        or gg.resource_pattern = p_resource_key
      )
    limit 1
  )
  select
    p.id,
    p.principal_key,
    exists(select 1 from g),
    case
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
