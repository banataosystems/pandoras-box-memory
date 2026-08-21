import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const evidencePath =
  "docs/capabilities/evidence/MEMORY_BRIDGE_EXACT_SOURCE_REPAIR_CANDIDATE_2026-08-21.json";

const read = (path) => fs.readFileSync(path);
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const gitBlobSha1 = (bytes) =>
  crypto
    .createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");

const gitShow = (commit, path) => {
  assert.match(commit, /^[0-9a-f]{40}$/, "invalid commit identity");
  assert.match(path, /^[A-Za-z0-9._/-]+$/, "invalid repository path");
  return execFileSync("git", ["show", `${commit}:${path}`], {
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
  });
};

const markerState = (bytes) => {
  const source = bytes.toString("utf8");
  const serveStart = source.search(/Deno\.serve\(/);
  const dispatch = serveStart >= 0 ? source.slice(serveStart) : source;
  const submitBranch = dispatch.indexOf('body.action === "submit_evidence_candidate"');
  const searchBranch = dispatch.indexOf('body.action === "search"');
  const unsupported = dispatch.indexOf('error: "unsupported_action"');
  return {
    submitEvidenceCandidate: source.includes("submitEvidenceCandidate"),
    submit_evidence_candidate: submitBranch >= 0,
    unsupported_action: unsupported >= 0,
    dispatch_before_search:
      submitBranch >= 0 && searchBranch >= 0 && submitBranch < searchBranch,
    dispatch_before_unsupported_fallback:
      submitBranch >= 0 && unsupported >= 0 && submitBranch < unsupported,
    dispatch_calls_handler:
      /body\.action === "submit_evidence_candidate"[\s\S]{0,180}return submitEvidenceCandidate\(body, authorization\.principal, supabase\)/.test(
        dispatch,
      ),
  };
};

const assertIdentity = (bytes, expected, label) => {
  assert.equal(bytes.length, expected.bytes, `${label} byte length drift`);
  assert.equal(sha256(bytes), expected.raw_sha256, `${label} raw SHA-256 drift`);
  assert.equal(gitBlobSha1(bytes), expected.blob_sha1, `${label} Git blob drift`);
};

const assertTargetDispatch = (bytes, requiredMarkers) => {
  const markers = markerState(bytes);
  for (const [marker, expected] of Object.entries(requiredMarkers)) {
    assert.equal(markers[marker], expected, `target marker drift: ${marker}`);
  }
  assert.equal(markers.dispatch_calls_handler, true, "dispatch must call the governed handler");
};

const validate = (evidence) => {
  assert.equal(evidence.schema_version, "1.0.0");
  assert.equal(evidence.proof_stage, "implemented");
  assert.equal(
    evidence.coordination.delivery_envelope_write_status,
    "blocked",
    "the failed governed issue write must not be represented as persisted",
  );
  assert.equal(evidence.coordination.delivery_envelope_plan_id, "692e4599-8976-4cbc-926b-153371accfd1");
  assert.equal(
    evidence.coordination.activation_issue,
    "banataosystems/pandoras-box-memory#56",
  );
  assert.equal(
    evidence.coordination.activation_id,
    "memory-evidence-candidate-bridge-prod-activation-20260821",
  );

  const repository = evidence.repository;
  assert.equal(repository.full_name, "banataosystems/pandoras-box-memory");
  assert.equal(repository.repository_id, 1327294429);
  assert.equal(repository.base_ref, "main");
  assert.equal(repository.base_commit, "478105057c1ca5fb5b356750ba1fa1fb58b1f42c");
  assert.equal(repository.base_tree, "fb4909bd962ddf32df3a63fbd46c136d7b3d9d88");
  assert.equal(repository.repair_lane_base_commit, "b88633083ac671885e622acc79b336c7840f2bae");
  assert.equal(repository.repair_lane_base_tree, "b1fad19ce80f803dc5d3d5c086afc846441d9ecf");

  const target = evidence.target_deployment;
  const targetSource = target.source;
  assert.equal(target.provider, "supabase");
  assert.equal(target.project_ref, "ivmvufhcsezyhczzondn");
  assert.equal(target.function_id, "0e7e24e6-7cb7-46d0-b474-3d626898d7e6");
  assert.equal(target.function_slug, "pandora-projectos-bridge");
  assert.equal(target.provider_assigned_next_version, null);
  assert.equal(target.verify_jwt, false);
  assert.equal(target.import_map, true);
  assert.equal(targetSource.commit, evidence.repository.base_commit);

  const currentIndex = read(targetSource.index_path);
  const currentDeno = read(targetSource.deno_path);
  assertIdentity(
    currentIndex,
    {
      bytes: targetSource.index_bytes,
      raw_sha256: targetSource.index_raw_sha256,
      blob_sha1: targetSource.index_blob_sha1,
    },
    "target index",
  );
  assertIdentity(
    currentDeno,
    {
      bytes: targetSource.deno_bytes,
      raw_sha256: targetSource.deno_raw_sha256,
      blob_sha1: targetSource.deno_blob_sha1,
    },
    "target deno config",
  );
  assert.deepEqual(
    gitShow(targetSource.commit, targetSource.index_path),
    currentIndex,
    "the exact base commit must contain the target bridge bytes",
  );
  assert.deepEqual(
    gitShow(targetSource.commit, targetSource.deno_path),
    currentDeno,
    "the exact base commit must contain the target import-map bytes",
  );

  assertTargetDispatch(currentIndex, target.required_markers);

  const live = evidence.live_source_readback;
  assert.equal(live.provider, "supabase");
  assert.equal(live.project_ref, target.project_ref);
  assert.equal(live.function_id, target.function_id);
  assert.equal(live.function_slug, target.function_slug);
  assert.equal(live.version, 15);
  assert.equal(live.status, "ACTIVE");
  assert.equal(live.updated_at, "2026-08-20T16:48:19.081Z");
  assert.equal(live.ezbr_sha256, "7d2388c4c101ea3ca023e7c354aa5e08e7e02c49db5d51baf752ef27debfcb0a");
  assert.equal(live.verify_jwt, target.verify_jwt);
  assert.equal(live.import_map, target.import_map);
  assert.equal(live.source.exact_repository_commit, "523fec111bfb2c327f69c2abdf0784775ab49a90");
  assert.equal(live.source.exact_repository_tree, "b450709c57c970eef345d4794d13d6026d1b6969");

  const rollbackIndex = gitShow(
    live.source.exact_repository_commit,
    targetSource.index_path,
  );
  const rollbackDeno = gitShow(
    live.source.exact_repository_commit,
    targetSource.deno_path,
  );
  assertIdentity(
    rollbackIndex,
    {
      bytes: live.source.index_bytes,
      raw_sha256: live.source.index_raw_sha256,
      blob_sha1: live.source.index_blob_sha1,
    },
    "live/readback index",
  );
  assertIdentity(
    rollbackDeno,
    {
      bytes: live.source.deno_bytes,
      raw_sha256: live.source.deno_raw_sha256,
      blob_sha1: live.source.deno_blob_sha1,
    },
    "live/readback deno config",
  );
  assert.equal(live.source.provider_files_byte_identical_to_repository_commit, true);

  const liveMarkers = markerState(rollbackIndex);
  assert.equal(liveMarkers.submitEvidenceCandidate, live.markers.submitEvidenceCandidate);
  assert.equal(liveMarkers.submit_evidence_candidate, live.markers.submit_evidence_candidate);
  assert.equal(liveMarkers.unsupported_action, live.markers.unsupported_action);

  const parity = evidence.source_parity;
  const derivedParity = sha256(currentIndex) === sha256(rollbackIndex);
  assert.equal(derivedParity, false, "fixture must preserve the observed source drift");
  assert.equal(parity.verdict, "RED");
  assert.equal(parity.classification, "source_runtime_activation_gap");
  assert.equal(parity.canonical_and_live_index_sha256_equal, derivedParity);
  assert.equal(
    parity.canonical_and_live_index_blob_equal,
    gitBlobSha1(currentIndex) === gitBlobSha1(rollbackIndex),
  );

  const forwardRecovery = evidence.forward_recovery;
  assert.equal(
    forwardRecovery.governance_issue,
    "banataosystems/pandoras-box-memory#56",
  );
  assert.equal(
    forwardRecovery.activation_id,
    "memory-evidence-candidate-bridge-prod-activation-20260821",
  );
  assert.equal(forwardRecovery.owner_production_authorization_recorded, true);
  assert.equal(forwardRecovery.release_gate_satisfied, false);
  const priorMigration = forwardRecovery.prior_hosted_migration;
  assert.equal(
    priorMigration.source_name,
    "20260820113000_enable_projectos_evidence_candidate_write_scope",
  );
  assert.equal(priorMigration.hosted_version, "20260820150902");
  assert.equal(priorMigration.hosted_statement_count, 1);
  assert.deepEqual(priorMigration.runtime_scopes_after_transaction_proof_rollback, [
    "memory:health",
    "memory:read",
  ]);
  assert.equal(priorMigration.ledger_row_preserved, true);

  const forwardMigration = forwardRecovery.migration;
  const forwardMigrationSource = read(forwardMigration.path);
  assertIdentity(
    forwardMigrationSource,
    {
      bytes: forwardMigration.bytes,
      raw_sha256: forwardMigration.raw_sha256,
      blob_sha1: forwardMigration.blob_sha1,
    },
    "forward activation migration",
  );
  assert.equal(forwardMigration.transactional, true);
  assert.equal(forwardMigration.unique_forward_migration, true);
  assert.equal(forwardMigration.modifies_prior_ledger_row, false);
  assert.equal(forwardMigration.hosted_baseline_fail_closed, true);
  assert.equal(forwardMigration.clean_replay_compatible, true);

  const forwardRollback = forwardRecovery.rollback;
  const forwardRollbackSource = read(forwardRollback.path);
  assertIdentity(
    forwardRollbackSource,
    {
      bytes: forwardRollback.bytes,
      raw_sha256: forwardRollback.raw_sha256,
      blob_sha1: forwardRollback.blob_sha1,
    },
    "forward activation rollback",
  );
  assert.equal(forwardRollback.transactional, true);
  assert.equal(forwardRollback.single_execution_fail_closed, true);
  assert.equal(forwardRollback.preserves_activation_audit, true);
  assert.equal(forwardRollback.preserves_pending_candidates, true);

  const activationAudit = forwardRecovery.audit;
  assert.equal(activationAudit.table, "public.audit_logs");
  assert.equal(activationAudit.same_transaction_as_scope_change, true);
  assert.equal(activationAudit.principal_user_server_derived, true);
  assert.equal(activationAudit.namespace, "real_life");
  assert.equal(activationAudit.before_after_scope_arrays_only, true);
  assert.equal(activationAudit.review_required, true);
  assert.equal(activationAudit.candidate_content_recorded, false);
  assert.equal(activationAudit.direct_identifiers_recorded, false);
  assert.equal(activationAudit.bridge_index_sha256, targetSource.index_raw_sha256);
  assert.equal(activationAudit.import_map_sha256, targetSource.deno_raw_sha256);

  const vercel = evidence.vercel_route_readback;
  assert.equal(vercel.team_id, "team_IcdJUnzLi5wUN1GD8ALHyjF7");
  assert.equal(vercel.project_id, "prj_brg3BJDcHfSftHH84NhnFtDJAnDO");
  assert.equal(vercel.deployment_id, "dpl_7d7WTrvGvrv8cC9ZMrCc59qmDUUk");
  assert.equal(vercel.state, "READY");
  assert.equal(vercel.target, "production");
  assert.equal(vercel.git_repository, repository.full_name);
  assert.equal(vercel.git_ref, repository.base_ref);
  assert.equal(vercel.git_commit, evidence.repository.base_commit);
  assert.equal(vercel.source_parity_verdict, "PASS");
  assert.equal(vercel.requires_change_for_bridge_repair, false);

  const rollback = evidence.rollback_evidence;
  assert.equal(rollback.provider_native_version_rollback_available, false);
  assert.equal(rollback.current_live_source_exactly_recoverable, true);
  assert.equal(rollback.current_live_source_commit, live.source.exact_repository_commit);
  assert.equal(rollback.current_live_source_index_blob_sha1, live.source.index_blob_sha1);
  assert.equal(rollback.current_live_source_index_raw_sha256, live.source.index_raw_sha256);
  assert.equal(rollback.current_live_source_matches_provider_readback, true);
  assert.equal(rollback.restoration_rehearsed, false);
  assert.equal(rollback.automatic_rollback_qualified, false);
  assert.equal(
    rollback.classification,
    "content_addressed_source_recoverable_but_unrehearsed",
  );
  const databaseRollback = rollback.database_scope_rollback;
  const databaseRollbackSource = read(databaseRollback.path);
  assertIdentity(
    databaseRollbackSource,
    {
      bytes: databaseRollback.bytes,
      raw_sha256: databaseRollback.raw_sha256,
      blob_sha1: databaseRollback.blob_sha1,
    },
    "database scope rollback",
  );
  assert.equal(databaseRollback.transactional, true);
  assert.equal(databaseRollback.idempotent, false);
  assert.equal(databaseRollback.single_execution_fail_closed, true);
  assert.equal(databaseRollback.activation_audit_preserved, true);
  const historicalRollback = rollback.historical_transaction_proof_rollback;
  const historicalRollbackSource = read(historicalRollback.path);
  assertIdentity(
    historicalRollbackSource,
    {
      bytes: historicalRollback.bytes,
      raw_sha256: historicalRollback.raw_sha256,
      blob_sha1: historicalRollback.blob_sha1,
    },
    "historical transaction-proof rollback",
  );
  assert.equal(rollback.rollback_order.length, 3);

  const authorization = evidence.authorization;
  assert.equal(authorization.source_candidate, true);
  assert.equal(authorization.regression_tests, true);
  assert.equal(authorization.draft_pull_request, true);
  assert.equal(authorization.owner_production_activation_task, true);
  assert.equal(
    authorization.owner_authorization_issue,
    "banataosystems/pandoras-box-memory#56",
  );
  assert.equal(authorization.remaining_release_gates_satisfied, false);
  for (const gate of [
    "merge",
    "database_mutation",
    "edge_function_deployment",
    "vercel_production_effect",
    "candidate_resubmission",
    "canonical_promotion",
    "production_verification",
  ]) {
    assert.equal(authorization[gate], false, `${gate} must remain separately gated`);
  }

  const acceptance = evidence.post_activation_acceptance;
  assert.equal(
    acceptance.governed_candidate_idempotency_key,
    "master-pandora-systems-v1-installed-20260821",
  );
  assert.equal(acceptance.required_candidate_status, "pending");
  assert.equal(acceptance.required_review_status, "pending_review");
  assert.equal(acceptance.canonical_memory_written, false);
  assert.equal(acceptance.resubmission_authorized_now, false);

  assert.equal(evidence.proof_state.documented, true);
  assert.equal(evidence.proof_state.implemented_in_canonical_source, true);
  assert.equal(evidence.proof_state.regression_candidate_prepared, true);
  assert.equal(evidence.proof_state.forward_recovery_implemented, true);
  assert.equal(evidence.proof_state.owner_production_authorization_recorded, true);
  assert.equal(evidence.proof_state.exact_head_tested, false);
  assert.equal(evidence.proof_state.independent_review, false);
  assert.equal(evidence.proof_state.deployed, false);
  assert.equal(evidence.proof_state.production_verified, false);
};

const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
validate(evidence);

if (process.argv.includes("--self-test")) {
  const targetSource = fs.readFileSync(evidence.target_deployment.source.index_path, "utf8");
  const missingDispatch = Buffer.from(
    targetSource.replace(
      '  if (body.action === "submit_evidence_candidate") {\n' +
        "    return submitEvidenceCandidate(body, authorization.principal, supabase);\n" +
        "  }\n",
      "",
    ),
  );
  assert.notEqual(missingDispatch.length, Buffer.byteLength(targetSource), "dispatch fixture did not change");
  assert.throws(
    () => assertTargetDispatch(missingDispatch, evidence.target_deployment.required_markers),
    undefined,
    "a deployable bridge with the dispatch omitted must fail closed",
  );

  const rejectionCases = [
    ["target source hash drift", (copy) => {
      copy.target_deployment.source.index_raw_sha256 = "0".repeat(64);
    }],
    ["false live parity", (copy) => {
      copy.source_parity.canonical_and_live_index_sha256_equal = true;
    }],
    ["fabricated live handler", (copy) => {
      copy.live_source_readback.markers.submit_evidence_candidate = true;
    }],
    ["unauthorized production deploy", (copy) => {
      copy.authorization.edge_function_deployment = true;
    }],
    ["unrehearsed automatic rollback", (copy) => {
      copy.rollback_evidence.automatic_rollback_qualified = true;
    }],
    ["premature mastery resubmission", (copy) => {
      copy.post_activation_acceptance.resubmission_authorized_now = true;
    }],
    ["wrong governed activation", (copy) => {
      copy.forward_recovery.activation_id = "wrong-activation";
    }],
    ["ledger history rewrite", (copy) => {
      copy.forward_recovery.prior_hosted_migration.ledger_row_preserved = false;
    }],
    ["premature release gate", (copy) => {
      copy.forward_recovery.release_gate_satisfied = true;
    }],
  ];

  for (const [name, mutate] of rejectionCases) {
    const copy = structuredClone(evidence);
    mutate(copy);
    assert.throws(() => validate(copy), undefined, `${name} must fail closed`);
  }
}

console.log("Memory bridge exact-source repair candidate: PASS");
