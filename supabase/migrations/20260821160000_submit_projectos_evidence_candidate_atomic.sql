begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $atomic_migration_authority_assertion$
begin
  if current_user::text in ('anon', 'authenticated', 'service_role') then
    raise exception using
      errcode = '42501',
      message = 'projectos evidence atomic migration requires a database owner role';
  end if;
end;
$atomic_migration_authority_assertion$;

lock table public.pandora_service_principals in share row exclusive mode;
lock table public.pandora_projects in share mode;
lock table public.pandora_project_grants in share mode;

do $atomic_read_only_activation_window_assertion$
declare
  v_principal public.pandora_service_principals%rowtype;
  v_project public.pandora_projects%rowtype;
  v_grant public.pandora_project_grants%rowtype;
  v_write_principal_count integer;
  v_other_active_can_propose integer;
  v_scope_constraint_count integer;
  v_scope_constraint_definition text;
begin
  select *
    into v_principal
  from public.pandora_service_principals
  where principal_key = 'projectos-mcpmaster-production';

  if not found
     or not v_principal.is_active
     or v_principal.provider <> 'vercel_oidc'
     or v_principal.environment <> 'production'
     or v_principal.project_name <> 'mcpmaster'
     or v_principal.project_id <> 'prj_Y5rZVcq8xJVzHVt4uvfmg9wPvXMk'
     or v_principal.memory_user_id is null
     or not (
       v_principal.allowed_namespaces <@ array['real_life']::text[]
       and array['real_life']::text[] <@ v_principal.allowed_namespaces
     )
     or not (
       v_principal.scopes <@ array['memory:health', 'memory:read']::text[]
       and array['memory:health', 'memory:read']::text[] <@ v_principal.scopes
     ) then
    raise exception 'projectos evidence atomic blocked: exact read-only principal drift';
  end if;

  select count(*)::integer, min(pg_get_constraintdef(oid, true))
    into v_scope_constraint_count, v_scope_constraint_definition
  from pg_constraint
  where conrelid = 'public.pandora_service_principals'::regclass
    and conname = 'pandora_service_principals_scopes_check'
    and contype = 'c'
    and convalidated;

  if v_scope_constraint_count <> 1
     or v_scope_constraint_definition <>
       'CHECK (scopes <@ ARRAY[''memory:health''::text, ''memory:read''::text])' then
    raise exception 'projectos evidence atomic blocked: read-only constraint drift';
  end if;

  select count(*)::integer
    into v_write_principal_count
  from public.pandora_service_principals
  where 'memory:write' = any(scopes);

  if v_write_principal_count <> 0 then
    raise exception 'projectos evidence atomic blocked: write scope already present';
  end if;

  select *
    into v_project
  from public.pandora_projects
  where project_key = 'mcpmaster-pandoras-box';

  if not found
     or v_project.id <> '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid
     or v_project.memory_namespace <> 'real_life'
     or v_project.lifecycle_status <> 'active' then
    raise exception 'projectos evidence atomic blocked: canonical project drift';
  end if;

  select *
    into v_grant
  from public.pandora_project_grants
  where principal_key = 'projectos-mcpmaster-production'
    and project_id = '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid
    and environment = 'production';

  if not found
     or not v_grant.is_active
     or v_grant.revoked_at is not null
     or not v_grant.can_read
     or not v_grant.can_propose
     or v_grant.can_approve then
    raise exception 'projectos evidence atomic blocked: governed project grant drift';
  end if;

  select count(*)::integer
    into v_other_active_can_propose
  from public.pandora_project_grants
  where principal_key = 'projectos-mcpmaster-production'
    and is_active
    and revoked_at is null
    and can_propose
    and (
      project_id <> '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid
      or environment <> 'production'
    );

  if v_other_active_can_propose <> 0 then
    raise exception 'projectos evidence atomic blocked: additional proposal grants exist';
  end if;
end;
$atomic_read_only_activation_window_assertion$;

-- Close the live authenticated INSERT/UPDATE/DELETE policy window before the
-- reserved ProjectOS lifecycle is introduced. Existing candidate/review rows,
-- atomic-created audits, successor authorization rows, or rows claiming this
-- successor activation cannot be distinguished from a forged pre-seed, so the
-- migration stops for explicit reconciliation instead of blessing them through
-- the idempotent replay path. Older activation/deactivation audit history is
-- preserved but is not accepted as successor authorization or deduplication
-- evidence; the guards below make it immutable prospectively.
lock table public.memory_capture_candidates in share row exclusive mode;
lock table public.memory_review_queue_items in share row exclusive mode;
lock table public.audit_logs in share row exclusive mode;

do $atomic_reserved_preseed_assertion$
begin
  if exists (
    select 1
    from public.memory_capture_candidates
    where source = 'projectos-post-task'
      and source_ref like 'projectos-evidence:%'
  ) or exists (
    select 1
    from public.memory_review_queue_items
    where candidate_type = 'projectos_outcome'
      and source_ref like 'projectos-evidence:%'
  ) or exists (
    select 1
    from public.audit_logs
    where (
      action = 'projectos_evidence_candidate_atomic_created'
      and table_name = 'memory_capture_candidates'
    ) or (
      action = 'projectos_evidence_successor_activation_authorized'
      and table_name = 'release_authorizations'
    ) or (
      action in (
        'projectos_evidence_candidate_write_scope_source_replay_activated',
        'projectos_evidence_candidate_write_scope_activated',
        'projectos_evidence_candidate_write_scope_deactivated'
      )
      and table_name = 'pandora_service_principals'
      and (
        metadata ->> 'activation_id' =
          'memory-evidence-atomic-successor-prod-activation-20260821'
        or metadata ->> 'rollback_id' =
          'memory-evidence-atomic-successor-prod-rollback-20260821'
      )
    )
  ) then
    raise exception 'projectos evidence atomic reserved preseed requires reconciliation';
  end if;
end;
$atomic_reserved_preseed_assertion$;

do $atomic_preexisting_trigger_assertion$
declare
  v_trigger_count integer;
