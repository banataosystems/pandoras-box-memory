\set ON_ERROR_STOP on

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth;

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
end;
$roles$;

create type public.pandora_namespace as enum ('real_life', 'au');

create table auth.users (
  id uuid primary key
);

create table public.pandora_service_principals (
  principal_key text primary key,
  environment text not null,
  memory_user_id uuid not null references auth.users(id),
  allowed_namespaces text[] not null,
  scopes text[] not null,
  is_active boolean not null
);

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

insert into auth.users (id)
values ('11111111-1111-4111-8111-111111111111');

insert into public.pandora_service_principals (
  principal_key,
  environment,
  memory_user_id,
  allowed_namespaces,
  scopes,
  is_active
) values (
  'projectos-mcpmaster-production',
  'production',
  '11111111-1111-4111-8111-111111111111',
  array['real_life']::text[],
  array['memory:health', 'memory:read', 'memory:write']::text[],
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
  can_propose,
  can_approve,
  revoked_at
) values (
  'projectos-mcpmaster-production',
  '7c686cbd-d968-49d5-86cc-918f5e777bd2',
  'production',
  true,
  true,
  false,
  null
);
