create table if not exists private.flutterflow_github_oidc_attempts (
  id uuid primary key default gen_random_uuid(),
  repository text not null,
  ref text not null,
  sha text not null,
  workflow_ref text not null,
  actor_id text not null,
  run_id text not null,
  run_attempt integer not null,
  outcome text not null,
  created_at timestamptz not null default now(),
  constraint flutterflow_github_oidc_attempts_sha_format
    check (sha ~ '^[0-9a-f]{40}$'),
  constraint flutterflow_github_oidc_attempts_run_id_format
    check (run_id ~ '^[1-9][0-9]*$'),
  constraint flutterflow_github_oidc_attempts_attempt_positive
    check (run_attempt > 0),
  constraint flutterflow_github_oidc_attempts_outcome
    check (outcome in ('grant_miss')),
  unique (sha, run_id, run_attempt, outcome)
);

create index if not exists flutterflow_github_oidc_attempts_recent_idx
  on private.flutterflow_github_oidc_attempts (created_at desc);

comment on table private.flutterflow_github_oidc_attempts is
  'Non-secret workload metadata for denied FlutterFlow OIDC grant attempts.';

alter table private.flutterflow_github_oidc_attempts enable row level security;
revoke all on table private.flutterflow_github_oidc_attempts
  from public, anon, authenticated;

create or replace function public.record_flutterflow_github_oidc_attempt(
  p_repository text,
  p_ref text,
  p_sha text,
  p_workflow_ref text,
  p_actor_id text,
  p_run_id text,
  p_run_attempt integer,
  p_outcome text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  insert into private.flutterflow_github_oidc_attempts (
    repository,
    ref,
    sha,
    workflow_ref,
    actor_id,
    run_id,
    run_attempt,
    outcome
  ) values (
    p_repository,
    p_ref,
    p_sha,
    p_workflow_ref,
    p_actor_id,
    p_run_id,
    p_run_attempt,
    p_outcome
  )
  on conflict (sha, run_id, run_attempt, outcome) do nothing;
end;
$$;

revoke all on function public.record_flutterflow_github_oidc_attempt(
  text, text, text, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.record_flutterflow_github_oidc_attempt(
  text, text, text, text, text, text, integer, text
) to service_role;
