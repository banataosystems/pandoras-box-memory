import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/20260820113000_enable_projectos_evidence_candidate_write_scope.sql";
const rollbackPath =
  "supabase/recovery/20260820_disable_projectos_evidence_candidate_write_scope.sql";
const forwardMigrationPath =
  "supabase/migrations/20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope.sql";
const forwardRollbackPath =
  "supabase/recovery/20260821_disable_projectos_evidence_candidate_write_scope_forward_recovery.sql";
const atomicMigrationPath =
  "supabase/migrations/20260821160000_submit_projectos_evidence_candidate_atomic.sql";
const manifestPath =
  "recovery/evidence/memory-evidence-intake-activation-release-manifest.md";
const bridgeCandidateEvidencePath =
  "docs/capabilities/evidence/MEMORY_BRIDGE_EXACT_SOURCE_REPAIR_CANDIDATE_2026-08-21.json";
const atomicSuccessorManifestPath =
  "recovery/evidence/memory-evidence-intake-atomic-successor-manifest.md";
const atomicSuccessorEvidencePath =
  "docs/capabilities/evidence/MEMORY_BRIDGE_ATOMIC_INTAKE_SUCCESSOR_CANDIDATE_2026-08-21.json";
const atomicRpcTestPath = "scripts/test_memory_evidence_atomic_rpc.sh";
const atomicRpcSchemaPath =
  "scripts/fixtures/memory_evidence_atomic_rpc_schema.sql";
const atomicRpcAssertionsPath =
  "scripts/fixtures/memory_evidence_atomic_rpc_assertions.sql";
const bridgeCandidateCheckPath =
  "scripts/check_memory_bridge_repair_candidate.mjs";
const activationCheckPath = "scripts/check_memory_evidence_activation.mjs";
const secretCheckPath = "scripts/check_no_literal_secrets.sh";
const workflowPath = ".github/workflows/memory-evidence-intake.yml";

const migration = fs.readFileSync(migrationPath, "utf8");
const rollback = fs.readFileSync(rollbackPath, "utf8");
const forwardMigration = fs.readFileSync(forwardMigrationPath, "utf8");
const forwardRollback = fs.readFileSync(forwardRollbackPath, "utf8");
const atomicMigration = fs.readFileSync(atomicMigrationPath, "utf8");
const manifest = fs.readFileSync(manifestPath, "utf8");
const secretCheck = fs.readFileSync(secretCheckPath, "utf8");
const workflow = fs.readFileSync(workflowPath, "utf8");
const bridgeCandidateEvidence = JSON.parse(
  fs.readFileSync(bridgeCandidateEvidencePath, "utf8"),
);
const atomicSuccessorEvidence = JSON.parse(
  fs.readFileSync(atomicSuccessorEvidencePath, "utf8"),
);
const sha256 = (path) =>
  crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
const gitBlobSha1 = (path) => {
  const bytes = fs.readFileSync(path);
  return crypto
    .createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");
};

for (const [name, source] of [
  ["migration", migration],
  ["rollback", rollback],
  ["forward migration", forwardMigration],
  ["forward rollback", forwardRollback],
]) {
  assert.match(source, /^begin;/m, `${name} must be transactional`);
  assert.match(source, /^commit;/m, `${name} must commit explicitly`);
  assert.ok(source.includes("set local lock_timeout = '5s'"));
  assert.ok(source.includes("set local statement_timeout = '30s'"));
  assert.ok(source.includes("projectos-mcpmaster-production"));
  assert.ok(source.includes("mcpmaster-pandoras-box"));
  assert.ok(source.includes("7c686cbd-d968-49d5-86cc-918f5e777bd2"));
  assert.ok(source.includes("prj_Y5rZVcq8xJVzHVt4uvfmg9wPvXMk"));
  assert.ok(source.includes("can_propose"));
  assert.ok(source.includes("v_grant.can_approve"));
  assert.ok(source.includes("additional proposal grants exist"));
  assert.ok(source.includes("allowed_namespaces"));
  assert.ok(source.includes("array['real_life']::text[]"));
  assert.ok(!/insert\s+into\s+public\.pandora_(?:projects|project_grants|service_principals)/i.test(source));
  assert.ok(!/update\s+public\.pandora_(?:projects|project_grants)/i.test(source));
  assert.ok(!/set\s+allowed_namespaces\s*=/i.test(source));
}

for (const marker of [
  "drop constraint if exists pandora_service_principals_scopes_check",
  "add constraint pandora_service_principals_scopes_check",
  "'memory:health'::text",
  "'memory:read'::text",
  "'memory:write'::text",
  "set scopes = array['memory:health', 'memory:read', 'memory:write']::text[]",
  "review-gated candidate proposal only",
]) {
  assert.ok(migration.includes(marker), `migration marker missing: ${marker}`);
}

