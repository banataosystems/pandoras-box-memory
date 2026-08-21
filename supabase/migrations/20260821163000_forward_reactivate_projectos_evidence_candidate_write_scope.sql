-- Sole governed activation for the atomic ProjectOS evidence-candidate intake.
--
-- The historical 20260820113000 source remains read-only. This migration may
-- perform the only read-to-write transition, and only after the atomic RPC,
-- reserved-row provenance triggers, immutable audits, and exact successor
-- authorization all pass fail-closed readback.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

select pg_advisory_xact_lock(20260821, 163000);

lock table public.pandora_service_principals in share row exclusive mode;
lock table public.pandora_projects in share mode;
lock table public.pandora_project_grants in share mode;
lock table public.audit_logs in share row exclusive mode;

do $forward_activation_guard$
declare
  v_principal public.pandora_service_principals%rowtype;
  v_project public.pandora_projects%rowtype;
  v_grant public.pandora_project_grants%rowtype;
  v_other_active_can_propose integer;
  v_write_principal_count integer;
  v_prior_ledger_count integer;
  v_atomic_ledger_count integer;
  v_existing_activation_audits integer;
  v_scope_constraint_count integer;
  v_scope_constraint_definition text;
  v_atomic_rpc regprocedure;
  v_atomic_owner name;
  v_boundary_owner_count integer;
  v_unexpected_rpc_acl_count integer;
  v_service_rpc_acl_count integer;
  v_atomic_audit_index_count integer;
  v_atomic_audit_trigger_count integer;
  v_reserved_trigger_count integer;
  v_candidate_trigger_count integer;
  v_review_trigger_count integer;
  v_audit_trigger_count integer;
  v_authorization_count integer;
  v_authorization_id_count integer;
