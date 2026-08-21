import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const evidencePath =
  "docs/capabilities/evidence/MEMORY_BRIDGE_ATOMIC_INTAKE_SUCCESSOR_CANDIDATE_2026-08-21.json";

const read = (path) => fs.readFileSync(path);
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const gitBlobSha1 = (bytes) =>
  crypto
    .createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");

const gitShow = (commit, path) => {
  assert.match(commit, /^[0-9a-f]{40}$/);
  assert.match(path, /^[A-Za-z0-9._/-]+$/);
  return execFileSync("git", ["show", `${commit}:${path}`], {
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
  });
};

const assertArtifact = (artifact, label) => {
  const bytes = read(artifact.path);
  assert.equal(bytes.length, artifact.bytes, `${label} byte length drift`);
  assert.equal(sha256(bytes), artifact.raw_sha256, `${label} SHA-256 drift`);
  if (artifact.blob_sha1) {
    assert.equal(gitBlobSha1(bytes), artifact.blob_sha1, `${label} Git blob drift`);
  }
  return bytes;
};

const validate = (evidence) => {
  assert.equal(evidence.schema_version, "1.0.0");
  assert.equal(evidence.proof_stage, "implemented");
  assert.equal(evidence.repository.full_name, "banataosystems/pandoras-box-memory");
  assert.equal(evidence.repository.repository_id, 1327294429);
  assert.equal(
    evidence.repository.base_commit,
    "478105057c1ca5fb5b356750ba1fa1fb58b1f42c",
  );
  assert.equal(
    evidence.repository.base_tree,
    "fb4909bd962ddf32df3a63fbd46c136d7b3d9d88",
  );
  assert.equal(evidence.repository.superseded_pr, 55);
  assert.equal(
    evidence.repository.successor_parent_commit,
    "edb82476b2dfefef0e94ced1456b241f79caa889",
  );
  assert.equal(
    evidence.repository.successor_parent_tree,
    "18740e6a0691067a7c18def2e6623a625ff97b35",
  );
  assert.equal(
    evidence.repository.branch,
    "fix/memory-evidence-intake-atomic-successor-20260821",
  );

  const bridge = evidence.candidate_source.bridge;
  const bridgeBytes = assertArtifact(bridge, "atomic successor bridge");
  const bridgeSource = bridgeBytes.toString("utf8");
  assert.ok(bridgeSource.includes('body.action === "submit_evidence_candidate"'));
  assert.ok(
    bridgeSource.includes('EVIDENCE_ATOMIC_RPC = "submit_projectos_evidence_candidate_atomic"'),
  );
  assert.ok(bridgeSource.includes("admin.rpc("));
  assert.ok(bridgeSource.includes("audit_id: atomicResult.audit_id"));
  assert.ok(bridgeSource.includes("atomic_transaction: true"));
  const helperStart = bridgeSource.indexOf("const EVIDENCE_PROOF_STAGES");
  const serveStart = bridgeSource.search(/Deno\.serve\(/);
  assert.ok(helperStart >= 0 && serveStart > helperStart);
  const helper = bridgeSource.slice(helperStart, serveStart);
  assert.ok(!helper.includes('.from("memory_capture_candidates")'));
  assert.ok(!helper.includes('.from("memory_review_queue_items")'));
  assert.ok(!helper.includes('.from("memory_items")'));
  assert.equal(bridge.required_markers.submit_evidence_candidate, true);
  assert.equal(
    bridge.required_markers.atomic_rpc,
    "submit_projectos_evidence_candidate_atomic",
  );
  assert.equal(bridge.required_markers.direct_candidate_write, false);
  assert.equal(bridge.required_markers.direct_review_write, false);
  assert.equal(bridge.required_markers.canonical_memory_write, false);

  const baseBridge = gitShow(evidence.repository.base_commit, bridge.path);
  assert.equal(
    sha256(baseBridge),
    "09f7c95fc18333ae708a84f7f0476669c41fdb70a34c24bd7d8edff0f7692656",
  );
  assert.notEqual(sha256(baseBridge), bridge.raw_sha256);
  assert.deepEqual(
    gitShow(evidence.repository.successor_parent_commit, bridge.path),
    baseBridge,
    "PR #55 must remain the unchanged successor parent",
  );

  assertArtifact(evidence.candidate_source.import_map, "import map");
  const migration = evidence.candidate_source.atomic_migration;
  const migrationBytes = assertArtifact(migration, "atomic RPC migration");
  const migrationSource = migrationBytes.toString("utf8");
  for (const marker of [
    "begin;",
    "commit;",
    "submit_projectos_evidence_candidate_atomic",
    "security definer",
    "insert into public.memory_capture_candidates",
    "insert into public.memory_review_queue_items",
    "insert into public.audit_logs",
    "projectos_evidence_candidate_atomic_created",
    "prevent_projectos_evidence_intake_audit_mutation",
    "pg_get_indexdef(i.indexrelid, 1, true)",
    "v_key_definition is distinct from 'record_id'",
    "on conflict (user_id, namespace, source, source_ref)",
    "grant execute on function public.submit_projectos_evidence_candidate_atomic",
    "'canonical_memory_written', false",
  ]) {
    assert.ok(migrationSource.includes(marker), `migration marker missing: ${marker}`);
  }
  assert.ok(
    migrationSource.indexOf("insert into public.memory_capture_candidates") <
      migrationSource.indexOf("insert into public.memory_review_queue_items"),
  );
  assert.ok(
    migrationSource.indexOf("insert into public.memory_review_queue_items") <
      migrationSource.indexOf("insert into public.audit_logs"),
  );
  assert.ok(!migrationSource.includes("public.memory_items"));
  assert.ok(
    !/(?:insert\s+into|update|delete\s+from)\s+supabase_migrations\.schema_migrations/i.test(
      migrationSource,
    ),
  );
  assert.ok(!/delete\s+from\s+public\.(?:memory_|audit_logs)/i.test(migrationSource));
  assert.equal(migration.transactional, true);
  assert.equal(migration.modifies_hosted_migration_history, false);
  assert.equal(migration.rpc, "public.submit_projectos_evidence_candidate_atomic");
  assert.equal(migration.audit_action, "projectos_evidence_candidate_atomic_created");
  assert.deepEqual(migration.execute_roles, ["service_role"]);

  const scopeMigration = evidence.candidate_source.scope_activation_migration;
  const scopeMigrationBytes = assertArtifact(
    scopeMigration,
    "successor scope activation migration",
  );
  const scopeMigrationSource = scopeMigrationBytes.toString("utf8");
  assert.ok(scopeMigrationSource.includes(migration.raw_sha256));
  assert.ok(scopeMigrationSource.includes(bridge.raw_sha256));
  assert.ok(scopeMigrationSource.includes("atomic RPC migration missing"));
  assert.ok(scopeMigrationSource.includes("pg_get_indexdef(i.indexrelid, 1, true) = 'record_id'"));
  assert.equal(scopeMigration.requires_atomic_rpc_precondition, true);
  assert.equal(scopeMigration.successor_bridge_sha256, bridge.raw_sha256);

  for (const artifact of [
    evidence.test_artifacts.behavior,
    evidence.test_artifacts.postgres_runner,
    evidence.test_artifacts.postgres_schema,
    evidence.test_artifacts.postgres_assertions,
  ]) {
    const bytes = read(artifact.path);
    assert.equal(sha256(bytes), artifact.raw_sha256, `${artifact.path} hash drift`);
  }
  const postgresRunner = read(evidence.test_artifacts.postgres_runner.path).toString(
    "utf8",
  );
  assert.ok(
    postgresRunner.includes(
      "create unique index audit_logs_projectos_evidence_candidate_atomic_unique",
    ),
  );
  assert.ok(postgresRunner.includes("on public.audit_logs (user_id)"));
  assert.ok(postgresRunner.includes("wrong-key atomic audit index unexpectedly passed"));
  for (const value of Object.values(evidence.test_artifacts.required_cases)) {
    assert.equal(value, true);
  }

  assert.equal(evidence.live_baseline.supabase_project, "ivmvufhcsezyhczzondn");
  assert.equal(evidence.live_baseline.bridge_version, 15);
  assert.equal(
    evidence.live_baseline.bridge_raw_sha256,
    "7cdb0e6a2ae74a6ea970ba537f8ff04c64cfd2c608e8b8e6c4a394dcff8d07cf",
  );
  const liveBridge = gitShow(evidence.live_baseline.bridge_source_commit, bridge.path);
  assert.equal(sha256(liveBridge), evidence.live_baseline.bridge_raw_sha256);
  assert.deepEqual(evidence.live_baseline.scopes, ["memory:health", "memory:read"]);
  assert.equal(evidence.live_baseline.candidate_action_live, false);
  assert.equal(evidence.live_baseline.production_changed, false);

  assert.equal(evidence.migration_parity.verdict, "RED");
  assert.equal(evidence.migration_parity.hosted_versions, 69);
  assert.equal(evidence.migration_parity.source_versions_before_successor, 17);
  assert.equal(evidence.migration_parity.matching_versions, 15);
  assert.equal(evidence.migration_parity.hosted_only_versions, 54);
  assert.equal(evidence.migration_parity.local_only_versions_before_successor, 2);
  assert.equal(evidence.migration_parity.source_versions_on_successor, 19);
  assert.equal(evidence.migration_parity.local_only_versions_on_successor, 4);
  assert.equal(evidence.migration_parity.successor_adds_local_only_migrations, 2);
  assert.equal(evidence.migration_parity.hosted_history_mutation_authorized, false);

  assert.deepEqual(evidence.activation_order, [
    migration.path,
    scopeMigration.path,
    bridge.path,
  ]);

  assert.equal(evidence.rollback.live_v15_source_recoverable, true);
  assert.equal(evidence.rollback.live_v15_restore_rehearsed, false);
  assert.equal(evidence.rollback.scope_rollback_qualified, false);
  assert.equal(evidence.rollback.atomic_rpc_dormant_without_write_scope, true);
  assert.equal(
    sha256(read(evidence.rollback.scope_rollback_path)),
    evidence.rollback.scope_rollback_sha256,
  );

  assert.equal(evidence.authority.source_candidate, true);
  assert.equal(evidence.authority.tests, true);
  assert.equal(evidence.authority.branch, true);
  assert.equal(evidence.authority.draft_pull_request, true);
  for (const gate of [
    "merge",
    "database_migration",
    "edge_deployment",
    "hosted_migration_history_change",
    "evidence_submission",
    "canonical_promotion",
    "production_verification",
    "pxe_0008_closure",
  ]) {
    assert.equal(evidence.authority[gate], false, `${gate} must remain blocked`);
  }
  assert.equal(evidence.authority.issue_56_predecessor_authorization_recorded, true);
  assert.equal(evidence.authority.successor_exact_artifact_authorized, false);
  assert.equal(evidence.authority.refreshed_exact_artifact_owner_authorization_required, true);
  assert.equal(evidence.authority.different_vendor_review_required, true);
  assert.equal(evidence.proof_state.exact_head_ci, "pending_at_source_creation");
  assert.equal(evidence.proof_state.independent_review, false);
  assert.equal(evidence.proof_state.deployed, false);
  assert.equal(evidence.proof_state.production_verified, false);
  assert.equal(evidence.proof_state.pxe_0008_closed, false);

  const manifest = fs.readFileSync(evidence.manifest, "utf8");
  assert.ok(manifest.includes("SOURCE-ONLY SUCCESSOR / BLOCKED"));
  assert.ok(manifest.includes(evidence.repository.base_commit));
  assert.ok(manifest.includes(bridge.raw_sha256));
  assert.ok(manifest.includes(migration.raw_sha256));
  assert.ok(manifest.includes(scopeMigration.raw_sha256));
  assert.ok(manifest.includes("PXE-0008 remains FAIL/HOLD"));
};

const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
validate(evidence);

if (process.argv.includes("--self-test")) {
  const rejectionCases = [
    ["bridge hash drift", (copy) => {
      copy.candidate_source.bridge.raw_sha256 = "0".repeat(64);
    }],
    ["direct candidate write", (copy) => {
      copy.candidate_source.bridge.required_markers.direct_candidate_write = true;
    }],
    ["history rewrite", (copy) => {
      copy.candidate_source.atomic_migration.modifies_hosted_migration_history = true;
    }],
    ["false parity", (copy) => {
      copy.migration_parity.verdict = "GREEN";
    }],
    ["premature migration authority", (copy) => {
      copy.authority.database_migration = true;
    }],
    ["premature PXE closure", (copy) => {
      copy.proof_state.pxe_0008_closed = true;
    }],
  ];
  for (const [name, mutate] of rejectionCases) {
    const copy = structuredClone(evidence);
    mutate(copy);
    assert.throws(() => validate(copy), undefined, `${name} must fail closed`);
  }
}

console.log("Memory bridge atomic-intake successor candidate: PASS");
