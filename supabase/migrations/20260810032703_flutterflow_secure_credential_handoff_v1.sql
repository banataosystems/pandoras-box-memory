create table if not exists private.flutterflow_credential_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  code_sha256 text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists private.flutterflow_integration_credentials (
  integration_key text primary key,
  user_id uuid not null,
  vault_secret_id uuid not null,
  project_id text,
  project_name text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.consume_flutterflow_credential_handoff(
  p_code_sha256 text,
  p_token text,
  p_project_id text,
  p_project_name text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff private.flutterflow_credential_handoffs%rowtype;
  v_secret_id uuid;
begin
  if p_token is null or length(trim(p_token)) < 20 then
    raise exception 'invalid_token_input';
  end if;

  select * into v_handoff
  from private.flutterflow_credential_handoffs
  where code_sha256 = p_code_sha256
    and consumed_at is null
    and expires_at > now()
  for update;

  if not found then
    return false;
  end if;

  select vault.create_secret(
    p_token,
    'pandora_flutterflow_project_api_' || v_handoff.id::text,
    'FlutterFlow Project API token for governed Pandora adapter'
  ) into v_secret_id;

  insert into private.flutterflow_integration_credentials(
    integration_key,user_id,vault_secret_id,project_id,project_name,verified_at
  ) values (
    'flutterflow_project_api',v_handoff.user_id,v_secret_id,p_project_id,p_project_name,now()
  )
  on conflict (integration_key) do update set
    user_id = excluded.user_id,
    vault_secret_id = excluded.vault_secret_id,
    project_id = excluded.project_id,
    project_name = excluded.project_name,
    verified_at = excluded.verified_at,
    updated_at = now();

  update private.flutterflow_credential_handoffs
  set consumed_at = now(),
      metadata = jsonb_build_object('project_id',p_project_id,'project_name',p_project_name,'verified',true)
  where id = v_handoff.id;

  return true;
end;
$$;

create or replace function public.get_flutterflow_project_api_secret()
returns table(token text, project_id text, project_name text, verified_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select ds.decrypted_secret,
         c.project_id,
         c.project_name,
         c.verified_at
  from private.flutterflow_integration_credentials c
  join vault.decrypted_secrets ds on ds.id = c.vault_secret_id
  where c.integration_key = 'flutterflow_project_api'
  limit 1;
$$;

revoke all on function public.consume_flutterflow_credential_handoff(text,text,text,text) from public, anon, authenticated;
revoke all on function public.get_flutterflow_project_api_secret() from public, anon, authenticated;
grant execute on function public.consume_flutterflow_credential_handoff(text,text,text,text) to service_role;
grant execute on function public.get_flutterflow_project_api_secret() to service_role;
