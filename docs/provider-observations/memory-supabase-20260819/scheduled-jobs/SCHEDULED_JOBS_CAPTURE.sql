with current_jobs as (
  select
    j.jobid::bigint as job_id,
    j.jobname as name,
    j.schedule,
    j.database,
    j.username,
    j.active,
    octet_length(convert_to(j.command, 'UTF8'))::int as command_bytes,
    encode(extensions.digest(convert_to(j.command, 'UTF8'), 'sha256'), 'hex') as command_sha256,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('version', sm.version::text, 'name', sm.name)
        order by sm.version
      )
      from supabase_migrations.schema_migrations sm
      where exists (
        select 1
        from unnest(sm.statements) statement
        where position(j.jobname in statement) > 0
           or position(j.command in statement) > 0
      )
    ), '[]'::jsonb) as migration_sources,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'schema', n.nspname,
          'name', p.proname,
          'signature', pg_get_function_identity_arguments(p.oid),
          'owner', pg_get_userbyid(p.proowner),
          'security_definer', p.prosecdef,
          'volatility', p.provolatile::text,
          'search_path', coalesce((
            select split_part(setting, '=', 2)
            from unnest(coalesce(p.proconfig, array[]::text[])) setting
            where setting like 'search_path=%'
            limit 1
          ), ''),
          'definition_sha256', encode(extensions.digest(convert_to(pg_get_functiondef(p.oid), 'UTF8'), 'sha256'), 'hex'),
          'has_on_conflict', position('ON CONFLICT' in upper(pg_get_functiondef(p.oid))) > 0,
          'has_advisory_lock', position('ADVISORY' in upper(pg_get_functiondef(p.oid))) > 0,
          'has_skip_locked', position('SKIP LOCKED' in upper(pg_get_functiondef(p.oid))) > 0,
          'has_exception_block', position('EXCEPTION' in upper(pg_get_functiondef(p.oid))) > 0
        )
        order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
      )
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and (
          position(format('%I.%I', n.nspname, p.proname) in j.command) > 0
          or position(p.proname || '(' in j.command) > 0
        )
    ), '[]'::jsonb) as referenced_functions
  from cron.job j
  order by j.jobid
), run_rows as (
  select
    r.jobid::bigint as job_id,
    r.start_time,
    r.end_time,
    r.status,
    r.command,
    lag(r.end_time) over (partition by r.jobid order by r.start_time, r.runid) as prior_end
  from cron.job_run_details r
  where r.start_time >= transaction_timestamp() - interval '7 days'
), run_stats as (
  select
    job_id,
    count(*)::bigint as run_count,
    min(start_time) as first_start,
    max(start_time) as last_start,
    max(end_time) as last_end,
    count(*) filter (where status = 'succeeded')::bigint as succeeded_count,
    count(*) filter (where status = 'failed')::bigint as failed_count,
    count(*) filter (where status not in ('succeeded', 'failed'))::bigint as other_status_count,
    count(*) filter (where prior_end is not null and prior_end > start_time)::bigint as overlap_count,
    round(max(extract(epoch from (end_time - start_time)) * 1000)::numeric, 3) as max_duration_ms,
    round(avg(extract(epoch from (end_time - start_time)) * 1000)::numeric, 3) as avg_duration_ms,
    octet_length(convert_to(min(command), 'UTF8'))::int as command_bytes,
    encode(extensions.digest(convert_to(min(command), 'UTF8'), 'sha256'), 'hex') as command_sha256
  from run_rows
  group by job_id
), payload as (
  select jsonb_build_object(
    'schema_version', '1.0.0',
    'capture_epoch', timezone('utc', transaction_timestamp()),
    'project_ref', 'ivmvufhcsezyhczzondn',
    'database', current_database(),
    'server_version', current_setting('server_version'),
    'capture_role', current_user,
    'transaction_snapshot', txid_current_snapshot(),
    'current_jobs', jsonb_build_object(
      'row_count', (select count(*) from current_jobs),
      'active_count', (select count(*) from current_jobs where active),
      'inactive_count', (select count(*) from current_jobs where not active),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'job_id', job_id,
          'name', name,
          'schedule', schedule,
          'database', database,
          'username', username,
          'active', active,
          'command_bytes', command_bytes,
          'command_sha256', command_sha256,
          'migration_sources', migration_sources,
          'referenced_functions', referenced_functions
        ) order by job_id)
        from current_jobs
      ), '[]'::jsonb)
    ),
    'run_history_7d', jsonb_build_object(
      'distinct_job_id_count', (select count(*) from run_stats),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'job_id', s.job_id,
          'currently_present', exists(select 1 from current_jobs c where c.job_id = s.job_id),
          'run_count', s.run_count,
          'first_start', s.first_start,
          'last_start', s.last_start,
          'last_end', s.last_end,
          'succeeded_count', s.succeeded_count,
          'failed_count', s.failed_count,
          'other_status_count', s.other_status_count,
          'overlap_count', s.overlap_count,
          'max_duration_ms', s.max_duration_ms,
          'avg_duration_ms', s.avg_duration_ms,
          'command_bytes', s.command_bytes,
          'command_sha256', s.command_sha256
        ) order by s.job_id)
        from run_stats s
      ), '[]'::jsonb)
    ),
    'privacy', jsonb_build_object(
      'raw_commands_included', false,
      'return_messages_included', false,
      'secret_values_included', false
    )
  ) as body
)
select
  body::text as payload_canonical_json,
  octet_length(convert_to(body::text, 'UTF8'))::int as payload_bytes,
  encode(extensions.digest(convert_to(body::text, 'UTF8'), 'sha256'), 'hex') as payload_sha256
from payload;