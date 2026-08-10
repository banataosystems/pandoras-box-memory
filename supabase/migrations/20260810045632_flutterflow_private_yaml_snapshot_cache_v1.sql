create table if not exists private.flutterflow_project_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  project_name text not null,
  partitioner_version integer,
  schema_fingerprint text,
  file_count integer not null default 0,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists private.flutterflow_project_yaml_files (
  snapshot_id uuid not null references private.flutterflow_project_snapshots(id) on delete cascade,
  file_key text not null,
  content text not null,
  sha256 text not null,
  byte_length integer not null,
  primary key (snapshot_id, file_key)
);

revoke all on private.flutterflow_project_snapshots from public, anon, authenticated;
revoke all on private.flutterflow_project_yaml_files from public, anon, authenticated;
grant select,insert,update,delete on private.flutterflow_project_snapshots to service_role;
grant select,insert,update,delete on private.flutterflow_project_yaml_files to service_role;
