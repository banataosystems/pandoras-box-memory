-- Forward recovery for the review-gated ProjectOS evidence-candidate bridge.
--
-- The original activation migration is already present in the hosted migration
-- ledger, but its runtime scope change was subsequently rolled back during the
-- transaction-only proof. Preserve that history: do not repair, delete, rename,
-- or replay the original ledger entry. This distinct migration records the
-- separately governed production activation. The atomic evidence-intake RPC
-- migration must exist and pass its privilege/audit guards before this source
-- may make memory:write available to the bridge.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Serialize this one governed activation independently of table-wide audit
-- traffic. The two-key advisory lock is transaction-scoped and releases on
-- either commit or rollback.
select pg_advisory_xact_lock(20260821, 113000);

lock table public.pandora_service_principals in share row exclusive mode;
lock table public.pandora_projects in share mode;
lock table public.pandora_project_grants in share mode;

do $forward_activation_guard$
declare
  v_principal public.pandora_service_principals%rowtype;
  v_project public.pandora_projects%rowtype;
  v_grant public.pandora_project_grants%rowtype;
  v_other_active_can_propose integer;
  v_other_write_principal_count integer;
  v_prior_ledger_count integer;
  v_prior_ledger_mode text;
  v_existing_activation_audits integer;
  v_scope_constraint_count integer;
  v_scope_constraint_definition text;
  v_atomic_rpc regprocedure;
  v_atomic_audit_index_count integer;
  v_atomic_audit_trigger_count integer;
begin
  -- Accept the exact hosted history shape produced by the governed provider
  -- apply and the exact clean-replay shape produced from this repository.
  -- Anything else is ledger drift and must be reconciled before activation.
  select
    count(*)::integer,
    min(
      case
        when version = '20260820150902' then 'hosted_rolled_back'
        when version = '20260820113000' then 'clean_replay_active'
      end
    )
    into v_prior_ledger_count, v_prior_ledger_mode
  from supabase_migrations.schema_migrations
  where (
      version = '20260820150902'
      and name = '20260820113000_enable_projectos_evidence_candidate_write_scope'
    )
    or (
      version = '20260820113000'
      and name = 'enable_projectos_evidence_candidate_write_scope'
    );

  if v_prior_ledger_count <> 1 then
    raise exception 'projectos evidence forward activation blocked: prior migration ledger drift';
  end if;

  v_atomic_rpc := to_regprocedure(
    'public.submit_projectos_evidence_candidate_atomic(text,uuid,text,text,uuid,text,text,text,text,text,jsonb,jsonb,text)'
  );
  if v_atomic_rpc is null then
    raise exception 'projectos evidence forward activation blocked: atomic RPC migration missing';
  end if;
  if not has_function_privilege('service_role', v_atomic_rpc, 'execute')
     or has_function_privilege('anon', v_atomic_rpc, 'execute')
     or has_function_privilege('authenticated', v_atomic_rpc, 'execute') then
    raise exception 'projectos evidence forward activation blocked: atomic RPC privilege drift';
  end if;

  select count(*)::integer
    into v_atomic_audit_index_count
  from pg_catalog.pg_index i
  where i.indexrelid =
      to_regclass('public.audit_logs_projectos_evidence_candidate_atomic_unique')
    and i.indisunique
    and i.indnkeyatts = 1
    and pg_get_indexdef(i.indexrelid, 1, true) = 'record_id'
    and i.indexprs is null
    and pg_get_expr(i.indpred, i.indrelid)
      like '%projectos_evidence_candidate_atomic_created%'
    and pg_get_expr(i.indpred, i.indrelid)
      like '%memory_capture_candidates%';

  if v_atomic_audit_index_count <> 1 then
    raise exception 'projectos evidence forward activation blocked: atomic audit index drift';
  end if;

  select count(*)::integer
    into v_atomic_audit_trigger_count
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.audit_logs'::regclass
    and t.tgname = 'prevent_projectos_evidence_intake_audit_mutation'
    and not t.tgisinternal
    and t.tgenabled = 'O';

  if v_atomic_audit_trigger_count <> 1 then
    raise exception 'projectos evidence forward activation blocked: atomic audit trigger drift';
  end if;

  select *
    into v_principal
  from public.pandora_service_principals
  where principal_key = 'projectos-mcpmaster-production';

  if not found then
    raise exception 'projectos evidence forward activation blocked: principal missing';
  end if;
  if not v_principal.is_active
     or v_principal.provider <> 'vercel_oidc'
     or v_principal.environment <> 'production'
     or v_principal.project_name <> 'mcpmaster'
     or v_principal.project_id <> 'prj_Y5rZVcq8xJVzHVt4uvfmg9wPvXMk'
     or v_principal.memory_user_id is null then
    raise exception 'projectos evidence forward activation blocked: principal identity drift';
  end if;
  if not (
    v_principal.allowed_namespaces <@ array['real_life']::text[]
    and array['real_life']::text[] <@ v_principal.allowed_namespaces
  ) then
    raise exception 'projectos evidence forward activation blocked: namespace scope drift';
  end if;
  if v_prior_ledger_mode = 'hosted_rolled_back' then
    if not (
      v_principal.scopes <@ array['memory:health', 'memory:read']::text[]
      and array['memory:health', 'memory:read']::text[] <@ v_principal.scopes
    ) then
      raise exception 'projectos evidence forward activation blocked: expected hosted rolled-back scopes missing';
    end if;
  elsif v_prior_ledger_mode = 'clean_replay_active' then
    if not (
      v_principal.scopes <@ array['memory:health', 'memory:read', 'memory:write']::text[]
      and array['memory:health', 'memory:read', 'memory:write']::text[] <@ v_principal.scopes
    ) then
      raise exception 'projectos evidence forward activation blocked: expected clean-replay scopes missing';
    end if;
  else
    raise exception 'projectos evidence forward activation blocked: prior migration ledger mode unknown';
  end if;

  select count(*)::integer, min(pg_get_constraintdef(oid, true))
    into v_scope_constraint_count, v_scope_constraint_definition
  from pg_constraint
  where conrelid = 'public.pandora_service_principals'::regclass
    and conname = 'pandora_service_principals_scopes_check'
    and contype = 'c'
    and convalidated;

  if v_scope_constraint_count <> 1 then
    raise exception 'projectos evidence forward activation blocked: scope constraint drift';
  end if;
  if v_prior_ledger_mode = 'hosted_rolled_back'
     and v_scope_constraint_definition <>
       'CHECK (scopes <@ ARRAY[''memory:health''::text, ''memory:read''::text])' then
    raise exception 'projectos evidence forward activation blocked: rolled-back scope constraint definition drift';
  end if;
  if v_prior_ledger_mode = 'clean_replay_active'
     and v_scope_constraint_definition <>
       'CHECK (scopes <@ ARRAY[''memory:health''::text, ''memory:read''::text, ''memory:write''::text])' then
    raise exception 'projectos evidence forward activation blocked: clean-replay scope constraint definition drift';
  end if;

  select count(*)::integer
    into v_other_write_principal_count
  from public.pandora_service_principals
  where principal_key <> 'projectos-mcpmaster-production'
    and 'memory:write' = any(scopes);

  if v_other_write_principal_count <> 0 then
    raise exception 'projectos evidence forward activation blocked: another principal has write scope';
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
  where namespace = 'real_life'
    and metadata ->> 'activation_id' = 'memory-evidence-candidate-bridge-prod-activation-20260821';

  if v_existing_activation_audits <> 0 then
    raise exception 'projectos evidence forward activation blocked: activation audit already exists';
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
where principal_key = 'projectos-mcpmaster-production';

