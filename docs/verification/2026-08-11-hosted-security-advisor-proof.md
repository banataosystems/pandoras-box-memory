# Hosted security-advisor proof — 2026-08-11

Scope: canonical Pandora Memory project only. This is evidence-only and does not apply migrations, alter RLS, change Auth, move extensions, deploy Edge Functions, or mutate production application data.

## Provider authority

Supabase project ref: `ivmvufhcsezyhczzondn`
Provider state at verification: `ACTIVE_HEALTHY`
Hosted migration ledger: 67 migrations through version `20260810115547` (`record_flutterflow_oidc_attempts` in current Pandora operating canon).

## Fresh direct hosted catalog proof

A fresh read-only SQL verification against the hosted project returned:

- migration count: **67**
- latest migration version: **`20260810115547`**
- public tables: **81**
- public tables with RLS enabled: **81/81**
- public tables with FORCE RLS: **31**
- public RLS policies: **117**

The four `MEMORY-SEARCHPATH-001` target functions are all currently `SECURITY INVOKER` (`prosecdef=false`) with `proconfig=NULL`, so no persistent `search_path` repair is live yet. Current non-internal trigger bindings are:

- `public.set_pandora_promotion_executions_updated_at()` — **1** binding
- `public.set_pandora_promotion_requests_updated_at()` — **1** binding
- `public.set_pandora_shadow_context_pack_updated_at()` — **1** binding
- `public.set_updated_at()` — **11** bindings

Total target trigger bindings: **14**. This direct catalog proof reconciles the hosted migration/RLS counts with current Pandora canon without changing database state.

## Fresh security-advisor result

A fresh hosted security-advisor query returned:

- 21 `rls_enabled_no_policy` INFO findings.
- 4 `function_search_path_mutable` WARN findings, exactly for:
  - `public.set_pandora_promotion_executions_updated_at`
  - `public.set_updated_at`
  - `public.set_pandora_shadow_context_pack_updated_at`
  - `public.set_pandora_promotion_requests_updated_at`
- 1 `extension_in_public` WARN for the `vector` extension.
- 1 `auth_leaked_password_protection` WARN because leaked-password protection is disabled.

Therefore the current provider security-advisor picture is **21 INFO + 6 WARN**. The four-function `MEMORY-SEARCHPATH-001` repair target is unchanged, but it must not be described as the complete warning inventory.

## Live Edge Function identities

Provider metadata freshly revalidated these live functions:

- `pandora-projectos-bridge` version 13 — SHA-256 `3c63c366389e9cc294b548643738b06d0e594a6ee064a6976dd558e489f5fe0a`
- `pandora-projectos-learning` version 1 — SHA-256 `eec5a67e3e9af88850aa2a0e98dca7a344a54086b51166b5cc0a91e2b0ac82fe`
- `pandora-machine-gateway` version 3 — SHA-256 `6dcdce080275161311a3a872c821db826d09adc02eee5ff9866fcb406d02a30f`

The provider exposes a function-body retrieval endpoint, but the connected management surface could not return the machine-gateway body because the response exceeded the connector size limit. Canonical-vs-live byte parity is therefore not claimed here.

## Gate status

`MEMORY-SEARCHPATH-001` remains unapplied. Its completion still requires:

1. exact candidate source/hash binding for the four search-path functions;
2. safe isolated proof that the four corresponding advisor WARN findings disappear without changing unrelated security findings;
3. preservation of function identity, ACL/security mode and trigger behavior;
4. qualified independent review;
5. separately authorized persistent application if ever promoted.

No production change occurred while producing this evidence.
