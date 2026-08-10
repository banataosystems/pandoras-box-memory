-- The Data API authorizes modern Supabase secret keys as service_role before
-- entering this function, but those keys do not populate the legacy
-- request.jwt.claim.role setting. Rely on the function privilege boundary
-- below instead of re-checking that legacy request setting inside the body.
create or replace function public.consume_flutterflow_github_oidc_grant(
  p_repository text,
  p_repository_id text,
  p_repository_owner_id text,
  p_workflow_ref text,
  p_ref text,
  p_sha text,
  p_audience text,
  p_actor_id text,
  p_jti_sha256 text,
  p_run_id text,
  p_run_attempt integer
) returns table(
  token text,
  project_id text,
  project_name text,
  verified_at timestamptz,
  grant_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant private.flutterflow_github_oidc_grants%rowtype;
  v_token text;
  v_project_id text;
  v_project_name text;
  v_verified_at timestamptz;
begin
  if p_jti_sha256 !~ '^[0-9a-f]{64}$'
     or p_sha !~ '^[0-9a-f]{40}$'
     or p_run_attempt < 1 then
    raise exception 'invalid_oidc_claims' using errcode = '22023';
  end if;

  select *
    into v_grant
  from private.flutterflow_github_oidc_grants
  where repository = p_repository
    and repository_id = p_repository_id
    and repository_owner_id = p_repository_owner_id
    and workflow_ref = p_workflow_ref
    and ref = p_ref
    and sha = p_sha
    and audience = p_audience
    and expected_actor_id = p_actor_id
    and expected_run_id = p_run_id
    and expected_run_attempt = p_run_attempt
    and consumed_at is null
    and expires_at > clock_timestamp()
    and created_at > clock_timestamp() - interval '15 minutes'
  order by created_at desc
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  select ds.decrypted_secret,
         credentials.project_id,
         credentials.project_name,
         credentials.verified_at
    into v_token, v_project_id, v_project_name, v_verified_at
  from private.flutterflow_integration_credentials credentials
  join vault.decrypted_secrets ds on ds.id = credentials.vault_secret_id
  where credentials.integration_key = 'flutterflow_project_api'
  limit 1;

  if v_token is null or length(v_token) < 20 then
    raise exception 'flutterflow_credential_unavailable';
  end if;

  update private.flutterflow_github_oidc_grants
  set consumed_at = clock_timestamp(),
      consumed_jti_sha256 = p_jti_sha256
  where id = v_grant.id;

  return query
  select v_token,
         v_project_id,
         v_project_name,
         v_verified_at,
         v_grant.id;
end;
$$;

revoke all on function public.consume_flutterflow_github_oidc_grant(
  text,text,text,text,text,text,text,text,text,text,integer
) from public, anon, authenticated, service_role;
grant execute on function public.consume_flutterflow_github_oidc_grant(
  text,text,text,text,text,text,text,text,text,text,integer
) to service_role;
