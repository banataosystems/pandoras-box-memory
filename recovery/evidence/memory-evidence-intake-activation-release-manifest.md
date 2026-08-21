# Pandora Memory evidence-candidate activation release manifest

Status: **EXACT-SOURCE CANDIDATE / BLOCKED** — canonical source is ready, live Supabase parity is RED, and production activation is not authorized by this manifest.

Owner production authorization is recorded under activation ID `memory-evidence-candidate-bridge-prod-activation-20260821` in `banataosystems/pandoras-box-memory#56`. That authorization creates the separate governed activation task; it does not waive exact-head CI, qualified independent review, transaction-only proof of the new forward migration, provider readback, or rollback gates. No production mutation is made by this source candidate.

Fresh provider readback: 2026-08-20T18:51:00Z. This section supersedes the bridge@13 and older Vercel identities preserved in the historical PR #52 evidence record.

## Incident and root cause

`memory.submitEvidenceCandidate` repeatedly returned HTTP 400 for structurally valid, privacy-safe payloads. The public Memory route serializes the exact expected request, but fresh authenticated readback proves live Supabase Edge Function `pandora-projectos-bridge@15` contains no `submit_evidence_candidate` action. The live v15 files are byte-identical to recovered source commit `523fec111bfb2c327f69c2abdf0784775ab49a90`; the function therefore falls through to `unsupported_action`.

Deploying bridge source alone is insufficient. Production principal `projectos-mcpmaster-production` currently has only `memory:health` and `memory:read`, and the live table constraint rejects any other scope. The new handler requires `memory:write`. Existing project and proposal-grant bindings are already correct and must not be broadened.

## Exact evidence baseline

- Canonical repository: `banataosystems/pandoras-box-memory`
- Current source head: `478105057c1ca5fb5b356750ba1fa1fb58b1f42c`
- Current source tree: `fb4909bd962ddf32df3a63fbd46c136d7b3d9d88`
- Current bridge raw SHA-256: `09f7c95fc18333ae708a84f7f0476669c41fdb70a34c24bd7d8edff0f7692656`
- Current bridge size: 45,193 bytes / 1,264 lines
- Current bridge Git blob: `54a5e6429fea4e26a6717bdc8cdf8d09ef450d9d`
- Live Edge Function: `pandora-projectos-bridge@15`, function ID `0e7e24e6-7cb7-46d0-b474-3d626898d7e6`, status `ACTIVE`
- Live provider package SHA-256: `7d2388c4c101ea3ca023e7c354aa5e08e7e02c49db5d51baf752ef27debfcb0a`
- Live provider source readback: 18,758 bytes, raw SHA-256 `7cdb0e6a2ae74a6ea970ba537f8ff04c64cfd2c608e8b8e6c4a394dcff8d07cf`
- Recovered live source commit: `523fec111bfb2c327f69c2abdf0784775ab49a90`
- Recovered live source Git blob: `07ebf082e15867faae27c74ce9c1074d466e7f08`
- Recovered live source raw SHA-256: `7cdb0e6a2ae74a6ea970ba537f8ff04c64cfd2c608e8b8e6c4a394dcff8d07cf`
- Recovered live import-map Git blob: `915cbeb478c0c52cc8be8f03cb307f4f72fed7d3`
- Evidence-intake merge commit: `d0e689556cc01428500b796cade87032ea5c0ad8`
- Canonical project key: `mcpmaster-pandoras-box`
- Canonical Memory project UUID: `7c686cbd-d968-49d5-86cc-918f5e777bd2`
- Production principal: `projectos-mcpmaster-production`
- Exact test candidate hash: `0fcacb20c0ff46ca224ca1769098ac3db14bb83d9bb264b755c23a58f2382e78`
- Partial candidate/review rows before repair: zero
- Hosted historical activation ledger row: version `20260820150902`, name `20260820113000_enable_projectos_evidence_candidate_write_scope`, one statement
- Live runtime state after the historical transaction-only rollback: exact scopes `memory:health` and `memory:read`; the historical ledger row remains intact
- Governed activation task: `banataosystems/pandoras-box-memory#56`, activation ID `memory-evidence-candidate-bridge-prod-activation-20260821`
- Memory Vercel production deployment: `dpl_7d7WTrvGvrv8cC9ZMrCc59qmDUUk`, project `prj_brg3BJDcHfSftHH84NhnFtDJAnDO`, state `READY`, exact Git SHA `478105057c1ca5fb5b356750ba1fa1fb58b1f42c`