begin
  select count(*)::integer
    into v_trigger_count
  from pg_catalog.pg_trigger t
  where t.tgrelid in (
      'public.memory_capture_candidates'::regclass,
      'public.memory_review_queue_items'::regclass,
      'public.audit_logs'::regclass
    )
    and not t.tgisinternal;

  if v_trigger_count <> 0 then
    raise exception 'projectos evidence atomic unexpected preexisting trigger requires reconciliation';
  end if;
end;
$atomic_preexisting_trigger_assertion$;

-- A successful ProjectOS evidence intake must have exactly one candidate,
-- exactly one pending-review row, and exactly one append-only audit record.
-- The RPC below owns that transaction boundary; the Edge Function must never
-- reproduce these writes as separate service-role requests.

create unique index if not exists audit_logs_projectos_evidence_candidate_atomic_unique
  on public.audit_logs (record_id)
  where action = 'projectos_evidence_candidate_atomic_created'
    and table_name = 'memory_capture_candidates';

do $atomic_audit_index_assertion$
declare
  v_is_unique boolean;
  v_predicate text;
  v_key_count smallint;
  v_key_definition text;
  v_has_expressions boolean;
  v_is_valid boolean;
  v_is_ready boolean;
  v_is_live boolean;
begin
  select
    i.indisunique,
    pg_get_expr(i.indpred, i.indrelid),
    i.indnkeyatts,
    pg_get_indexdef(i.indexrelid, 1, true),
    i.indexprs is not null,
    i.indisvalid,
    i.indisready,
    i.indislive
    into
      v_is_unique,
      v_predicate,
      v_key_count,
      v_key_definition,
      v_has_expressions,
      v_is_valid,
      v_is_ready,
      v_is_live
  from pg_catalog.pg_index i
  where i.indexrelid =
    'public.audit_logs_projectos_evidence_candidate_atomic_unique'::regclass;

  if v_is_unique is not true
    or v_is_valid is not true
    or v_is_ready is not true
    or v_is_live is not true
    or v_key_count <> 1
    or v_key_definition is distinct from 'record_id'
    or v_has_expressions is true
    or v_predicate is null
    or regexp_replace(
      v_predicate,
      '[[:space:]()]',
      '',
      'g'
    ) <>
      'action=''projectos_evidence_candidate_atomic_created''::textANDtable_name=''memory_capture_candidates''::text'
  then
    raise exception 'projectos evidence atomic audit index drift';
  end if;
end;
$atomic_audit_index_assertion$;

create or replace function public.prevent_projectos_evidence_intake_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'projectos evidence intake audit is immutable';
end;
$function$;

revoke all on function public.prevent_projectos_evidence_intake_audit_mutation()
  from public;
revoke all on function public.prevent_projectos_evidence_intake_audit_mutation()
  from anon, authenticated, service_role;

drop trigger if exists prevent_projectos_evidence_intake_audit_mutation
  on public.audit_logs;

create trigger prevent_projectos_evidence_intake_audit_mutation
before update or delete on public.audit_logs
for each row
when (
  (
    old.action = 'projectos_evidence_candidate_atomic_created'
    and old.table_name = 'memory_capture_candidates'
  )
  or (
    old.action in (
      'projectos_evidence_candidate_write_scope_source_replay_activated',
      'projectos_evidence_candidate_write_scope_activated',
      'projectos_evidence_candidate_write_scope_deactivated'
    )
    and old.table_name = 'pandora_service_principals'
  )
  or (
    old.action = 'projectos_evidence_successor_activation_authorized'
    and old.table_name = 'release_authorizations'
  )
)
execute function public.prevent_projectos_evidence_intake_audit_mutation();

create or replace function public.protect_projectos_evidence_reserved_rows()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_rpc_owner name;
  v_reserved boolean := false;
begin
  select pg_get_userbyid(p.proowner)
    into v_rpc_owner
  from pg_catalog.pg_proc p
  where p.oid = to_regprocedure(
    'public.submit_projectos_evidence_candidate_atomic(text,uuid,text,text,uuid,text,text,text,text,text,jsonb,jsonb,text)'
  );

  if v_rpc_owner is null then
    raise exception using
      errcode = '55000',
      message = 'projectos evidence reserved-row guard cannot resolve atomic RPC owner';
  end if;

  if tg_table_name = 'memory_capture_candidates' then
    if tg_op = 'INSERT' then
      v_reserved := new.source = 'projectos-post-task'
        and new.source_ref like 'projectos-evidence:%';
    elsif tg_op = 'UPDATE' then
      v_reserved := (
        old.source = 'projectos-post-task'
        and old.source_ref like 'projectos-evidence:%'
      ) or (
        new.source = 'projectos-post-task'
        and new.source_ref like 'projectos-evidence:%'
      );
    else
      v_reserved := old.source = 'projectos-post-task'
        and old.source_ref like 'projectos-evidence:%';
    end if;
  elsif tg_table_name = 'memory_review_queue_items' then
    if tg_op = 'INSERT' then
      v_reserved := new.candidate_type = 'projectos_outcome'
        and new.source_ref like 'projectos-evidence:%';
    elsif tg_op = 'UPDATE' then
      v_reserved := (
        old.candidate_type = 'projectos_outcome'
        and old.source_ref like 'projectos-evidence:%'
      ) or (
        new.candidate_type = 'projectos_outcome'
        and new.source_ref like 'projectos-evidence:%'
      );
    else
      v_reserved := old.candidate_type = 'projectos_outcome'
        and old.source_ref like 'projectos-evidence:%';
    end if;
  elsif tg_table_name = 'audit_logs' then
    if tg_op = 'INSERT' then
      v_reserved := (
        new.action = 'projectos_evidence_candidate_atomic_created'
        and new.table_name = 'memory_capture_candidates'
      ) or (
        new.action in (
          'projectos_evidence_candidate_write_scope_source_replay_activated',
          'projectos_evidence_candidate_write_scope_activated',
          'projectos_evidence_candidate_write_scope_deactivated'
        )
        and new.table_name = 'pandora_service_principals'
      ) or (
        new.action = 'projectos_evidence_successor_activation_authorized'
        and new.table_name = 'release_authorizations'
      );
    elsif tg_op = 'UPDATE' then
      v_reserved := (
        old.action = 'projectos_evidence_candidate_atomic_created'
        and old.table_name = 'memory_capture_candidates'
      ) or (
        old.action in (
          'projectos_evidence_candidate_write_scope_source_replay_activated',
          'projectos_evidence_candidate_write_scope_activated',
          'projectos_evidence_candidate_write_scope_deactivated'
        )
        and old.table_name = 'pandora_service_principals'
      ) or (
        old.action = 'projectos_evidence_successor_activation_authorized'
        and old.table_name = 'release_authorizations'
      ) or (
        new.action = 'projectos_evidence_candidate_atomic_created'
        and new.table_name = 'memory_capture_candidates'
      ) or (
        new.action in (
          'projectos_evidence_candidate_write_scope_source_replay_activated',
          'projectos_evidence_candidate_write_scope_activated',
          'projectos_evidence_candidate_write_scope_deactivated'
        )
        and new.table_name = 'pandora_service_principals'
      ) or (
        new.action = 'projectos_evidence_successor_activation_authorized'
        and new.table_name = 'release_authorizations'
      );
    else
      v_reserved := (
        old.action = 'projectos_evidence_candidate_atomic_created'
        and old.table_name = 'memory_capture_candidates'
      ) or (
        old.action in (
          'projectos_evidence_candidate_write_scope_source_replay_activated',
          'projectos_evidence_candidate_write_scope_activated',
          'projectos_evidence_candidate_write_scope_deactivated'
        )
        and old.table_name = 'pandora_service_principals'
      ) or (
        old.action = 'projectos_evidence_successor_activation_authorized'
        and old.table_name = 'release_authorizations'
      );
    end if;
  end if;

  if v_reserved and current_user is distinct from v_rpc_owner then
    raise exception using
      errcode = '42501',
      message = 'projectos evidence reserved row requires atomic RPC owner';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke all on function public.protect_projectos_evidence_reserved_rows()
  from public;
