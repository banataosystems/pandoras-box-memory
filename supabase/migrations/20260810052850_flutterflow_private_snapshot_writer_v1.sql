create or replace function public.save_flutterflow_project_snapshot(
  p_project_id text,
  p_project_name text,
  p_partitioner_version integer,
  p_schema_fingerprint text,
  p_files jsonb,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot_id uuid;
  v_key text;
  v_content text;
begin
  if p_project_id is null or btrim(p_project_id) = '' then
    raise exception 'project_id_required';
  end if;
  if jsonb_typeof(p_files) <> 'object' then
    raise exception 'files_object_required';
  end if;

  insert into private.flutterflow_project_snapshots(
    project_id, project_name, partitioner_version, schema_fingerprint, file_count, metadata
  ) values (
    p_project_id,
    nullif(btrim(p_project_name), ''),
    p_partitioner_version,
    p_schema_fingerprint,
    (select count(*)::integer from jsonb_object_keys(p_files)),
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_snapshot_id;

  for v_key, v_content in
    select key, value #>> '{}'
    from jsonb_each(p_files)
  loop
    insert into private.flutterflow_project_yaml_files(snapshot_id, file_key, content, sha256, byte_length)
    values (
      v_snapshot_id,
      v_key,
      v_content,
      encode(extensions.digest(convert_to(v_content, 'UTF8'), 'sha256'), 'hex'),
      octet_length(v_content)
    );
  end loop;

  return v_snapshot_id;
end;
$$;

revoke all on function public.save_flutterflow_project_snapshot(text,text,integer,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_flutterflow_project_snapshot(text,text,integer,text,jsonb,jsonb) to service_role;
