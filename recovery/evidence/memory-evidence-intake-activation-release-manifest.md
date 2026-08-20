# Pandora Memory evidence-candidate activation release manifest

Status: **LIVE / BLOCKED** — source repair prepared; production activation is not authorized by this manifest.

## Incident and root cause

`memory.submitEvidenceCandidate` repeatedly returned HTTP 400 for structurally valid, privacy-safe payloads. The public Memory route serializes the exact expected request, but live Supabase Edge Function `pandora-projectos-bridge@13` was last deployed on 2026-08-07 and contains no `submit_evidence_candidate` action. The handler was added later in Memory PR #27 on 2026-08-17. The live function therefore falls through to `unsupported_action`.

Deploying bridge source alone is insufficient. Production principal `projectos-mcpmaster-production` currently has only `memory:health` and `memory:read`, and the live table constraint rejects any other scope. The new handler requires `memory:write`. Existing project and proposal-grant bindings are already correct and must not be broadened.

## Exact evidence baseline

- Canonical repository: `banataosystems/pandoras-box-memory`
- Current source head: `63d133f6e865a2cf6f4a874c6304ce351df9ac4a`
- Current source tree: `61b8dfd946df622d1e1d3f51f9da18fab94ff6d6`
- Current bridge raw SHA-256: `09f7c95fc18333ae708a84f7f0476669c41fdb70a34c24bd7d8edff0f7692656`
- Current bridge size: 45,193 bytes / 1,264 lines
- Live Edge Function: `pandora-projectos-bridge@13`
- Live provider package SHA-256: `3c63c366389e9cc294b548643738b06d0e594a6ee064a6976dd558e489f5fe0a`
- Recovered live source commit: `523fec111bfb2c327f69c2abdf0784775ab49a90`
- Recovered live source raw SHA-256: `7cdb0e6a2ae74a6ea970ba537f8ff04c64cfd2c608e8b8e6c4a394dcff8d07cf`
- Evidence-intake merge commit: `d0e689556cc01428500b796cade87032ea5c0ad8`
- Canonical project key: `mcpmaster-pandoras-box`
- Canonical Memory project UUID: `7c686cbd-d968-49d5-86cc-918f5e777bd2`
- Production principal: `projectos-mcpmaster-production`
- Exact test candidate hash: `0fcacb20c0ff46ca224ca1769098ac3db14bb83d9bb264b755c23a58f2382e78`
- Partial candidate/review rows before repair: zero

Current-main workflow evidence at exact source head:

- Pandora source security gate: run `32271524062` — success
- Capability Registry Gate: run `32271524161` — success
- Memory canon promotion gate: run `32271524193` — success

PR #27 had no independent GitHub review. Its merge commit had a failed capability-registry run, so independent exact-candidate review remains required even though the byte-identical bridge source now sits on a later all-green current head.

## Source-only repair

1. Migration `supabase/migrations/20260820113000_enable_projectos_evidence_candidate_write_scope.sql`
   - Fails closed on principal, namespace, project, environment, and grant drift.
   - Permits only `memory:health`, `memory:read`, and review-gated `memory:write`.
   - Adds no project, grant, namespace, approval permission, candidate, review decision, or canonical Memory row.
   - Refuses activation if any additional active proposal grant exists.
2. Rollback `supabase/recovery/20260820_disable_projectos_evidence_candidate_write_scope.sql`
   - Removes only `memory:write`.
   - Restores the previous scope constraint.
   - Preserves health/read and the existing project/grant records.
3. Static/behavior check `scripts/check_memory_evidence_activation.mjs`.
4. CI path and execution binding in `.github/workflows/memory-evidence-intake.yml`.

Prepared source artifact SHA-256 values:

- Migration: `04cf14864a2f53e9d577281ad01002a95688608f53eac5290133ad14578653ea`
- Rollback: `bd8250f19ba32640d5211727ec9bf6d9d31c594c97adb8b3549cc48dd85af779`
- Activation check: `80f648a43667fb98d143c5cc49e828e0a932ecc5fe029a1c27e70d6785bb5d7b`
- Workflow: `bc51cead80fc4d81cdf1789c8f201b94d088edf19a9b6005be8b888d0aaae274`

## Production activation gate

Production activation requires all of the following:

1. Exact-head CI success for the repair PR, including existing evidence-intake behavior, secret scan, dependency audit, typecheck, build, and activation/rollback checks.
2. Different qualified reviewer approval bound to the exact repair head.
3. Transaction-only apply/readback/rollback proof against the live Memory database, with zero persistent state change.
4. Explicit owner production authorization.
5. Re-read live bridge version/hash and principal/project/grant state immediately before execution.
6. Apply the exact migration first. The old bridge remains fail-closed during this temporary scope-only interval.
7. Deploy the exact current bridge and import map. Verify new provider version/hash and health/search behavior.
8. Submit the Systems Mastery candidate exactly once. Verify one pending candidate plus one pending-review item, idempotency binding, privacy metadata, and `canonical_memory_written=false`.
9. Observe the public route and Memory health; do not infer success from deployment status alone.

No automatic canonical Memory promotion is authorized. Candidate approval/persistence remains a separate authenticated human-review action.

## Rollback gate and order

1. Restore the recovered live bridge source from commit `523fec111bfb2c327f69c2abdf0784775ab49a90` and verify provider readback.
2. Run `supabase/recovery/20260820_disable_projectos_evidence_candidate_write_scope.sql`.
3. Verify exact principal scopes are `memory:health` and `memory:read` only.
4. Verify the canonical project and proposal grant are unchanged.
5. Verify Memory health/search remain functional and evidence submission fails closed.
6. Preserve any pending review-gated candidate created before rollback; do not promote, overwrite, or delete it automatically.

## Authorization boundary

This manifest does not authorize merge, production migration, Edge Function deployment, candidate retry, review approval, or canonical promotion. Explicit owner production authorization is required after exact-head proof and independent review.