revoke all on function public.protect_projectos_evidence_reserved_rows()
  from anon, authenticated, service_role;

drop trigger if exists protect_projectos_evidence_reserved_candidate
  on public.memory_capture_candidates;
create trigger protect_projectos_evidence_reserved_candidate
before insert or update or delete on public.memory_capture_candidates
for each row execute function public.protect_projectos_evidence_reserved_rows();

drop trigger if exists protect_projectos_evidence_reserved_review
  on public.memory_review_queue_items;
create trigger protect_projectos_evidence_reserved_review
before insert or update or delete on public.memory_review_queue_items
for each row execute function public.protect_projectos_evidence_reserved_rows();

drop trigger if exists protect_projectos_evidence_reserved_audit
  on public.audit_logs;
drop trigger if exists protect_projectos_evidence_reserved_audit_insert
  on public.audit_logs;
create trigger protect_projectos_evidence_reserved_audit
before insert or update or delete on public.audit_logs
for each row execute function public.protect_projectos_evidence_reserved_rows();

-- TRUNCATE bypasses row-level DELETE triggers. The workload roles must not be
-- able to erase any member of the reserved lifecycle or install replacement
-- triggers around the database-owned provenance boundary.
revoke truncate, trigger on table public.memory_capture_candidates
  from anon, authenticated, service_role;
revoke truncate, trigger on table public.memory_review_queue_items
  from anon, authenticated, service_role;
revoke truncate, trigger on table public.audit_logs
  from anon, authenticated, service_role;

do $atomic_trigger_topology_assertion$
declare
  v_candidate_trigger_count integer;
  v_review_trigger_count integer;
  v_audit_trigger_count integer;
begin
  select count(*)::integer into v_candidate_trigger_count
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.memory_capture_candidates'::regclass
    and not t.tgisinternal;

  select count(*)::integer into v_review_trigger_count
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.memory_review_queue_items'::regclass
    and not t.tgisinternal;

  select count(*)::integer into v_audit_trigger_count
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.audit_logs'::regclass
    and not t.tgisinternal;

  if v_candidate_trigger_count <> 1
     or v_review_trigger_count <> 1
     or v_audit_trigger_count <> 2 then
    raise exception 'projectos evidence atomic trigger topology drift';
  end if;
end;
$atomic_trigger_topology_assertion$;

