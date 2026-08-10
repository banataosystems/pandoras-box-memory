create or replace function public.get_flutterflow_project_api_secret()
returns table(token text, project_id text, project_name text, verified_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  with stored as (
    select ds.decrypted_secret as token,
           c.project_id,
           c.project_name,
           c.verified_at,
           1 as priority
    from private.flutterflow_integration_credentials c
    join vault.decrypted_secrets ds on ds.id = c.vault_secret_id
    where c.integration_key = 'flutterflow_project_api'
    limit 1
  ), manual as (
    select ds.decrypted_secret as token,
           null::text as project_id,
           null::text as project_name,
           null::timestamptz as verified_at,
           2 as priority
    from vault.decrypted_secrets ds
    where ds.name = 'pandora_flutterflow_project_api'
    order by ds.created_at desc
    limit 1
  )
  select token, project_id, project_name, verified_at
  from (
    select * from stored
    union all
    select * from manual
  ) s
  order by priority
  limit 1;
$$;

revoke all on function public.get_flutterflow_project_api_secret() from public, anon, authenticated;
grant execute on function public.get_flutterflow_project_api_secret() to service_role;