do $forward_activation_audit_and_assertion$
declare
  v_principal public.pandora_service_principals%rowtype;
  v_audit_id uuid;
  v_exact_grant_count integer;
  v_write_principal_count integer;
  v_exact_audit_count integer;
  v_scope_constraint_count integer;
  v_before_scopes text[];
  v_prior_ledger_mode text;
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
    raise exception 'projectos evidence forward activation failed: exact scope constraint readback mismatch';
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

  select case
      when exists (
        select 1
        from supabase_migrations.schema_migrations
        where version = '20260820150902'
          and name = '20260820113000_enable_projectos_evidence_candidate_write_scope'
      ) then 'hosted_rolled_back'
      else 'clean_replay_active'
    end
    into v_prior_ledger_mode;

  v_before_scopes := case
    when v_prior_ledger_mode = 'hosted_rolled_back'
      then array['memory:health', 'memory:read']::text[]
    else array['memory:health', 'memory:read', 'memory:write']::text[]
  end;

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
      'scopes', to_jsonb(v_before_scopes)
    ),
    jsonb_build_object(
      'scopes', to_jsonb(array['memory:health', 'memory:read', 'memory:write']::text[])
    ),
    jsonb_build_object(
      'activation_id', 'memory-evidence-candidate-bridge-prod-activation-20260821',
      'governance_issue', 'banataosystems/pandoras-box-memory#56',
      'prior_ledger_migration', '20260820113000_enable_projectos_evidence_candidate_write_scope',
      'prior_ledger_mode', v_prior_ledger_mode,
      'atomic_migration', '20260821160000_submit_projectos_evidence_candidate_atomic',
      'atomic_migration_sha256', '22645821b6434bd24bad17395261bff6476c830abc5d7c5f8db9806940add908',
      'forward_migration', '20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope',
      'bridge_index_sha256', '63c8d4ced312744933d8d036034f9796c7f043740d1f63301ee75ee11e691555',
      'import_map_sha256', 'ca096542a83daaeb67db79e8a5a66bb5ecdd9e0e773e99c5177cc366f0aacbaf',
      'canonical_project_key', 'mcpmaster-pandoras-box',
      'owner_exact_artifact_authorization_required', true,
      'review_required', true,
      'canonical_memory_written', false,
      'privacy_policy', 'metadata_only_v1'
    )
  )
  returning id into v_audit_id;

  if v_audit_id is null then
    raise exception 'projectos evidence forward activation failed: audit insert missing';
  end if;

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
      'scopes', to_jsonb(v_before_scopes)
    )
    and after_snapshot = jsonb_build_object(
      'scopes', to_jsonb(array['memory:health', 'memory:read', 'memory:write']::text[])
    )
    and metadata ->> 'activation_id' = 'memory-evidence-candidate-bridge-prod-activation-20260821'
    and metadata ->> 'governance_issue' = 'banataosystems/pandoras-box-memory#56'
    and metadata ->> 'prior_ledger_migration' = '20260820113000_enable_projectos_evidence_candidate_write_scope'
    and metadata ->> 'atomic_migration' = '20260821160000_submit_projectos_evidence_candidate_atomic'
    and metadata ->> 'atomic_migration_sha256' = '22645821b6434bd24bad17395261bff6476c830abc5d7c5f8db9806940add908'
    and metadata ->> 'forward_migration' = '20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope'
    and metadata ->> 'bridge_index_sha256' = '63c8d4ced312744933d8d036034f9796c7f043740d1f63301ee75ee11e691555'
    and metadata ->> 'import_map_sha256' = 'ca096542a83daaeb67db79e8a5a66bb5ecdd9e0e773e99c5177cc366f0aacbaf'
    and metadata ->> 'owner_exact_artifact_authorization_required' = 'true'
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
