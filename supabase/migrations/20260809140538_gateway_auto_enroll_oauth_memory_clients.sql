create or replace function public.gateway_authorize_oauth(
  p_user_id uuid,
  p_client_id text,
  p_service_key text,
  p_action_key text,
  p_environment text,
  p_resource_key text default null
)
returns table(principal_id uuid, principal_key text, allowed boolean, reason_code text)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_principal_id uuid;
  v_principal_key text;
  v_capability_enabled boolean := false;
  v_allowed boolean := false;
begin
  select exists(
    select 1
    from public.gateway_service_actions gsa
    where gsa.service_key = p_service_key
      and gsa.action_key = p_action_key
      and gsa.enabled
  ) into v_capability_enabled;

  select gp.id, gp.principal_key
    into v_principal_id, v_principal_key
  from public.gateway_principals gp
  where gp.principal_type = 'oauth_user_client'
    and gp.user_id = p_user_id
    and gp.oauth_client_id = p_client_id
    and gp.is_active
  limit 1;

  if v_principal_id is null
     and v_capability_enabled
     and p_service_key = 'pandora_memory'
     and p_action_key in ('health','search')
     and p_environment = 'production'
     and p_client_id is not null
     and length(trim(p_client_id)) between 1 and 512
     and exists(select 1 from auth.users au where au.id = p_user_id)
  then
    v_principal_key := 'oauth:' || encode(digest(p_user_id::text || ':' || p_client_id, 'sha256'), 'hex');

    insert into public.gateway_principals(
      principal_key, principal_type, user_id, oauth_client_id,
      display_name, is_active, created_at, updated_at
    ) values (
      v_principal_key, 'oauth_user_client', p_user_id, p_client_id,
      'Owner-approved OAuth MCP client', true, now(), now()
    )
    on conflict (principal_key) do update
      set oauth_client_id = excluded.oauth_client_id,
          user_id = excluded.user_id,
          display_name = excluded.display_name,
          is_active = true,
          updated_at = now()
    returning id into v_principal_id;

    insert into public.gateway_grants(
      principal_id, service_key, action_pattern, environment,
      resource_pattern, is_active, created_at, updated_at
    ) values
      (v_principal_id, 'pandora_memory', 'health', 'production', null, true, now(), now()),
      (v_principal_id, 'pandora_memory', 'search', 'production', 'namespace:real_life', true, now(), now())
    on conflict (principal_id, service_key, action_pattern, environment, resource_pattern)
    do update set is_active = true, updated_at = now();
  end if;

  if v_principal_id is not null and v_capability_enabled then
    select exists(
      select 1
      from public.gateway_grants gg
      where gg.principal_id = v_principal_id
        and gg.is_active
        and gg.service_key = p_service_key
        and gg.environment = p_environment
        and (gg.action_pattern = p_action_key or gg.action_pattern = p_action_key || ':*')
        and (gg.resource_pattern is null or gg.resource_pattern = p_resource_key)
    ) into v_allowed;
  end if;

  return query
  select
    v_principal_id,
    v_principal_key,
    v_allowed,
    case
      when not v_capability_enabled then 'capability_not_enabled'
      when v_principal_id is null then 'unknown_principal'
      when v_allowed then 'authorized'
      else 'missing_grant'
    end;
end;
$$;
