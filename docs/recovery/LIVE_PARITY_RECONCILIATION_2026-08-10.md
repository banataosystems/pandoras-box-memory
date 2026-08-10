# Pandora Memory live-source parity reconciliation — 2026-08-10

## Scope

This is a non-mutating reconciliation of the live Supabase Memory runtime against canonical source in `banataosystems/pandoras-box-memory` after the ProjectOS → Pandora Memory connector recovery.

No Supabase migration, Edge Function deployment, credential rotation, Vercel deployment, or production data mutation is performed by this evidence change.

## Current production anchor

- Memory Supabase project: `ivmvufhcsezyhczzondn`
- Memory web production: `dpl_7CbTiMxMXQZjrLQDKchf455iBxi4` — READY
- Memory web rollback baseline: `dpl_9EkwxicRPzigkvUis5m1qk644CrG`
- Canonical source repository: `banataosystems/pandoras-box-memory`
- ProjectOS Memory connector: production-verified before this reconciliation

## Live migration inventory

Direct live query on 2026-08-10 observed:

- migration count: **67**
- latest migration: `20260810115547_record_flutterflow_oidc_attempts`

The older canonical inventory document recorded 53 migrations through `20260808170034_migrate_pandora_integration_credentials_to_vault`, so it is stale and must not be used as current migration-count proof.

### Live migrations after the old 53-migration inventory

The following 14 migrations are present in live Supabase after `20260808170034`:

1. `20260808181824_add_machine_gateway_authorization_registry`
2. `20260808183717_add_gateway_service_action_registry`
3. `20260808190813_add_gateway_workload_oidc`
4. `20260808220117_record_owner_env_admin_recovery_grant`
5. `20260809140538_gateway_auto_enroll_oauth_memory_clients`
6. `20260810032703_flutterflow_secure_credential_handoff_v1`
7. `20260810044812_flutterflow_manual_vault_secret_lookup_v1`
8. `20260810045632_flutterflow_private_yaml_snapshot_cache_v1`
9. `20260810052850_flutterflow_private_snapshot_writer_v1`
10. `20260810055928_flutterflow_private_snapshot_reader_v1`
11. `20260810060747_flutterflow_private_snapshot_files_reader_v1`
12. `20260810102152_flutterflow_github_oidc_broker`
13. `20260810103038_fix_flutterflow_oidc_service_role_gate`
14. `20260810115547_record_flutterflow_oidc_attempts`

Direct canonical-path checks confirmed at least the two newest migrations (`20260810103038` and `20260810115547`) are **not** present under `supabase/migrations/` on canonical `main`. Therefore complete live migration/source parity is not yet proven.

The inspected post-recovery migration statements contain no literal provider credential values. Secret material is referenced through Supabase Vault/decrypted-secret boundaries rather than embedded values. Historical secret-bearing migrations remain subject to the earlier no-copy recovery rule.

## Core Edge Function inventory

Direct live provider inspection observed:

| Function | Live version | Status | Provider artifact SHA-256 |
|---|---:|---|---|
| `pandora-projectos-bridge` | 13 | ACTIVE | `3c63c366389e9cc294b548643738b06d0e594a6ee064a6976dd558e489f5fe0a` |
| `pandora-projectos-learning` | 1 | ACTIVE | `eec5a67e3e9af88850aa2a0e98dca7a344a54086b51166b5cc0a91e2b0ac82fe` |
| `pandora-machine-gateway` | 3 | ACTIVE | `6dcdce080275161311a3a872c821db826d09adc02eee5ff9866fcb406d02a30f` |

Canonical source files exist for all three:

- `supabase/functions/pandora-projectos-bridge/index.ts`
- `supabase/functions/pandora-projectos-learning/index.ts`
- `supabase/functions/pandora-machine-gateway/index.ts`

The retrieved bridge and learning source align structurally with the live provider source. Exact byte-for-byte equality is **not claimed** from the provider package hash because `ezbr_sha256` is an artifact/package hash rather than a raw source-file SHA.

For `pandora-machine-gateway`, canonical source is not text-identical to the retrieved live v3 source: canonical source includes a later issuer-shape validation comment/context not present in the live retrieved source. Treat canonical source as **ahead/different** until an exact diff and deployment review is completed. Do not deploy canonical gateway source merely to make parity appear clean.

## Classification

### Production-verified and unchanged

- Memory web/ProjectOS connector remains production-verified.
- Live Supabase Memory project remains the runtime authority.
- No production mutation occurred during this reconciliation.

### Recovered in canonical source

- ProjectOS web health/search routes and bridge proxy.
- Core bridge/learning/gateway source paths.
- Production/rollback recovery evidence.

### Still open

1. Preserve the exact 14 post-inventory live migration statements as safe recovery source without causing migration replay.
2. Produce an exact source-level diff for each live core Edge Function versus canonical source.
3. Resolve the `pandora-machine-gateway` source divergence through review; do not blind-deploy.
4. Update the stale migration inventory only after the safe recovery source/manifest is committed.
5. Obtain independent qualified review of the exact live Memory lifecycle/runtime hardening.
6. Repair Vercel Git auto-deploy separately when a control-plane mutation is available.

## Safety rule

Source parity is an evidence problem, not a reason to mutate a working runtime. New recovery source must preserve live provenance and parent history. Never redeploy a function or replay a migration solely to make GitHub look synchronized.
