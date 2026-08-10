-- Sanitized recovery form of the live 20260808220117 migration.
-- The production migration also inserted one owner-specific recovery audit row.
-- That principal UUID is runtime/audit data and is intentionally not copied into
-- the public canonical source. Schema and privilege effects are preserved here.

create table if not exists private.pandora_recovery_auth_changes (
  id uuid primary key default gen_random_uuid(),
  changed_at timestamptz not null default now(),
  user_id uuid not null,
  change_type text not null,
  details jsonb not null default '{}'::jsonb
);

revoke all on private.pandora_recovery_auth_changes from anon, authenticated;
grant select, insert on private.pandora_recovery_auth_changes to service_role;

-- Historical owner-specific audit INSERT intentionally omitted from source.
