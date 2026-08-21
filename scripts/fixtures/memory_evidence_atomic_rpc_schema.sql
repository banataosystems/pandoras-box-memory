\set ON_ERROR_STOP on

do $test_database_safety_assertion$
begin
  if current_database() !~ '^memory_evidence_atomic_rpc_test_[0-9]+$' then
    raise exception 'atomic RPC schema fixture refuses a non-test database';
  end if;
end;
$test_database_safety_assertion$;

drop schema if exists public cascade;
drop schema if exists auth cascade;
drop schema if exists supabase_migrations cascade;
create schema public;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth;
create schema if not exists supabase_migrations;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'untrusted_rpc_role') then
    create role untrusted_rpc_role nologin;
  end if;
end;
$roles$;

alter role service_role bypassrls;

create or replace function auth.uid()
returns uuid
language sql
stable
as $function$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$function$;

grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

create type public.pandora_namespace as enum ('real_life', 'au');

create table auth.users (
  id uuid primary key
);

create table public.pandora_service_principals (
  id uuid primary key default gen_random_uuid(),
  principal_key text not null unique,
  provider text not null,
  environment text not null,
  project_name text not null,
  project_id text not null,
  memory_user_id uuid not null references auth.users(id),
  allowed_namespaces text[] not null,
  scopes text[] not null,
  is_active boolean not null,
  updated_at timestamptz not null default now()
);

alter table public.pandora_service_principals
  add constraint pandora_service_principals_scopes_check
  check (scopes <@ array['memory:health', 'memory:read']::text[]);

create table public.pandora_projects (
  id uuid primary key,
  project_key text not null unique,
  memory_namespace text not null,
  lifecycle_status text not null
);

create table public.pandora_project_grants (
  principal_key text not null,
  project_id uuid not null references public.pandora_projects(id),
  environment text not null,
  is_active boolean not null,
  can_read boolean not null,
  can_propose boolean not null,
  can_approve boolean not null,
  revoked_at timestamptz,
  primary key (principal_key, project_id, environment)
);

create table public.memory_capture_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  namespace text not null,
  source text not null,
  source_ref text,
  raw_excerpt text,
  redacted_excerpt text,
  memory_type text,
  title text,
  summary text,
  importance integer,
  sensitivity text,
  confidence numeric,
  should_capture boolean,
  requires_review boolean,
  status text default 'pending',
  reason text,
  people jsonb default '[]'::jsonb,
  projects jsonb default '[]'::jsonb,
  risks jsonb default '[]'::jsonb,
  tags jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  usefulness_score numeric,
  confidence_score numeric,
  freshness_score numeric,
  retrieval_weight numeric,
  stale_status text,
  scoring_version text,
  scored_at timestamptz
);

create unique index memory_capture_candidates_projectos_source_unique
  on public.memory_capture_candidates (user_id, namespace, source, source_ref)
  where source = 'projectos-post-task' and source_ref is not null;

create table public.memory_review_queue_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  namespace text not null,
  status text not null,
  candidate_type text not null,
  normalized_text text not null,
  evidence_snapshot jsonb not null,
  sensitivity_snapshot jsonb not null,
  namespace_snapshot jsonb not null,
  source_metadata jsonb not null,
  audit_metadata jsonb not null,
  append_only boolean not null default true,
  proposed_operation text not null default 'append',
  requires_review boolean not null default true,
  source_ref text,
  request_hash text,
  fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  persistence_execution_metadata jsonb not null default '{}'::jsonb
);

create unique index memory_review_queue_items_projectos_source_unique
  on public.memory_review_queue_items (user_id, namespace, source_ref)
  where candidate_type = 'projectos_outcome' and source_ref is not null;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  namespace public.pandora_namespace,
  action text not null,
  table_name text not null,
  record_id uuid,
  before_snapshot jsonb,
  after_snapshot jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table supabase_migrations.schema_migrations (
  version text primary key,
  name text not null,
  statements text[] not null default '{}'::text[]
);

alter table public.memory_capture_candidates enable row level security;
create policy memory_capture_candidates_user_scoped
  on public.memory_capture_candidates
  for all
  to public
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.memory_review_queue_items enable row level security;
create policy memory_review_queue_items_insert_own
  on public.memory_review_queue_items
  for insert
  to authenticated
  with check (user_id = auth.uid());

alter table public.audit_logs enable row level security;
create policy audit_logs_insert_own
  on public.audit_logs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.memory_capture_candidates
  to authenticated;
grant insert on public.memory_review_queue_items to authenticated;
grant insert on public.audit_logs to authenticated;
grant select, insert, update, delete on public.memory_capture_candidates
  to service_role;
grant select, insert, update, delete on public.memory_review_queue_items
  to service_role;
grant select, insert, update, delete on public.audit_logs to service_role;
grant truncate, trigger on public.memory_capture_candidates,
  public.memory_review_queue_items,
  public.audit_logs to service_role;

insert into auth.users (id)
values ('11111111-1111-4111-8111-111111111111');

insert into public.pandora_service_principals (
  principal_key,
  provider,
  environment,
  project_name,
  project_id,
  memory_user_id,
  allowed_namespaces,
  scopes,
  is_active
) values (
  'projectos-mcpmaster-production',
  'vercel_oidc',
  'production',
  'mcpmaster',
  'prj_Y5rZVcq8xJVzHVt4uvfmg9wPvXMk',
  '11111111-1111-4111-8111-111111111111',
  array['real_life']::text[],
  array['memory:health', 'memory:read']::text[],
  true
);

insert into public.pandora_projects (
  id,
  project_key,
  memory_namespace,
  lifecycle_status
) values (
  '7c686cbd-d968-49d5-86cc-918f5e777bd2',
  'mcpmaster-pandoras-box',
  'real_life',
  'active'
);

insert into public.pandora_project_grants (
  principal_key,
  project_id,
  environment,
  is_active,
  can_read,
  can_propose,
  can_approve,
  revoked_at
) values (
  'projectos-mcpmaster-production',
  '7c686cbd-d968-49d5-86cc-918f5e777bd2',
  'production',
  true,
  true,
  true,
  false,
  null
);