begin
  select count(*)::integer
    into v_prior_ledger_count
  from supabase_migrations.schema_migrations
  where (
      version = '20260820150902'
      and name = '20260820113000_enable_projectos_evidence_candidate_write_scope'
    ) or (
      version = '20260820113000'
      and name = 'enable_projectos_evidence_candidate_write_scope'
    );

  if v_prior_ledger_count <> 1 then
    raise exception 'projectos evidence forward activation blocked: historical ledger drift';
  end if;

  select count(*)::integer
    into v_atomic_ledger_count
  from supabase_migrations.schema_migrations
  where version = '20260821160000'
    and name = 'submit_projectos_evidence_candidate_atomic';

  if v_atomic_ledger_count <> 1 then
    raise exception 'projectos evidence forward activation blocked: atomic migration ledger drift';
  end if;

  v_atomic_rpc := to_regprocedure(
    'public.submit_projectos_evidence_candidate_atomic(text,uuid,text,text,uuid,text,text,text,text,text,jsonb,jsonb,text)'
  );
  if v_atomic_rpc is null then
    raise exception 'projectos evidence forward activation blocked: atomic RPC missing';
  end if;
  if not has_function_privilege('service_role', v_atomic_rpc, 'execute')
     or has_function_privilege('anon', v_atomic_rpc, 'execute')
     or has_function_privilege('authenticated', v_atomic_rpc, 'execute') then
    raise exception 'projectos evidence forward activation blocked: atomic RPC privilege drift';
  end if;

  select
    count(*) filter (
      where acl.privilege_type = 'EXECUTE'
        and acl.grantee not in (
          p.proowner,
          (select oid from pg_catalog.pg_roles where rolname = 'service_role')
        )
    )::integer,
    count(*) filter (
      where acl.privilege_type = 'EXECUTE'
        and acl.grantee = (
          select oid from pg_catalog.pg_roles where rolname = 'service_role'
        )
        and not acl.is_grantable
    )::integer
    into v_unexpected_rpc_acl_count, v_service_rpc_acl_count
  from pg_catalog.pg_proc p
  cross join lateral aclexplode(
    coalesce(p.proacl, acldefault('f', p.proowner))
  ) acl
  where p.oid = v_atomic_rpc;

  if v_unexpected_rpc_acl_count <> 0 or v_service_rpc_acl_count <> 1 then
    raise exception 'projectos evidence forward activation blocked: atomic RPC ACL drift';
  end if;

  select pg_get_userbyid(p.proowner)
    into v_atomic_owner
  from pg_catalog.pg_proc p
  where p.oid = v_atomic_rpc;

  if v_atomic_owner is distinct from current_user
     or v_atomic_owner::text in ('anon', 'authenticated', 'service_role') then
    raise exception 'projectos evidence forward activation blocked: atomic RPC owner drift';
  end if;

  select count(*)::integer
    into v_boundary_owner_count
  from pg_catalog.pg_proc p
  where p.oid in (
      to_regprocedure('public.prevent_projectos_evidence_intake_audit_mutation()'),
      to_regprocedure('public.protect_projectos_evidence_reserved_rows()'),
      to_regprocedure('public.projectos_evidence_privacy_text_reason(text)'),
      to_regprocedure('public.projectos_evidence_privacy_base64_reason(text,integer)'),
      to_regprocedure('public.projectos_evidence_privacy_rejection_reason(jsonb)'),
      to_regprocedure('public.projectos_evidence_iso_timestamp_valid(text)'),
      v_atomic_rpc
    )
    and pg_get_userbyid(p.proowner) = current_user
    and pg_get_userbyid(p.proowner)::text not in (
      'anon', 'authenticated', 'service_role'
    );

  if v_boundary_owner_count <> 7 then
    raise exception 'projectos evidence forward activation blocked: DB boundary owner drift';
  end if;

  select count(*)::integer
    into v_atomic_audit_index_count
  from pg_catalog.pg_index i
  where i.indexrelid =
      to_regclass('public.audit_logs_projectos_evidence_candidate_atomic_unique')
    and i.indisunique
    and i.indisvalid
    and i.indisready
    and i.indislive
    and i.indnkeyatts = 1
    and pg_get_indexdef(i.indexrelid, 1, true) = 'record_id'
    and i.indexprs is null
    and regexp_replace(
      pg_get_expr(i.indpred, i.indrelid),
      '[[:space:]()]',
      '',
      'g'
    ) =
      'action=''projectos_evidence_candidate_atomic_created''::textANDtable_name=''memory_capture_candidates''::text';

  if v_atomic_audit_index_count <> 1 then
    raise exception 'projectos evidence forward activation blocked: atomic audit index drift';
  end if;

  select count(*)::integer
    into v_atomic_audit_trigger_count
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.audit_logs'::regclass
    and t.tgname = 'prevent_projectos_evidence_intake_audit_mutation'
    and t.tgfoid =
      'public.prevent_projectos_evidence_intake_audit_mutation()'::regprocedure
    and t.tgtype = 27
    and not t.tgisinternal
    and t.tgenabled = 'O';

  if v_atomic_audit_trigger_count <> 1 then
    raise exception 'projectos evidence forward activation blocked: immutable audit trigger drift';
  end if;

  select count(*)::integer
    into v_reserved_trigger_count
  from pg_catalog.pg_trigger t
  where t.tgfoid = 'public.protect_projectos_evidence_reserved_rows()'::regprocedure
    and t.tgtype = 31
    and not t.tgisinternal
    and t.tgenabled = 'O'
    and (
      (
        t.tgrelid = 'public.memory_capture_candidates'::regclass
        and t.tgname = 'protect_projectos_evidence_reserved_candidate'
      ) or (
        t.tgrelid = 'public.memory_review_queue_items'::regclass
        and t.tgname = 'protect_projectos_evidence_reserved_review'
      ) or (
        t.tgrelid = 'public.audit_logs'::regclass
        and t.tgname = 'protect_projectos_evidence_reserved_audit'
      )
    );

  if v_reserved_trigger_count <> 3 then
    raise exception 'projectos evidence forward activation blocked: reserved-row trigger drift';
  end if;

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
    raise exception 'projectos evidence forward activation blocked: unexpected trigger topology';
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']::text[])
      as roles(role_name)
    cross join unnest(array[
      'public.memory_capture_candidates',
      'public.memory_review_queue_items',
      'public.audit_logs'
    ]::text[]) as relations(relation_name)
    where has_table_privilege(role_name, relation_name, 'TRUNCATE')
       or has_table_privilege(role_name, relation_name, 'TRIGGER')
  ) then
    raise exception 'projectos evidence forward activation blocked: workload table privilege drift';
  end if;

  select count(*)::integer
    into v_authorization_count
  from public.audit_logs
  where action = 'projectos_evidence_successor_activation_authorized'
    and table_name = 'release_authorizations'
    and user_id = (
      select memory_user_id
      from public.pandora_service_principals
      where principal_key = 'projectos-mcpmaster-production'
    )
    and namespace = 'real_life'
    and metadata ->> 'authorization_id' =
      'memory-evidence-atomic-successor-exact-artifact-authorization'
    and before_snapshot is null
    and after_snapshot = jsonb_build_object('verdict', 'PASS')
    and metadata ->> 'authorized_head' ~ '^[0-9a-f]{40}$'
    and metadata ->> 'authorized_tree' ~ '^[0-9a-f]{40}$'
    and metadata ->> 'independent_review_id' <> ''
    and metadata ->> 'independent_review_verdict' = 'PASS'
    and metadata ->> 'issue_56_predecessor_only' = 'true'
    and metadata ->> 'issue_56_authorizes_successor' = 'false'
    and metadata ->> 'atomic_migration' =
      '20260821160000_submit_projectos_evidence_candidate_atomic'
    and metadata ->> 'atomic_migration_sha256' = 'ed97a4254879c1acea18a08aefa3dce0612339bdf1b55dc64df015aa3479af81'
    and metadata ->> 'bridge_index_sha256' = '383c1cac600f0381aba21fe492bc5d04777a91e361ba5bd2ac0e088449103d83'
    and metadata ->> 'import_map_sha256' =
      '5089831e8691c1b4183e7d5f5c0703ca861d4bb46d5fc7f8dbee0c0f76d3a88b';

  select count(*)::integer
    into v_authorization_id_count
  from public.audit_logs
  where action = 'projectos_evidence_successor_activation_authorized'
    and table_name = 'release_authorizations'
    and metadata ->> 'authorization_id' =
      'memory-evidence-atomic-successor-exact-artifact-authorization';

  if v_authorization_count <> 1 or v_authorization_id_count <> 1 then
    raise exception 'projectos evidence forward activation blocked: exact successor authorization missing';
  end if;

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
    raise exception 'projectos evidence forward activation blocked: exact read-only principal drift';
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
    raise exception 'projectos evidence forward activation blocked: read-only constraint drift';
  end if;

  select count(*)::integer
    into v_write_principal_count
  from public.pandora_service_principals
  where 'memory:write' = any(scopes);

  if v_write_principal_count <> 0 then
    raise exception 'projectos evidence forward activation blocked: write scope already present';
  end if;

  select *
    into v_project
  from public.pandora_projects
  where project_key = 'mcpmaster-pandoras-box';

  if not found
     or v_project.id <> '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid
     or v_project.memory_namespace <> 'real_life'
     or v_project.lifecycle_status <> 'active' then
    raise exception 'projectos evidence forward activation blocked: canonical project drift';
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
    raise exception 'projectos evidence forward activation blocked: governed project grant drift';
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
    raise exception 'projectos evidence forward activation blocked: additional proposal grants exist';
  end if;

  select count(*)::integer
    into v_existing_activation_audits
  from public.audit_logs
  where action in (
      'projectos_evidence_candidate_write_scope_activated',
      'projectos_evidence_candidate_write_scope_deactivated'
    )
    and table_name = 'pandora_service_principals'
    and metadata ->> 'activation_id' =
      'memory-evidence-atomic-successor-prod-activation-20260821';

  if v_existing_activation_audits <> 0 then
    raise exception 'projectos evidence forward activation blocked: successor activation audit already exists';
  end if;