create or replace function public.projectos_evidence_privacy_text_reason(
  p_text text
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  v_text text := btrim(coalesce(p_text, ''));
  v_deobfuscated text;
begin
  v_text := normalize(v_text, NFKC);
  v_deobfuscated := translate(
    v_text,
    U&'\200B\200C\200D\200E\200F\2060\FEFF',
    ''
  );
  if v_deobfuscated is distinct from v_text then
    return 'obfuscated_text';
  end if;
  if v_text ~* '%[0-9a-f]{2}' then
    return 'percent_encoded_text';
  end if;
  if v_text ~* '(\\u\{?[0-9a-f]{4,6}\}?|\\x[0-9a-f]{2}|&#x[0-9a-f]{2,6};?|&#[0-9]{2,7};?|&commat;|&colon;)' then
    return 'encoded_escape_text';
  end if;
  if btrim(v_text) in (
    'Atomic Migration',
    'Systems Mastery',
    'Candidate Atomic Migration passed.'
  ) then
    return null;
  end if;
  if v_text ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' then
    return 'direct_identifier_email';
  end if;
  if v_text ~* '(born([[:space:]]+on)?|date[ _-]?of[ _-]?birth|birth[ _-]?date|birthday|dob)[[:space:]]*(is[[:space:]]+|[:= -]*)((([12][0-9]{3})[-/.]([0-3]?[0-9])[-/.]([0-3]?[0-9]))|(([0-3]?[0-9])[-/.]([0-3]?[0-9])[-/.]([12][0-9]{3}))|((jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)[[:space:]]+[0-3]?[0-9],?[[:space:]]+[12][0-9]{3}))' then
    return 'direct_identifier_birth_date';
  end if;
  if v_text ~* '(address|street[ _-]?address|home[ _-]?address|mailing[ _-]?address)[[:space:]]*[:=][[:space:]]*[^,;]{5,160}'
     or v_text ~* '(^|[^0-9])[0-9]{1,5}[[:space:]]+[A-Z0-9.''-]+([[:space:]]+[A-Z0-9.''-]+){0,5}[[:space:]]+(street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|court|ct|highway|hwy|barangay|brgy)([^A-Z]|$)' then
    return 'direct_identifier_address';
  end if;
  if v_text ~* '(passport([ _-]?number)?|government[ _-]?id|national[ _-]?id|tax[ _-]?id|tin|ssn|umid|philhealth|pag[ _-]?ibig)[[:space:]]*[:=][[:space:]]*["'']?[A-Z0-9][A-Z0-9 -]{4,40}' then
    return 'direct_identifier_government';
  end if;
  if v_text ~* '(card[ _-]?number|credit[ _-]?card|debit[ _-]?card|bank[ _-]?account|account[ _-]?number|iban)[[:space:]]*[:=][[:space:]]*["'']?[A-Z0-9][A-Z0-9 -]{4,40}' then
    return 'direct_identifier_financial';
  end if;
  if v_text ~* '(\+[0-9]{1,3}[[:space:]().-]*)?(\(?[0-9]{2,4}\)?[[:space:].-]+)[0-9]{3,4}[[:space:].-]+[0-9]{3,4}([^0-9]|$)' then
    return 'direct_identifier_phone';
  end if;
  if v_text ~* '(^|[^0-9])((\+?63|0)9[0-9]{9})([^0-9]|$)' then
    return 'direct_identifier_phone';
  end if;
  if v_text ~* '(phone([ _-]?number)?|telephone|mobile([ _-]?number)?)[[:space:]]*[:=][[:space:]]*\+?[0-9][0-9 ()-]{7,20}' then
    return 'direct_identifier_phone';
  end if;
  if v_text ~ '(^|[^0-9])[0-9]{3}-[0-9]{2}-[0-9]{4}([^0-9]|$)' then
    return 'direct_identifier_government';
  end if;
  if v_text ~* '(^|[^A-Z0-9])[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}([^A-Z0-9]|$)' then
    return 'direct_identifier_financial';
  end if;
  if v_text ~* '-----BEGIN ([A-Z0-9 -]+ )?PRIVATE KEY-----' then
    return 'private_key_material';
  end if;
  if v_text ~* '(^|[^A-Z0-9])(AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}([^A-Z0-9]|$)' then
    return 'cloud_credential_signature';
  end if;
  if v_text ~ '(^|[^A-Za-z0-9])AIza[0-9A-Za-z_-]{35}([^A-Za-z0-9]|$)' then
    return 'cloud_credential_signature';
  end if;
  if v_text ~* '(^|[^A-Za-z0-9])(ghp|github_pat|glpat|sk|sbp|xox[baprs])[-_][A-Za-z0-9_-]{12,}([^A-Za-z0-9]|$)' then
    return 'credential_signature';
  end if;
  if v_text ~* '(authorization[[:space:]]*:[[:space:]]*(bearer|basic)|bearer|basic|api[_ -]?token[[:space:]]*[:=])[[:space:]]+[A-Za-z0-9._~+/-]{16,}' then
    return 'credential_signature';
  end if;
  if v_text ~ '(^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}([^A-Za-z0-9_-]|$)' then
    return 'jwt_signature';
  end if;
  if v_text ~* '(password|passwd|passphrase|pwd|pin|client[_ -]?secret|secret[_ -]?(key|access[_ -]?key)|aws[_ -]?(secret[_ -]?access[_ -]?key|access[_ -]?key[_ -]?id)|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|service[_ -]?role|private[_ -]?key|accountkey|sharedaccesssignature)[[:space:]]*[:=][[:space:]]*["'']?[^[:space:]"'',;}{]{4,}' then
    return 'secret_assignment';
  end if;
  if v_text ~* '(full[ _-]?name|first[ _-]?name|last[ _-]?name|given[ _-]?name|family[ _-]?name|name)[[:space:]]*[:=][[:space:]]*["'']?[A-Z][A-Z .''-]{2,80}' then
    return 'direct_identifier_name';
  end if;
  if v_text ~ '(^|[^[:alpha:]])[[:upper:]][[:alpha:]]{1,30}([ ''-]([[:upper:]][[:alpha:]]{1,30}|[[:upper:]]\.?)){1,3}([^[:alpha:]]|$)'
     or v_text ~ '(^|[^[:alpha:]])[[:upper:]]\.?([ ''-][[:upper:]]\.?){0,2}[ ''-][[:upper:]][[:alpha:]]{1,30}([^[:alpha:]]|$)'
     or v_text ~ '(^|[^[:alpha:]])[[:upper:]][[:alpha:]]{1,30}[[:space:]]+(([Dd]e|[Dd]el|[Dd]ela|[Dd]e[[:space:]]+la|[Ll]a|[Dd]a|[Dd]os|[Vv]an|[Vv]on)[[:space:]]+)+[[:upper:]][[:alpha:]]{1,30}([^[:alpha:]]|$)' then
    return 'direct_identifier_name';
  end if;
  if v_text ~ '([Cc]andidate|[Pp]erson|[Uu]ser|[Cc]ustomer|[Cc]lient|[Ee]mployee|[Oo]wner|[Cc]ontact|[Aa]uthor)[[:space:]]+([Nn]amed[[:space:]]+)?([[:upper:]][[:alpha:]]{1,30}[ ''-]){1,3}[[:upper:]][[:alpha:]]{1,30}'
     or v_text ~ '([Bb]y|[Ff]rom|[Ff]or|[Cc]ontact)[[:space:]]+([[:upper:]][[:alpha:]]{1,30}[ ''-]){1,3}[[:upper:]][[:alpha:]]{1,30}' then
    return 'direct_identifier_name';
  end if;
  if v_text ~* 'https?://[^/[:space:]:@]+:[^/[:space:]@]{4,}@' then
    return 'credential_in_url';
  end if;
  return null;
end;
$function$;

create or replace function public.projectos_evidence_privacy_base64_reason(
  p_text text,
  p_depth integer default 0
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  v_encoded text;
  v_decoded text;
  v_reason text;
begin
  if p_depth < 0 or p_depth >= 2 then
    return null;
  end if;

  for v_encoded in
    select distinct regexp_replace(candidate, '[[:space:],.;|]', '', 'g')
    from (
      select matches[1] as candidate
      from regexp_matches(
        p_text,
        '([A-Za-z0-9+/_-]{8,}={0,2})',
        'g'
      ) as uninterrupted(matches)
      union all
      select matches[1] as candidate
      from regexp_matches(
        p_text,
        '(([A-Za-z0-9+/_-][[:space:],.;|]*){8,}={0,2})',
        'g'
      ) as whitespace_split(matches)
    ) as encoded_candidates
  loop
    v_encoded := translate(v_encoded, '-_', '+/');
    v_encoded := v_encoded || repeat('=', (4 - length(v_encoded) % 4) % 4);
    begin
      v_decoded := convert_from(decode(v_encoded, 'base64'), 'UTF8');
    exception when others then
      v_decoded := null;
    end;

    if v_decoded is not null then
      v_reason := public.projectos_evidence_privacy_text_reason(v_decoded);
      if v_reason is not null then
        return 'base64_' || v_reason;
      end if;

      v_reason := public.projectos_evidence_privacy_base64_reason(
        v_decoded,
        p_depth + 1
      );
      if v_reason is not null then
        return 'base64_' || v_reason;
      end if;
    end if;
  end loop;

  return null;
end;
$function$;

create or replace function public.projectos_evidence_privacy_rejection_reason(
  p_payload jsonb
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  v_json jsonb;
  v_text text;
  v_reason text;
begin
  if p_payload::text ~* '"(password|passwd|passphrase|pwd|pin|secret|client[ _-]?secret|secret[ _-]?key|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|service[ _-]?role|private[ _-]?key|accountkey|sharedaccesssignature|full[ _-]?name|first[ _-]?name|last[ _-]?name|given[ _-]?name|family[ _-]?name|date[ _-]?of[ _-]?birth|birth[ _-]?date|dob|phone|mobile|address|passport|tax[ _-]?id|bank[ _-]?account|iban|card[ _-]?number)"[[:space:]]*:' then
    return 'sensitive_field';
  end if;

  for v_json in
    select value
    from jsonb_path_query(p_payload, '$.** ? (@.type() == "string")') as values(value)
  loop
    v_text := v_json #>> '{}';
    v_reason := public.projectos_evidence_privacy_base64_reason(v_text, 0);
    if v_reason is not null then
      return v_reason;
    end if;
    v_reason := public.projectos_evidence_privacy_text_reason(v_text);
    if v_reason is not null then
      return v_reason;
    end if;
  end loop;
  return null;
end;
$function$;

create or replace function public.projectos_evidence_iso_timestamp_valid(
  p_text text
)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $function$
begin
  if p_text is null
     or p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    return false;
  end if;
  perform p_text::timestamptz;
  return true;
exception when others then
  return false;
end;
$function$;

revoke all on function public.projectos_evidence_privacy_text_reason(text)
  from public;
revoke all on function public.projectos_evidence_privacy_text_reason(text)
  from anon, authenticated, service_role;
revoke all on function public.projectos_evidence_privacy_base64_reason(text, integer)
  from public;
revoke all on function public.projectos_evidence_privacy_base64_reason(text, integer)
  from anon, authenticated, service_role;
revoke all on function public.projectos_evidence_privacy_rejection_reason(jsonb)
  from public;
revoke all on function public.projectos_evidence_privacy_rejection_reason(jsonb)
  from anon, authenticated, service_role;
revoke all on function public.projectos_evidence_iso_timestamp_valid(text)
  from public;
revoke all on function public.projectos_evidence_iso_timestamp_valid(text)
  from anon, authenticated, service_role;

create or replace function public.submit_projectos_evidence_candidate_atomic(
  p_principal_key text,
  p_user_id uuid,
  p_environment text,
  p_namespace text,
  p_project_id uuid,
  p_project_key text,
  p_title text,
  p_summary text,
  p_proof_stage text,
  p_claim text,
  p_evidence_refs jsonb,
  p_provenance jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  v_principal public.pandora_service_principals%rowtype;
  v_project public.pandora_projects%rowtype;
  v_grant public.pandora_project_grants%rowtype;
  v_proposal_grant_count integer;
  v_source_ref text;
  v_fingerprint_payload jsonb;
  v_fingerprint text;
  v_candidate_id uuid;
  v_review_item_id uuid;
  v_audit_id uuid;
  v_created_at timestamptz := clock_timestamp();
  v_existing_fingerprint text;
  v_created boolean := false;
  v_integrity_count integer;
  v_privacy_reason text;
begin
  if p_principal_key is distinct from 'projectos-mcpmaster-production'
    or p_environment is distinct from 'production'
    or p_namespace is distinct from 'real_life'
    or p_project_id is distinct from '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid
    or p_project_key is distinct from 'mcpmaster-pandoras-box'
  then
    raise exception using
      errcode = '22023',
      message = 'projectos evidence atomic identity is outside the authorized envelope';
  end if;

  if p_user_id is null
    or p_title is null
    or p_title <> btrim(p_title)
    or char_length(p_title) not between 1 and 200
    or p_summary is null
    or p_summary <> btrim(p_summary)
    or char_length(p_summary) not between 1 and 1800
    or p_claim is null
    or p_claim <> btrim(p_claim)
    or char_length(p_claim) not between 1 and 1000
    or p_proof_stage is null
    or p_proof_stage not in (
      'documented',
      'implemented',
      'tested',
      'deployed',
      'production_verified'
    )
    or p_idempotency_key is null
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,160}$'
    or jsonb_typeof(p_evidence_refs) is distinct from 'array'
    or jsonb_typeof(p_provenance) is distinct from 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'projectos evidence atomic payload is invalid';
  end if;

  if jsonb_array_length(p_evidence_refs) = 0
     or jsonb_array_length(p_evidence_refs) > 20
     or octet_length(p_evidence_refs::text) > 20000
     or octet_length(p_provenance::text) > 5000 then
    raise exception using
      errcode = '22023',
      message = 'projectos evidence atomic payload is invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_evidence_refs) as refs(item)
    where jsonb_typeof(item) <> 'object'
  ) or exists (
    select 1
    from jsonb_array_elements(p_evidence_refs) as refs(item)
    where jsonb_typeof(item) = 'object'
      and (
        exists (
          select 1
          from jsonb_object_keys(item) as keys(key)
          where key not in ('type', 'ref', 'sha256', 'artifact_class', 'observed_at')
        )
        or jsonb_typeof(item -> 'type') is distinct from 'string'
        or item ->> 'type' <> btrim(item ->> 'type')
        or char_length(item ->> 'type') not between 1 and 64
        or jsonb_typeof(item -> 'ref') is distinct from 'string'
        or item ->> 'ref' <> btrim(item ->> 'ref')
        or char_length(item ->> 'ref') not between 1 and 512
        or (
          item ? 'sha256'
          and (
            jsonb_typeof(item -> 'sha256') is distinct from 'string'
            or item ->> 'sha256' !~ '^[a-f0-9]{64}$'
          )
        )
        or (
          item ? 'artifact_class'
          and (
            jsonb_typeof(item -> 'artifact_class') is distinct from 'string'
            or item ->> 'artifact_class' <> btrim(item ->> 'artifact_class')
            or char_length(item ->> 'artifact_class') not between 1 and 64
          )
        )
        or (
          item ? 'observed_at'
          and (
            jsonb_typeof(item -> 'observed_at') is distinct from 'string'
            or not public.projectos_evidence_iso_timestamp_valid(item ->> 'observed_at')
          )
        )
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'projectos evidence atomic evidence refs are invalid';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_provenance) as keys(key)
    where key not in ('source_type', 'source_locator', 'source_sha', 'parent_sha', 'observed_at')
  )
    or jsonb_typeof(p_provenance -> 'source_type') is distinct from 'string'
    or p_provenance ->> 'source_type' <> btrim(p_provenance ->> 'source_type')
    or char_length(p_provenance ->> 'source_type') not between 1 and 64
    or jsonb_typeof(p_provenance -> 'source_locator') is distinct from 'string'
    or p_provenance ->> 'source_locator' <> btrim(p_provenance ->> 'source_locator')
    or char_length(p_provenance ->> 'source_locator') not between 1 and 512
    or jsonb_typeof(p_provenance -> 'observed_at') is distinct from 'string'
    or not public.projectos_evidence_iso_timestamp_valid(p_provenance ->> 'observed_at')
    or (
      p_provenance ? 'source_sha'
      and (
        jsonb_typeof(p_provenance -> 'source_sha') is distinct from 'string'
        or p_provenance ->> 'source_sha' !~ '^[a-f0-9]{40}$'
      )
    )
    or (
      p_provenance ? 'parent_sha'
      and (
        jsonb_typeof(p_provenance -> 'parent_sha') is distinct from 'string'
        or p_provenance ->> 'parent_sha' !~ '^[a-f0-9]{40}$'
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'projectos evidence atomic provenance is invalid';
  end if;

  v_privacy_reason := public.projectos_evidence_privacy_rejection_reason(
    jsonb_build_object(
      'title', p_title,
      'summary', p_summary,
      'claim', p_claim,
      'evidence_refs', p_evidence_refs,
      'provenance', p_provenance,
      'idempotency_key', p_idempotency_key
    )
  );
  if v_privacy_reason is not null then
    raise exception using
      errcode = '22023',
      message = 'projectos evidence atomic privacy rejected: ' || v_privacy_reason;
  end if;

  select p.*
    into v_principal
  from public.pandora_service_principals p
  where p.principal_key = p_principal_key
    and p.is_active is true
  for share;

  if not found
    or v_principal.memory_user_id is distinct from p_user_id
    or v_principal.environment is distinct from p_environment
    or not coalesce(
      v_principal.allowed_namespaces @> array[p_namespace]::text[],
      false
    )
    or not coalesce(
      v_principal.scopes @> array['memory:write']::text[],
      false
    )
  then
    raise exception using
      errcode = '42501',
      message = 'projectos evidence atomic principal is not authorized';
  end if;

  select p.*
    into v_project
  from public.pandora_projects p
  where p.id = p_project_id
    and p.project_key = p_project_key
    and p.memory_namespace = p_namespace
    and p.lifecycle_status = 'active'
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'projectos evidence atomic project is not authorized';
  end if;

  select g.*
    into v_grant
  from public.pandora_project_grants g
  where g.principal_key = p_principal_key
    and g.project_id = p_project_id
    and g.environment = p_environment
    and g.is_active is true
    and g.can_propose is true
    and g.revoked_at is null
  for share;

  if not found or v_grant.can_approve is not false then
    raise exception using
      errcode = '42501',
      message = 'projectos evidence atomic proposal grant is not authorized';
  end if;

  select count(*)
    into v_proposal_grant_count
  from public.pandora_project_grants g
  where g.principal_key = p_principal_key
    and g.environment = p_environment
    and g.is_active is true
    and g.can_propose is true
    and g.revoked_at is null;

  if v_proposal_grant_count <> 1 then
    raise exception using
      errcode = '42501',
      message = 'projectos evidence atomic additional proposal grants exist';
  end if;

  v_source_ref :=
    'projectos-evidence:' || p_project_id::text || ':' || p_idempotency_key;
  v_fingerprint_payload := jsonb_build_object(
    'namespace', p_namespace,
    'project_id', p_project_id::text,
    'project_key', p_project_key,
    'title', p_title,
    'summary', p_summary,
    'proof_stage', p_proof_stage,
    'claim', p_claim,
    'evidence_refs', p_evidence_refs,
    'provenance', p_provenance,
    'idempotency_key', p_idempotency_key
  );
  v_fingerprint := encode(
    extensions.digest(convert_to(v_fingerprint_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.memory_capture_candidates (
    user_id,
    namespace,
    source,
    source_ref,
    raw_excerpt,
    redacted_excerpt,
    memory_type,
    title,
    summary,
    importance,
    sensitivity,
    confidence,
    should_capture,
    requires_review,
    status,
    reason,
    people,
    projects,
    risks,
    tags,
    metadata,
    created_at,
    usefulness_score,
    confidence_score,
    freshness_score,
    retrieval_weight,
    stale_status,
    scoring_version,
    scored_at
  ) values (
    p_user_id,
    p_namespace,
    'projectos-post-task',
    v_source_ref,
    null,
    p_summary,
    'business_fact',
    p_title,
    p_summary,
    8,
    'low',
    0.95,
    true,
    true,
    'pending',
    'ProjectOS evidence intake is review-gated. This candidate cannot become canonical without an authenticated human decision.',
    '[]'::jsonb,
    jsonb_build_array(p_project_key),
    '[]'::jsonb,
    jsonb_build_array('projectos', 'evidence_candidate', p_proof_stage),
    jsonb_build_object(
      'schema_version', 2,
      'intake_kind', 'projectos_evidence_candidate_v1',
      'project_id', p_project_id,
      'project_key', p_project_key,
      'proof_stage', p_proof_stage,
      'claim', p_claim,
      'evidence_refs', p_evidence_refs,
      'provenance', p_provenance,
      'idempotency_key', p_idempotency_key,
      'fingerprint', v_fingerprint,
      'privacy_policy', 'metadata_only_v2_fail_closed',
      'privacy_scan_version', 'evidence_privacy_v3',
      'privacy_scan_passed', true,
      'privacy_scan_scope', 'canonicalized_candidate_payload',
      'imported_raw_arguments', false,
      'imported_raw_results', false,
      'imported_raw_errors', false,
      'atomic_rpc', 'submit_projectos_evidence_candidate_atomic'
    ),
    v_created_at,
    0.9,
    0.95,
    1,
    0.9,
    'active',
    'projectos-evidence-v2-atomic',
    v_created_at
  )
  on conflict (user_id, namespace, source, source_ref)
    where source = 'projectos-post-task' and source_ref is not null
  do nothing
  returning id, created_at
    into v_candidate_id, v_created_at;

  v_created := found;

  if not v_created then
    select c.id, c.created_at, c.metadata ->> 'fingerprint'
      into v_candidate_id, v_created_at, v_existing_fingerprint
    from public.memory_capture_candidates c
    where c.user_id = p_user_id
      and c.namespace = p_namespace
      and c.source = 'projectos-post-task'
      and c.source_ref = v_source_ref
    for update;

    if not found or v_candidate_id is null or v_existing_fingerprint is null then
      raise exception using
        errcode = '55000',
        message = 'projectos evidence atomic candidate recovery failed';
    end if;

    select r.id
      into v_review_item_id
    from public.memory_review_queue_items r
    where r.user_id = p_user_id
      and r.namespace = p_namespace
      and r.candidate_type = 'projectos_outcome'
      and r.source_ref = v_source_ref
      and r.status = 'pending_review'
      and r.requires_review is true
      and r.append_only is true
      and r.fingerprint = v_existing_fingerprint
      and r.evidence_snapshot ->> 'candidateId' = v_candidate_id::text;

    select a.id
      into v_audit_id
    from public.audit_logs a
    where a.record_id = v_candidate_id
      and a.action = 'projectos_evidence_candidate_atomic_created'
      and a.table_name = 'memory_capture_candidates'
      and a.metadata ->> 'review_item_id' = v_review_item_id::text
      and a.metadata ->> 'fingerprint' = v_existing_fingerprint;

    if v_review_item_id is null or v_audit_id is null then
      raise exception using
        errcode = '55000',
        message = 'projectos evidence atomic state is incomplete';
    end if;

    if v_existing_fingerprint <> v_fingerprint then
      return jsonb_build_object(
        'outcome', 'idempotency_conflict',
        'candidate_id', v_candidate_id,
        'review_item_id', v_review_item_id,
        'audit_id', v_audit_id,
        'fingerprint', v_existing_fingerprint,
        'canonical_memory_written', false
      );
    end if;

    return jsonb_build_object(
      'outcome', 'deduplicated',
      'candidate_id', v_candidate_id,
      'review_item_id', v_review_item_id,
      'audit_id', v_audit_id,
      'created_at', v_created_at,
      'fingerprint', v_existing_fingerprint,
      'namespace', p_namespace,
      'project_id', p_project_id,
      'project_key', p_project_key,
      'proof_stage', p_proof_stage,
      'canonical_memory_written', false
    );
  end if;

  insert into public.memory_review_queue_items (
    user_id,
    namespace,
    status,
    candidate_type,
    normalized_text,
    evidence_snapshot,
    sensitivity_snapshot,
    namespace_snapshot,
    source_metadata,
    audit_metadata,
    append_only,
    proposed_operation,
    requires_review,
    source_ref,
    request_hash,
    fingerprint,
    created_at,
    updated_at,
    persistence_execution_metadata
  ) values (
    p_user_id,
    p_namespace,
    'pending_review',
    'projectos_outcome',
    p_summary,
    jsonb_build_object(
      'hasEvidence', true,
      'intakeKind', 'projectos_evidence_candidate_v1',
      'sourceRef', v_source_ref,
      'proofStage', p_proof_stage,
      'claim', p_claim,
      'evidenceRefs', p_evidence_refs,
      'provenance', p_provenance,
      'candidateId', v_candidate_id
    ),
    jsonb_build_object(
      'classification', 'low',
      'containsSecrets', false,
      'containsPersonalData', false,
      'containsRawArguments', false,
      'containsRawResults', false,
      'containsRawErrors', false
    ),
    jsonb_build_object(
      'sourceNamespace', p_namespace,
      'targetNamespace', p_namespace,
      'namespaceMatch', true
    ),
    jsonb_build_object(
      'source', 'projectos-post-task',
      'sourceKind', 'projectos_evidence',
      'sourceRef', v_source_ref,
      'projectId', p_project_id,
      'projectKey', p_project_key,
      'proofStage', p_proof_stage
    ),
    jsonb_build_object(
      'schemaVersion', 2,
      'candidateId', v_candidate_id,
      'appendOnly', true,
      'reviewRequired', true,
      'idempotencyKey', p_idempotency_key,
      'fingerprint', v_fingerprint,
      'atomicTransaction', true,
      'immutableAuditRequired', true
    ),
    true,
    'append',
    true,
    v_source_ref,
    v_fingerprint,
    v_fingerprint,
    v_created_at,
    v_created_at,
    jsonb_build_object(
      'atomicRpc', 'submit_projectos_evidence_candidate_atomic',
      'schemaVersion', 1
    )
  )
  returning id into v_review_item_id;

  insert into public.audit_logs (
    user_id,
    namespace,
    action,
    table_name,
    record_id,
    before_snapshot,
    after_snapshot,
    metadata,
    created_at
  ) values (
    p_user_id,
    p_namespace::public.pandora_namespace,
    'projectos_evidence_candidate_atomic_created',
    'memory_capture_candidates',
    v_candidate_id,
    null,
    jsonb_build_object(
      'candidate_status', 'pending',
      'review_status', 'pending_review',
      'canonical_memory_written', false
    ),
    jsonb_build_object(
      'schema_version', 1,
      'source', 'projectos-post-task',
      'source_ref', v_source_ref,
      'candidate_id', v_candidate_id,
      'review_item_id', v_review_item_id,
      'project_id', p_project_id,
      'project_key', p_project_key,
      'idempotency_key', p_idempotency_key,
      'fingerprint', v_fingerprint,
      'atomic_transaction', true,
      'append_only', true,
      'privacy_policy', 'metadata_only_v2_fail_closed'
    ),
    v_created_at
  )
  returning id into v_audit_id;

  select count(*)
    into v_integrity_count
  from public.memory_capture_candidates c
  join public.memory_review_queue_items r
    on r.user_id = c.user_id
    and r.namespace = c.namespace
    and r.source_ref = c.source_ref
    and r.candidate_type = 'projectos_outcome'
  join public.audit_logs a
    on a.record_id = c.id
    and a.action = 'projectos_evidence_candidate_atomic_created'
    and a.table_name = 'memory_capture_candidates'
  where c.id = v_candidate_id
    and r.id = v_review_item_id
    and a.id = v_audit_id
    and c.status = 'pending'
    and c.requires_review is true
    and r.status = 'pending_review'
    and r.requires_review is true
    and r.append_only is true
    and c.metadata ->> 'fingerprint' = v_fingerprint
    and r.fingerprint = v_fingerprint
    and r.evidence_snapshot ->> 'candidateId' = v_candidate_id::text
    and a.metadata ->> 'review_item_id' = v_review_item_id::text
    and a.metadata ->> 'fingerprint' = v_fingerprint;

  if v_integrity_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'projectos evidence atomic postcondition failed';
  end if;

  return jsonb_build_object(
    'outcome', 'created',
    'candidate_id', v_candidate_id,
    'review_item_id', v_review_item_id,
    'audit_id', v_audit_id,
    'created_at', v_created_at,
    'fingerprint', v_fingerprint,
    'namespace', p_namespace,
    'project_id', p_project_id,
    'project_key', p_project_key,
    'proof_stage', p_proof_stage,
    'canonical_memory_written', false
  );
end;
$function$;

do $atomic_rpc_owner_assertion$
declare
  v_migration_owner name := current_user;
  v_function_owner name;
  v_signature text;
begin
  foreach v_signature in array array[
    'public.prevent_projectos_evidence_intake_audit_mutation()',
    'public.protect_projectos_evidence_reserved_rows()',
    'public.projectos_evidence_privacy_text_reason(text)',
    'public.projectos_evidence_privacy_base64_reason(text,integer)',
    'public.projectos_evidence_privacy_rejection_reason(jsonb)',
    'public.projectos_evidence_iso_timestamp_valid(text)',
    'public.submit_projectos_evidence_candidate_atomic(text,uuid,text,text,uuid,text,text,text,text,text,jsonb,jsonb,text)'
  ]::text[] loop
    execute format(
      'alter function %s owner to %I',
      v_signature,
      v_migration_owner
    );

    select pg_get_userbyid(p.proowner)
      into v_function_owner
    from pg_catalog.pg_proc p
    where p.oid = to_regprocedure(v_signature);

    if v_function_owner is distinct from v_migration_owner
       or v_function_owner::text in ('anon', 'authenticated', 'service_role') then
      raise exception 'projectos evidence database-boundary function owner drift: %',
        v_signature;
    end if;
  end loop;
end;
$atomic_rpc_owner_assertion$;

-- CREATE OR REPLACE preserves legacy ACL entries. Reset every explicit
-- non-owner grant before adding back the one intended workload role.
do $atomic_rpc_acl_reset$
declare
  v_role name;
begin
  for v_role in
    select rolname
    from pg_catalog.pg_roles
    where rolname is distinct from current_user
  loop
    execute format(
      'revoke all on function public.submit_projectos_evidence_candidate_atomic(text,uuid,text,text,uuid,text,text,text,text,text,jsonb,jsonb,text) from %I',
      v_role
    );
  end loop;
end;
$atomic_rpc_acl_reset$;

revoke all on function public.submit_projectos_evidence_candidate_atomic(
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  text
) from public;

revoke all on function public.submit_projectos_evidence_candidate_atomic(
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  text
) from anon, authenticated;

grant execute on function public.submit_projectos_evidence_candidate_atomic(
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  text
) to service_role;

comment on function public.submit_projectos_evidence_candidate_atomic(
  text,
  uuid,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  text
) is
  'Atomically persists one review-gated ProjectOS evidence candidate, its pending-review item, and one immutable metadata-only audit record. It never writes canonical memory.';

commit;
