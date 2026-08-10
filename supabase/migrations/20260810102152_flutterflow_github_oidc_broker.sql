create table if not exists private.flutterflow_github_oidc_grants (
  id uuid primary key default gen_random_uuid(),
  repository text not null,
  repository_id text not null,
  repository_owner_id text not null,
  workflow_ref text not null,
  ref text not null,
  sha text not null,
  audience text not null,
  expected_actor_id text not null,
  expected_run_id text not null,
  expected_run_attempt integer not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_jti_sha256 text,
  created_at timestamptz not null default now(),
  constraint flutterflow_github_oidc_grants_sha_format
    check (sha ~ '^[0-9a-f]{40}$'),
  constraint flutterflow_github_oidc_grants_short_lived
    check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint flutterflow_github_oidc_grants_attempt_positive
    check (expected_run_attempt > 0),
  unique (sha, expected_run_id, expected_run_attempt)
);

create index if not exists flutterflow_github_oidc_grants_pending_idx
  on private.flutterflow_github_oidc_grants (sha, expires_at)
  where consumed_at is null;

comment on table private.flutterflow_github_oidc_grants is
  'Short-lived, exact-commit GitHub OIDC grants for unattended FlutterFlow Project API work.';

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
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

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

alter table private.flutterflow_github_oidc_grants enable row level security;
revoke all on table private.flutterflow_github_oidc_grants
  from public, anon, authenticated, service_role;
revoke all on function public.consume_flutterflow_github_oidc_grant(
  text,text,text,text,text,text,text,text,text,text,integer
) from public, anon, authenticated;
grant execute on function public.consume_flutterflow_github_oidc_grant(
  text,text,text,text,text,text,text,text,text,text,integer
) to service_role;