end;
$forward_activation_guard$;

alter table public.pandora_service_principals
  drop constraint pandora_service_principals_scopes_check;

alter table public.pandora_service_principals
  add constraint pandora_service_principals_scopes_check
  check (
    scopes <@ array[
      'memory:health'::text,
      'memory:read'::text,
      'memory:write'::text
    ]
  );

update public.pandora_service_principals
set scopes = array['memory:health', 'memory:read', 'memory:write']::text[],
    updated_at = now()
where principal_key = 'projectos-mcpmaster-production'
  and scopes = array['memory:health', 'memory:read']::text[];

do $forward_activation_audit_and_assertion$
declare
  v_principal public.pandora_service_principals%rowtype;
  v_audit_id uuid;
  v_exact_grant_count integer;
  v_write_principal_count integer;
  v_exact_audit_count integer;
  v_scope_constraint_count integer;
  v_authorization jsonb;
begin
  select *
    into v_principal
  from public.pandora_service_principals
  where principal_key = 'projectos-mcpmaster-production';

  if not found
     or not (
       v_principal.scopes <@ array['memory:health', 'memory:read', 'memory:write']::text[]
       and array['memory:health', 'memory:read', 'memory:write']::text[] <@ v_principal.scopes
     ) then
    raise exception 'projectos evidence forward activation failed: exact scope readback mismatch';
  end if;

  select count(*)::integer
    into v_scope_constraint_count
  from pg_constraint
  where conrelid = 'public.pandora_service_principals'::regclass
    and conname = 'pandora_service_principals_scopes_check'
    and contype = 'c'
    and convalidated
    and pg_get_constraintdef(oid, true) =
      'CHECK (scopes <@ ARRAY[''memory:health''::text, ''memory:read''::text, ''memory:write''::text])';

  if v_scope_constraint_count <> 1 then
    raise exception 'projectos evidence forward activation failed: scope constraint readback mismatch';
  end if;

  select count(*)::integer
    into v_exact_grant_count
  from public.pandora_project_grants
  where principal_key = 'projectos-mcpmaster-production'
    and project_id = '7c686cbd-d968-49d5-86cc-918f5e777bd2'::uuid
    and environment = 'production'
    and is_active
    and revoked_at is null
    and can_read
    and can_propose
    and not can_approve;

  if v_exact_grant_count <> 1 then
    raise exception 'projectos evidence forward activation failed: exact grant readback mismatch';
  end if;

  select count(*)::integer
    into v_write_principal_count
  from public.pandora_service_principals
  where 'memory:write' = any(scopes);

  if v_write_principal_count <> 1
     or not ('memory:write' = any(v_principal.scopes)) then
    raise exception 'projectos evidence forward activation failed: write scope escaped target principal';
  end if;

  select metadata
    into strict v_authorization
  from public.audit_logs
  where action = 'projectos_evidence_successor_activation_authorized'
    and table_name = 'release_authorizations'
    and user_id = v_principal.memory_user_id
    and namespace = 'real_life'
    and metadata ->> 'authorization_id' =
      'memory-evidence-atomic-successor-exact-artifact-authorization'
    and before_snapshot is null
    and after_snapshot = jsonb_build_object('verdict', 'PASS')
    and metadata ->> 'authorized_head' ~ '^[0-9a-f]{40}$'
    and metadata ->> 'authorized_tree' ~ '^[0-9a-f]{40}$'
    and metadata ->> 'independent_review_id' <> ''
    and metadata ->> 'independent_review_verdict' = 'PASS'
    and metadata ->> 'issue_56_predecessor_only' = 'true'
    and metadata ->> 'issue_56_authorizes_successor' = 'false'
    and metadata ->> 'atomic_migration' =
      '20260821160000_submit_projectos_evidence_candidate_atomic'
    and metadata ->> 'atomic_migration_sha256' = 'ed97a4254879c1acea18a08aefa3dce0612339bdf1b55dc64df015aa3479af81'
    and metadata ->> 'bridge_index_sha256' = '383c1cac600f0381aba21fe492bc5d04777a91e361ba5bd2ac0e088449103d83'
    and metadata ->> 'import_map_sha256' =
      '5089831e8691c1b4183e7d5f5c0703ca861d4bb46d5fc7f8dbee0c0f76d3a88b';

  insert into public.audit_logs (
    user_id,
    namespace,
    action,
    table_name,
    record_id,
    before_snapshot,
    after_snapshot,
    metadata
  ) values (
    v_principal.memory_user_id,
    'real_life',
    'projectos_evidence_candidate_write_scope_activated',
    'pandora_service_principals',
    v_principal.id,
    jsonb_build_object(
      'scopes', to_jsonb(array['memory:health', 'memory:read']::text[])
    ),
    jsonb_build_object(
      'scopes', to_jsonb(array['memory:health', 'memory:read', 'memory:write']::text[])
    ),
    jsonb_build_object(
      'activation_id', 'memory-evidence-atomic-successor-prod-activation-20260821',
      'transition', 'read_to_write',
      'authorization_id', v_authorization ->> 'authorization_id',
      'authorized_head', v_authorization ->> 'authorized_head',
      'authorized_tree', v_authorization ->> 'authorized_tree',
      'independent_review_id', v_authorization ->> 'independent_review_id',
      'independent_review_verdict', v_authorization ->> 'independent_review_verdict',
      'issue_56_predecessor_only', true,
      'issue_56_authorizes_successor', false,
      'historical_migration', '20260820113000_enable_projectos_evidence_candidate_write_scope',
      'historical_migration_superseded_read_only', true,
      'atomic_migration', '20260821160000_submit_projectos_evidence_candidate_atomic',
      'atomic_migration_sha256', 'ed97a4254879c1acea18a08aefa3dce0612339bdf1b55dc64df015aa3479af81',
      'forward_migration', '20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope',
      'bridge_index_sha256', '383c1cac600f0381aba21fe492bc5d04777a91e361ba5bd2ac0e088449103d83',
      'import_map_sha256', '5089831e8691c1b4183e7d5f5c0703ca861d4bb46d5fc7f8dbee0c0f76d3a88b',
      'canonical_project_key', 'mcpmaster-pandoras-box',
      'exact_successor_authorization_verified', true,
      'review_required', true,
      'canonical_memory_written', false,
      'privacy_policy', 'metadata_only_v2_fail_closed'
    )
  )
  returning id into v_audit_id;

  select count(*)::integer
    into v_exact_audit_count
  from public.audit_logs
  where id = v_audit_id
    and user_id = v_principal.memory_user_id
    and namespace = 'real_life'
    and action = 'projectos_evidence_candidate_write_scope_activated'
    and table_name = 'pandora_service_principals'
    and record_id = v_principal.id
    and before_snapshot = jsonb_build_object(
      'scopes', to_jsonb(array['memory:health', 'memory:read']::text[])
    )
    and after_snapshot = jsonb_build_object(
      'scopes', to_jsonb(array['memory:health', 'memory:read', 'memory:write']::text[])
    )
    and metadata ->> 'activation_id' =
      'memory-evidence-atomic-successor-prod-activation-20260821'
    and metadata ->> 'transition' = 'read_to_write'
    and metadata ->> 'authorization_id' =
      'memory-evidence-atomic-successor-exact-artifact-authorization'
    and metadata ->> 'authorized_head' = v_authorization ->> 'authorized_head'
    and metadata ->> 'authorized_tree' = v_authorization ->> 'authorized_tree'
    and metadata ->> 'independent_review_id' = v_authorization ->> 'independent_review_id'
    and metadata ->> 'independent_review_verdict' = 'PASS'
    and metadata ->> 'issue_56_predecessor_only' = 'true'
    and metadata ->> 'issue_56_authorizes_successor' = 'false'
    and metadata ->> 'historical_migration_superseded_read_only' = 'true'
    and metadata ->> 'atomic_migration' =
      '20260821160000_submit_projectos_evidence_candidate_atomic'
    and metadata ->> 'atomic_migration_sha256' = 'ed97a4254879c1acea18a08aefa3dce0612339bdf1b55dc64df015aa3479af81'
    and metadata ->> 'forward_migration' =
      '20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope'
    and metadata ->> 'bridge_index_sha256' = '383c1cac600f0381aba21fe492bc5d04777a91e361ba5bd2ac0e088449103d83'
    and metadata ->> 'import_map_sha256' =
      '5089831e8691c1b4183e7d5f5c0703ca861d4bb46d5fc7f8dbee0c0f76d3a88b'
    and metadata ->> 'exact_successor_authorization_verified' = 'true'
    and metadata ->> 'review_required' = 'true';

  if v_exact_audit_count <> 1 then
    raise exception 'projectos evidence forward activation failed: exact audit readback mismatch';
  end if;
end;
$forward_activation_audit_and_assertion$;

comment on constraint pandora_service_principals_scopes_check
  on public.pandora_service_principals
  is 'Allowlisted Memory workload scopes. memory:write is review-gated candidate proposal only; it does not authorize canonical promotion.';

commit;