for (const marker of [
  "set scopes = array_remove(scopes, 'memory:write'::text)",
  "drop constraint if exists pandora_service_principals_scopes_check",
  "add constraint pandora_service_principals_scopes_check",
  "Evidence-candidate write scope is disabled",
]) {
  assert.ok(rollback.includes(marker), `rollback marker missing: ${marker}`);
}
assert.ok(!rollback.includes("set scopes = array['memory:health', 'memory:read', 'memory:write']::text[]"));

for (const marker of [
  "20260820150902",
  "20260820113000_enable_projectos_evidence_candidate_write_scope",
  "hosted_rolled_back",
  "clean_replay_active",
  "rolled-back scope constraint definition drift",
  "another principal has write scope",
  "atomic RPC migration missing",
  "atomic RPC privilege drift",
  "atomic audit index drift",
  "atomic audit trigger drift",
  "20260821160000_submit_projectos_evidence_candidate_atomic",
  "22645821b6434bd24bad17395261bff6476c830abc5d7c5f8db9806940add908",
  "insert into public.audit_logs",
  "memory-evidence-candidate-bridge-prod-activation-20260821",
  "banataosystems/pandoras-box-memory#56",
  "63c8d4ced312744933d8d036034f9796c7f043740d1f63301ee75ee11e691555",
  "ca096542a83daaeb67db79e8a5a66bb5ecdd9e0e773e99c5177cc366f0aacbaf",
  "'review_required', true",
  "'canonical_memory_written', false",
]) {
  assert.ok(
    forwardMigration.includes(marker),
    `forward migration marker missing: ${marker}`,
  );
}
assert.ok(
  !forwardMigration.includes("migration repair"),
  "forward recovery must not rewrite hosted migration history",
);
assert.ok(
  !/(?:insert\s+into|update|delete\s+from)\s+supabase_migrations\.schema_migrations/i.test(
    forwardMigration,
  ),
  "forward recovery must leave the prior migration ledger row untouched",
);
assert.ok(
  !forwardMigration.includes(
    "09f7c95fc18333ae708a84f7f0476669c41fdb70a34c24bd7d8edff0f7692656",
  ),
  "forward activation must not bind the superseded PR #55 bridge",
);
assert.ok(
  atomicMigrationPath.localeCompare(forwardMigrationPath) < 0,
  "migration filenames must apply the atomic RPC before scope activation",
);

for (const marker of [
  "Restore and verify the recovered live bridge source",
  "523fec111bfb2c327f69c2abdf0784775ab49a90",
  "exact activated scopes missing",
  "activated scope constraint drift",
  "write scope escaped target principal",
  "insert into public.audit_logs",
  "memory-evidence-candidate-bridge-prod-rollback-20260821",
  "memory-evidence-candidate-bridge-prod-activation-20260821",
  "20260821160000_submit_projectos_evidence_candidate_atomic",
  "22645821b6434bd24bad17395261bff6476c830abc5d7c5f8db9806940add908",
  "20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope",
  "63c8d4ced312744933d8d036034f9796c7f043740d1f63301ee75ee11e691555",
  "preserve_pending_candidates",
  "canonical_memory_deleted",
]) {
  assert.ok(
    forwardRollback.includes(marker),
    `forward rollback marker missing: ${marker}`,
  );
}
assert.ok(!/delete\s+from\s+public\.audit_logs/i.test(forwardRollback));
assert.ok(!/delete\s+from\s+public\.memory_/i.test(forwardRollback));
assert.ok(
  !forwardRollback.includes(
    "20260821014442_forward_reactivate_projectos_evidence_candidate_write_scope",
  ),
);

for (const marker of [
  "begin;",
  "commit;",
  "submit_projectos_evidence_candidate_atomic",
  "projectos_evidence_candidate_atomic_created",
  "prevent_projectos_evidence_intake_audit_mutation",
  "insert into public.memory_capture_candidates",
  "insert into public.memory_review_queue_items",
  "insert into public.audit_logs",
  "canonical_memory_written",
  "grant execute on function public.submit_projectos_evidence_candidate_atomic",
]) {
  assert.ok(atomicMigration.includes(marker), `atomic migration marker missing: ${marker}`);
}
assert.ok(!/delete\s+from\s+public\.(?:memory_|audit_logs)/i.test(atomicMigration));

assert.ok(
  secretCheck.includes('grep -nE -- "$pattern"'),
  "secret scan must terminate grep options before an option-like regex",
);

const activate = (scopes) => {
  const allowed = new Set(["memory:health", "memory:read", "memory:write"]);
  assert.ok(scopes.includes("memory:health"));
  assert.ok(scopes.includes("memory:read"));
  assert.ok(scopes.every((scope) => allowed.has(scope)));
  return ["memory:health", "memory:read", "memory:write"];
};
const deactivate = (scopes) => scopes.filter((scope) => scope !== "memory:write");
assert.deepEqual(activate(["memory:health", "memory:read"]), [
  "memory:health",
  "memory:read",
  "memory:write",
]);
assert.deepEqual(activate(activate(["memory:health", "memory:read"])), [
  "memory:health",
  "memory:read",
  "memory:write",
]);
assert.deepEqual(deactivate(["memory:health", "memory:read", "memory:write"]), [
  "memory:health",
  "memory:read",
]);
assert.deepEqual(deactivate(deactivate(["memory:health", "memory:read"])), [
  "memory:health",
  "memory:read",
]);
assert.throws(() => activate(["memory:health", "memory:read", "memory:admin"]));

