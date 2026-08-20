begin;

do $migration$
declare
  v_scopes text[];
begin
  select scopes
    into v_scopes
  from public.pandora_service_principals
  where principal_key = 'projectos-mcpmaster-production'
    and is_active is true
  for update;

  if v_scopes is null then
    raise exception 'projectos_memory_principal_missing' using errcode = '55000';
  end if;

  if not ('memory:health' = any(v_scopes))
     or not ('memory:read' = any(v_scopes)) then
    raise exception 'projectos_memory_principal_baseline_scope_missing' using errcode = '55000';
  end if;

  if exists (
    select 1
    from unnest(v_scopes) as granted(scope)
    where scope <> all (array['memory:health', 'memory:read']::text[])
  ) then
    raise exception 'projectos_memory_principal_unexpected_scope' using errcode = '55000';
  end if;
end
$migration$;

alter table public.pandora_service_principals
  drop constraint pandora_service_principals_scopes_check;

alter table public.pandora_service_principals
  add constraint pandora_service_principals_scopes_check
  check (
    scopes <@ array[
      'memory:health',
      'memory:read',
      'memory:evidence-candidate:submit'
    ]::text[]
  );

update public.pandora_service_principals
set
  scopes = array_append(scopes, 'memory:evidence-candidate:submit'),
  updated_at = now()
where principal_key = 'projectos-mcpmaster-production'
  and is_active is true
  and not ('memory:evidence-candidate:submit' = any(scopes));

do $migration$
declare
  v_scopes text[];
begin
  select scopes
    into v_scopes
  from public.pandora_service_principals
  where principal_key = 'projectos-mcpmaster-production'
    and is_active is true;

  if v_scopes is null
     or not ('memory:health' = any(v_scopes))
     or not ('memory:read' = any(v_scopes))
     or not ('memory:evidence-candidate:submit' = any(v_scopes))
     or 'memory:write' = any(v_scopes)
     or exists (
       select 1
       from unnest(v_scopes) as granted(scope)
       where scope <> all (
         array['memory:health', 'memory:read', 'memory:evidence-candidate:submit']::text[]
       )
     ) then
    raise exception 'projectos_memory_candidate_scope_verification_failed' using errcode = '55000';
  end if;
end
$migration$;

comment on constraint pandora_service_principals_scopes_check
on public.pandora_service_principals
is 'ProjectOS Memory workload may health/read and submit review-gated evidence candidates; broad memory:write remains disallowed.';

commit;
