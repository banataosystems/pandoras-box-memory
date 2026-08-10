create or replace function public.get_flutterflow_snapshot_file(
  p_snapshot_id uuid,
  p_file_key text
) returns text
language sql
security definer
set search_path = ''
as $$
  select f.content
  from private.flutterflow_project_yaml_files f
  where f.snapshot_id = p_snapshot_id
    and f.file_key = p_file_key
  limit 1;
$$;

revoke all on function public.get_flutterflow_snapshot_file(uuid,text) from public, anon, authenticated;
grant execute on function public.get_flutterflow_snapshot_file(uuid,text) to service_role;
