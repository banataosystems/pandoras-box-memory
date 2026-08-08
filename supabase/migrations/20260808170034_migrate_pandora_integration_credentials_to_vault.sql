begin;

alter table private.pandora_integration_credentials
  add column if not exists vault_secret_id uuid;

alter table private.pandora_integration_credentials
  alter column secret_value drop not null;

do $$
declare
  r record;
  v_secret_id uuid;
begin
  for r in
    select integration_key, secret_value
    from private.pandora_integration_credentials
    where is_active = true
      and vault_secret_id is null
      and secret_value is not null
  loop
    select vault.create_secret(
      r.secret_value,
      'pandora_integration:' || r.integration_key,
      'Pandora integration credential migrated from private.pandora_integration_credentials',
      null
    ) into v_secret_id;

    update private.pandora_integration_credentials
    set vault_secret_id = v_secret_id,
        updated_at = now()
    where integration_key = r.integration_key;
  end loop;
end;
$$;

create or replace function public.pandora_integration_credential(p_integration_key text)
returns jsonb
language plpgsql
security definer
set search_path = private, public, vault, auth, pg_temp
as $$
declare
  result jsonb;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'pandora_forbidden';
  end if;

  select jsonb_build_object(
    'integration_key', c.integration_key,
    'secret_value', v.decrypted_secret,
    'memory_user_id', c.memory_user_id,
    'allowed_product_keys', c.allowed_product_keys,
    'is_active', c.is_active
  )
  into result
  from private.pandora_integration_credentials c
  join vault.decrypted_secrets v on v.id = c.vault_secret_id
  where c.integration_key = p_integration_key
    and c.is_active;

  return result;
end;
$$;

revoke all on function public.pandora_integration_credential(text) from public, anon, authenticated;
grant execute on function public.pandora_integration_credential(text) to service_role;

update private.pandora_integration_credentials
set secret_value = null,
    updated_at = now()
where vault_secret_id is not null;

commit;