PR #52 supplied the activation migration, database rollback, source tests, and one review-only approval reproduced by PR #53. The focused parity candidate must still pass exact-head CI and receive a qualified review bound to its own final head. PRs #34, #48, and #51 are separate, non-selected lanes and must not be mixed into this repair.

## Source-only repair

1. Historical migration `supabase/migrations/20260820113000_enable_projectos_evidence_candidate_write_scope.sql`
   - Fails closed on principal, namespace, project, environment, and grant drift.
   - Permits only `memory:health`, `memory:read`, and review-gated `memory:write`.
   - Adds no project, grant, namespace, approval permission, candidate, review decision, or canonical Memory row.
   - Refuses activation if any additional active proposal grant exists.
   - Its hosted ledger row is preserved as truthful evidence of the earlier apply/readback/rollback proof; it must not be repaired, deleted, renamed, or replayed for production activation.
2. Forward migration `supabase/migrations/20260821014442_forward_reactivate_projectos_evidence_candidate_write_scope.sql`
   - Has a unique source identity, checks the exact hosted historical ledger row, and requires the exact rolled-back scope constraint before changing it.
   - Fails closed on principal, namespace, project, environment, grant, additional proposal grants, any other write-scoped principal, prior activation audit, and constraint drift.
   - Expands only the scope allowlist, assigns `memory:write` only to the exact ProjectOS production principal, and proves the postcondition is exactly one write-scoped principal.
   - Inserts and reads back a same-transaction `public.audit_logs` row bound to the server-derived principal user, `real_life`, issue #56, activation ID, prior ledger migration, exact bridge/import-map hashes, and `review_required=true`.
   - Records no candidate content, direct identifier, secret, approval, or canonical Memory mutation.
   - Also accepts the exact clean-replay ledger/constraint state produced when the historical migration is applied from source; no other baseline is accepted.
3. Historical proof rollback `supabase/recovery/20260820_disable_projectos_evidence_candidate_write_scope.sql`
   - Removes only `memory:write`.
   - Restores the previous scope constraint.
   - Preserves health/read and the existing project/grant records.
4. Forward-activation rollback `supabase/recovery/20260821_disable_projectos_evidence_candidate_write_scope_forward_recovery.sql`
   - Requires the exact activated scopes, constraint, principal, project, grant, sole write-scoped principal, and activation audit.
   - Removes only `memory:write`, restores the exact read-only constraint, preserves the activation audit and pending candidates, and appends a separate rollback audit in the same transaction.
5. Static/behavior check `scripts/check_memory_evidence_activation.mjs`.
6. CI path and execution binding in `.github/workflows/memory-evidence-intake.yml`.
7. Exact provider/source/forward-recovery binding in `docs/capabilities/evidence/MEMORY_BRIDGE_EXACT_SOURCE_REPAIR_CANDIDATE_2026-08-21.json`.
8. Fail-closed parity and rollback regression in `scripts/check_memory_bridge_repair_candidate.mjs`.
9. Literal-secret scanner fix in `scripts/check_no_literal_secrets.sh`: `grep` options now terminate before option-like patterns such as the private-key signature.

Prepared source artifact SHA-256 values:

