# Legacy Secret Migration Finding — 2026-08-09

## Severity
High until all affected legacy credentials are rotated.

## Finding
During Phase 0 source recovery, historical Supabase migration records were found to contain literal integration credential material. The values are intentionally not reproduced in this repository, issue tracker, logs, or documentation.

This supersedes the earlier statement in `docs/recovery/LIVE_MEMORY_STATE_2026-08-09.md` that no secret values were encountered during assessment.

## Immediate containment completed
Production migration `migrate_pandora_integration_credentials_to_vault` was applied to Memory project `ivmvufhcsezyhczzondn`.

The migration:
- added a Vault secret reference to `private.pandora_integration_credentials`;
- copied each active current credential into Supabase Vault entirely server-side;
- changed `public.pandora_integration_credential(text)` to resolve the decrypted value from Vault only for the service-role RPC path;
- removed plaintext current values from `private.pandora_integration_credentials` by setting the old field to NULL;
- preserved caller-visible behavior so current integrations were not intentionally broken during containment.

Post-migration verification observed:
- total integration credential records: 2;
- Vault-backed records: 2;
- current plaintext values remaining in the private credentials table: 0.

No secret value is stored in this document.

## Residual risk
Moving current values to Vault does not invalidate literal values that may exist in immutable/historical migration records or other old recovery artifacts. Any credential ever embedded in source or migration history must be treated as exposed and rotated after its active callers are mapped.

## Required remediation sequence
1. Inventory all callers of each affected integration key without exposing the secret values.
2. Create replacement secrets in Vault.
3. Update the corresponding caller configuration atomically or with an overlap strategy where supported.
4. Verify valid calls succeed with the replacement credential.
5. Verify the historical credential is rejected.
6. Record rotation timestamp, owner, integration key, evidence, and rollback state without recording the value.
7. Review historical source/recovery archives for additional embedded credentials.
8. Add a release gate forbidding literal secrets in migrations and source.

## Source-recovery policy
Historical migration SQL containing literal credentials must not be copied verbatim into the canonical GitHub repository. Parity is preserved using migration version, migration name, statement count, and SHA-256 of the live migration statements. Sanitized replacement migrations may be reconstructed only after their behavior is understood.

## Status
- Current live credential storage migrated to Vault: IMPLEMENTED and DATABASE-VERIFIED.
- Affected credentials rotated: NOT YET VERIFIED.
- Historical secret invalidation: NOT YET VERIFIED.
- Source-control secret scanning gate: NOT YET IMPLEMENTED.
