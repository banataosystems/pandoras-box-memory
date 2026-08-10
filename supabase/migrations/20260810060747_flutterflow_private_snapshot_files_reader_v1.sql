create or replace function public.get_flutterflow_snapshot_files(
  p_snapshot_id uuid
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(f.file_key, f.content order by f.file_key), '{}'::jsonb)
  from private.flutterflow_project_yaml_files f
  where f.snapshot_id = p_snapshot_id;
$$;

revoke all on function public.get_flutterflow_snapshot_files(uuid) from public, anon, authenticated;
grant execute on function public.get_flutterflow_snapshot_files(uuid) to service_role;