- Migration: `04cf14864a2f53e9d577281ad01002a95688608f53eac5290133ad14578653ea`
- Rollback: `bd8250f19ba32640d5211727ec9bf6d9d31c594c97adb8b3549cc48dd85af779`
- Forward migration: `c5107b7ebac2a070c129ea84b5a8d53db5a380d65f41c626fd1b333e4111fae4`
- Forward rollback: `43e4e9a0d4470abffbdad22c4069d4bb475ab191114dfa229b29c48a703f5627`
- Activation check: `d416bad9d213ec3d9f25afc1b642503c2d60d1f5607724469a6a17607ffd662e`
- Workflow: `dc4fcb97bb920b7fc53f9221ec3042a6162fe03a5df665a8f40fa1169e1ac88d`
- Exact-source evidence: `aaedb78281feee6187357631eebf4f4d53cf95f1839bc63e43991341753a069b`
- Exact-source verifier: `8b2a045ed319190da68e74e2e1715f8cd6468b1478950ff8c43d2847f801bcc1`
- Literal-secret scanner: `a8705ad3259ce1a6a49ebe1fb5f679ce8d4fae30285ef8871b6d60c8e6e015dd`
- Behavior regression: `a42d6bccc6427841ec1d588469d1cac1f0ab5562c429bbfc3d7bda40dfca5a64`

## Production activation gate

Production activation requires all of the following:

1. Exact-head CI success for the repair PR, including existing evidence-intake behavior, secret scan, dependency audit, typecheck, build, and activation/rollback checks.
2. Different qualified reviewer approval bound to the exact repair head.
3. Transaction-only apply/readback/rollback proof against the live Memory database, with zero persistent state change.
4. Confirm the recorded owner production authorization still matches issue #56, activation ID `memory-evidence-candidate-bridge-prod-activation-20260821`, and the exact final reviewed head.
5. Re-read live bridge version/hash and principal/project/grant state immediately before execution.
6. Apply only `supabase/migrations/20260821014442_forward_reactivate_projectos_evidence_candidate_write_scope.sql`. Read back its new hosted ledger row, exact scopes/constraint/grant, sole write-scoped principal, and activation audit. The old bridge remains fail-closed during this temporary scope-only interval.
7. Deploy only bridge blob `54a5e6429fea4e26a6717bdc8cdf8d09ef450d9d` with import-map blob `915cbeb478c0c52cc8be8f03cb307f4f72fed7d3`. Read back the provider-assigned version, package hash, raw files, configuration, and health/search behavior; do not predict the provider version or package hash.
8. Submit the Systems Mastery candidate exactly once. Verify one pending candidate plus one pending-review item, idempotency binding, privacy metadata, and `canonical_memory_written=false`.
9. Observe the public route and Memory health; do not infer success from deployment status alone.

No automatic canonical Memory promotion is authorized. Candidate approval/persistence remains a separate authenticated human-review action.

## Rollback gate and order

Supabase does not provide a native version rollback for this deployment path. The current live v15 bytes are content-addressed and exactly recoverable, but restoration has not been rehearsed and is not qualified for automatic rollback.

1. Redeploy the recovered live bridge source from commit `523fec111bfb2c327f69c2abdf0784775ab49a90` as a new function version and verify the raw provider files match blob `07ebf082e15867faae27c74ce9c1074d466e7f08` / SHA-256 `7cdb0e6a2ae74a6ea970ba537f8ff04c64cfd2c608e8b8e6c4a394dcff8d07cf`.
2. Run `supabase/recovery/20260821_disable_projectos_evidence_candidate_write_scope_forward_recovery.sql` exactly once and read back its rollback audit. Do not delete or repair the historical or forward migration ledger rows.
3. Verify exact principal scopes are `memory:health` and `memory:read` only.
4. Verify the canonical project and proposal grant are unchanged.
5. Verify Memory health/search remain functional and evidence submission fails closed.
6. Preserve any pending review-gated candidate created before rollback; do not promote, overwrite, or delete it automatically.

## Authorization boundary

This manifest does not itself authorize merge, production migration, Edge Function deployment, Vercel production effects, candidate retry, review approval, or canonical promotion. Owner production authorization is recorded in issue #56, but execution remains blocked until the exact final head passes CI, qualified independent review, new forward-migration transaction proof, fresh provider preflight, and recovery checks. The governed Systems Mastery candidate with idempotency key `master-pandora-systems-v1-installed-20260821` may be resubmitted and read back only after the separately governed bridge activation passes provider source-parity verification.