for (const path of [
  migrationPath,
  rollbackPath,
  forwardMigrationPath,
  forwardRollbackPath,
  atomicMigrationPath,
  manifestPath,
  bridgeCandidateEvidencePath,
  atomicSuccessorManifestPath,
  atomicSuccessorEvidencePath,
  atomicRpcTestPath,
  atomicRpcSchemaPath,
  atomicRpcAssertionsPath,
  bridgeCandidateCheckPath,
  secretCheckPath,
]) {
  assert.ok(workflow.includes(path), `workflow path filter missing: ${path}`);
}
assert.ok(workflow.includes("node scripts/check_memory_evidence_activation.mjs"));
assert.ok(workflow.includes("node scripts/check_memory_bridge_repair_candidate.mjs --self-test"));

const targetSource = bridgeCandidateEvidence.target_deployment.source;
const atomicSource = atomicSuccessorEvidence.candidate_source;
assert.equal(targetSource.index_blob_sha1, atomicSource.bridge.blob_sha1);
assert.equal(targetSource.index_raw_sha256, atomicSource.bridge.raw_sha256);
assert.equal(targetSource.index_bytes, atomicSource.bridge.bytes);
assert.equal(
  bridgeCandidateEvidence.forward_recovery.successor_exact_artifact_authorized,
  false,
);
assert.equal(
  bridgeCandidateEvidence.authorization.successor_exact_artifact_authorized,
  false,
);
assert.deepEqual(bridgeCandidateEvidence.forward_recovery.activation_order, [
  atomicMigrationPath,
  forwardMigrationPath,
  "supabase/functions/pandora-projectos-bridge/index.ts",
]);
assert.deepEqual(atomicSuccessorEvidence.activation_order, [
  atomicMigrationPath,
  forwardMigrationPath,
  "supabase/functions/pandora-projectos-bridge/index.ts",
]);
for (const [artifact, path] of [
  [bridgeCandidateEvidence.forward_recovery.atomic_migration, atomicMigrationPath],
  [bridgeCandidateEvidence.forward_recovery.migration, forwardMigrationPath],
  [bridgeCandidateEvidence.forward_recovery.rollback, forwardRollbackPath],
]) {
  assert.equal(artifact.path, path);
  assert.equal(artifact.raw_sha256, sha256(path));
  assert.equal(artifact.blob_sha1, gitBlobSha1(path));
  assert.equal(artifact.bytes, fs.statSync(path).size);
}

for (const marker of [
  "ATOMIC SUCCESSOR / BLOCKED",
  "478105057c1ca5fb5b356750ba1fa1fb58b1f42c",
  "9adabe26f62205b0f94adc5744151c2d68c2c46e",
  "63c8d4ced312744933d8d036034f9796c7f043740d1f63301ee75ee11e691555",
  "pandora-projectos-bridge@15",
  "7d2388c4c101ea3ca023e7c354aa5e08e7e02c49db5d51baf752ef27debfcb0a",
  "07ebf082e15867faae27c74ce9c1074d466e7f08",
  "dpl_7d7WTrvGvrv8cC9ZMrCc59qmDUUk",
  "0fcacb20c0ff46ca224ca1769098ac3db14bb83d9bb264b755c23a58f2382e78",
  "No automatic canonical Memory promotion",
  "memory-evidence-candidate-bridge-prod-activation-20260821",
  "banataosystems/pandoras-box-memory#56",
  "Issue #56 does not authorize this successor",
]) {
  assert.ok(manifest.includes(marker), `manifest marker missing: ${marker}`);
}
for (const path of [
  activationCheckPath,
  workflowPath,
  bridgeCandidateEvidencePath,
  bridgeCandidateCheckPath,
  atomicSuccessorEvidencePath,
  atomicRpcTestPath,
  atomicSuccessorManifestPath,
]) {
  assert.ok(
    manifest.includes(sha256(path)),
    `manifest artifact hash missing or stale: ${path}`,
  );
}
assert.ok(
  manifest.indexOf(
    "Apply `supabase/migrations/20260821160000_submit_projectos_evidence_candidate_atomic.sql` first",
  ) <
    manifest.indexOf(
      "Apply `supabase/migrations/20260821163000_forward_reactivate_projectos_evidence_candidate_write_scope.sql` second",
    ),
  "manifest activation order must be atomic RPC then scope activation",
);

console.log("Governed Memory evidence-intake activation contract: PASS");
