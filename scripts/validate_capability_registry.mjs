#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = process.cwd();
const manifestPath = resolve(
  root,
  "docs/capabilities/PANDORA_CANONICAL_SOURCE_MANIFEST_DB409325.json",
);
const registryPath = resolve(
  root,
  "docs/capabilities/PANDORA_CAPABILITY_REGISTRY_V2.json",
);
const registrySummaryPath = resolve(
  root,
  "docs/capabilities/PANDORA_CAPABILITY_REGISTRY_V2.md",
);
const roadmapPath = resolve(
  root,
  "docs/roadmap/PANDORA_COMPOUNDING_INTELLIGENCE_MASTER_ROADMAP_V2.md",
);

const EXPECTED = Object.freeze({
  repository: "banataosystems/pandoras-box-memory",
  baselineCommit: "db409325c15778a1a701dad3f931e4c0fd19447c",
  baselineTree: "fecb745e193c78420c19c4bbb0ee0830510a08c4",
  baselineFileCount: 62,
  baselineBytes: 237809,
  baselineFilesSha256:
    "342036ffa57c8148efe7144136afa91892011f8c235023d7a89510aaa6026311",
  manifestSha256:
    "93bdbd3847c2f51bf53000529d9265ad384b7c65aaff58eb8fdb8b8e7c61f546",
  roadmapSha256:
    "35d6e6ca3e5fc0d367b9eca4c5aa25f518af0b771c77dfd48460516d9b591b07",
  registrySummarySha256:
    "c892bb17e2ab261c8980c9421de524fa79cd6523c977948cc97a54147ab6d678",
  supabaseSnapshotSha256:
    "e1f966b4e2716759fa58603f5cbac084615a77c8c98d47a0145812373e36af0d",
  vercelSnapshotSha256:
    "363d590efbbf30448e30a5d3af6a52d2e4ed967d47b9e88ddcd5d1dfdf5b2d35",
});

const allowedPlanes = new Set(["original", "canonical", "live"]);
const allowedLifecycleStates = new Set([
  "baseline",
  "current-as-of-observation",
  "historical",
  "blocked",
]);
const allowedFactStatuses = new Set([
  "recorded",
  "verified",
  "contradicted",
  "blocked",
]);
const allowedReconciliationStatuses = new Set([
  "not-compared",
  "exact",
  "different",
  "blocked-pending-proof",
]);
const allowedEvidenceKinds = new Set([
  "git-object",
  "github-issue",
  "github-issue-comment",
  "provider-snapshot",
  "workflow-run",
]);
const requiredLiveEntries = new Set([
  "live-supabase-migration-ledger",
  "live-edge-pandora-projectos-bridge-v13",
  "live-edge-pandora-projectos-learning-v1",
  "live-edge-pandora-machine-gateway-v3",
  "live-vercel-projectos-production",
  "live-vercel-historical-deployment-dpl9ekw",
]);
const requiredBlockers = new Set([
  "archive-per-file-evidence-unavailable",
  "gateway-namespace-row-filter-unproven",
  "live-migration-68-source-gap",
  "vercel-return-path-reliability",
  "functional-recovery-unavailable",
  "independent-review-missing",
  "registry-required-check-not-enforced",
]);
const expectedOriginalFamilies = [
  "adaptive memory",
  "autopilot/distillation",
  "compaction/scoring",
  "candidate review",
  "persistence/readback/retrieval",
  "operator/admin consoles",
  "operating brain",
  "project context engine",
  "shadow context packs",
  "preflight",
  "promotion requests/execution/rollback",
  "operator actions",
  "MCP/OAuth",
  "environment governance",
  "tests",
  "docs",
  "skills",
];

function parse(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isSha1(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value) {
  return typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    /(?:Z|[+-]\d\d:\d\d)$/.test(value);
}

function bytewiseSort(items, getValue) {
  return [...items].sort((a, b) =>
    Buffer.from(getValue(a)).compare(Buffer.from(getValue(b)))
  );
}

function parseGitTree(commitSha) {
  const output = execFileSync(
    "git",
    ["ls-tree", "-r", "-l", commitSha],
    { cwd: root, encoding: "utf8" },
  );
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(
        /^100644 blob ([0-9a-f]{40})\s+(\d+)\t(.+)$/,
      );
      assert(match, "unexpected baseline Git tree entry: " + line);
      return {
        path: match[3],
        sha: match[1],
        size: Number(match[2]),
      };
    });
}

function findFact(entry, name) {
  return entry.facts.find((fact) => fact.name === name);
}

function rejectForbiddenKeys(value, path = "$") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(
      key !== "proof_stage" && key !== "completion_percentage",
      "forbidden aggregate proof/completion key at " + path + "." + key,
    );
    rejectForbiddenKeys(child, path + "." + key);
  }
}

function validateManifest(manifest, manifestBytes) {
  assert(manifest.schema_version === "1.0.0", "manifest schema changed");
  assert(
    manifest.repository === EXPECTED.repository,
    "manifest repository changed",
  );
  assert(
    manifest.commit_sha === EXPECTED.baselineCommit,
    "baseline commit changed",
  );
  assert(
    manifest.tree_sha === EXPECTED.baselineTree,
    "baseline tree changed",
  );
  assert(
    manifest.file_count === EXPECTED.baselineFileCount &&
      manifest.files.length === EXPECTED.baselineFileCount,
    "baseline file count changed",
  );
  assert(
    manifest.total_bytes === EXPECTED.baselineBytes &&
      manifest.files.reduce((sum, file) => sum + file.size, 0) ===
        EXPECTED.baselineBytes,
    "baseline byte count changed",
  );
  assert(
    sha256(JSON.stringify(manifest.files)) === EXPECTED.baselineFilesSha256,
    "baseline files-array digest mismatch",
  );
  assert(
    manifest.files_array_sha256 === EXPECTED.baselineFilesSha256,
    "recorded baseline files-array digest mismatch",
  );
  assert(
    sha256(manifestBytes) === EXPECTED.manifestSha256,
    "manifest artifact digest mismatch",
  );

  const paths = manifest.files.map((file) => file.path);
  assert(new Set(paths).size === paths.length, "duplicate manifest path");
  assert(
    JSON.stringify(paths) ===
      JSON.stringify(bytewiseSort(paths, (path) => path)),
    "manifest paths are not bytewise sorted",
  );
  for (const file of manifest.files) {
    assert(isNonEmptyString(file.path), "manifest path missing");
    assert(isSha1(file.sha), "invalid blob SHA for " + file.path);
    assert(
      Number.isInteger(file.size) && file.size >= 0,
      "invalid byte size for " + file.path,
    );
    assert(
      Object.keys(file).join(",") === "path,sha,size",
      "manifest key order changed for " + file.path,
    );
  }

  const actual = parseGitTree(EXPECTED.baselineCommit);
  assert(
    JSON.stringify(actual) === JSON.stringify(manifest.files),
    "manifest does not match git ls-tree for the exact baseline commit",
  );
}

function validateEvidence(registry, evidenceArtifacts) {
  assert(Array.isArray(registry.evidence), "evidence array missing");
  const ids = registry.evidence.map((item) => item.id);
  assert(new Set(ids).size === ids.length, "duplicate evidence id");

  for (const item of registry.evidence) {
    assert(isNonEmptyString(item.id), "evidence id missing");
    assert(
      allowedEvidenceKinds.has(item.kind),
      "unsupported evidence kind: " + item.id,
    );

    if (item.kind === "git-object") {
      assert(item.repository === EXPECTED.repository, "git repository mismatch");
      assert(item.commit_sha === EXPECTED.baselineCommit, "git commit mismatch");
      assert(item.tree_sha === EXPECTED.baselineTree, "git tree mismatch");
      assert(isNonEmptyString(item.path), "git path missing: " + item.id);
      assert(isSha1(item.blob_sha), "git blob SHA invalid: " + item.id);
      assert(
        Number.isInteger(item.byte_size) && item.byte_size >= 0,
        "git byte size invalid: " + item.id,
      );
    } else if (item.kind === "github-issue") {
      assert(item.repository === EXPECTED.repository, "issue repository mismatch");
      assert(Number.isInteger(item.issue_number), "issue number missing");
      assert(isSha256(item.body_sha256), "issue body digest missing");
      assert(["open", "closed"].includes(item.state), "issue state invalid");
    } else if (item.kind === "github-issue-comment") {
      assert(
        item.repository === EXPECTED.repository,
        "comment repository mismatch",
      );
      assert(Number.isInteger(item.issue_number), "comment issue missing");
      assert(Number.isInteger(item.comment_id), "comment id missing");
      assert(isSha256(item.body_sha256), "comment body digest missing");
    } else if (item.kind === "provider-snapshot") {
      assert(isNonEmptyString(item.provider), "provider missing: " + item.id);
      assert(
        isNonEmptyString(item.project_resource),
        "provider resource missing: " + item.id,
      );
      assert(item.environment === "production", "provider environment changed");
      assert(
        Array.isArray(item.immutable_resource_versions) &&
          item.immutable_resource_versions.length > 0 &&
          item.immutable_resource_versions.every(isNonEmptyString),
        "provider immutable versions missing: " + item.id,
      );
      assert(
        isTimestamp(item.observation_timestamp),
        "provider observation timestamp missing: " + item.id,
      );
      assert(
        isSha256(item.request_query_fingerprint_sha256),
        "provider query fingerprint missing: " + item.id,
      );
      assert(
        isSha256(item.canonicalized_result_sha256),
        "provider result digest missing: " + item.id,
      );
      assert(
        isNonEmptyString(item.artifact_path) &&
          item.artifact_path.startsWith("docs/capabilities/evidence/"),
        "provider artifact path invalid: " + item.id,
      );
      assert(
        isSha256(item.artifact_sha256),
        "provider artifact digest missing: " + item.id,
      );

      const artifact = evidenceArtifacts.get(item.artifact_path);
      assert(artifact, "provider artifact unavailable: " + item.artifact_path);
      assert(
        artifact.sha256 === item.artifact_sha256,
        "provider artifact digest mismatch: " + item.id,
      );
      assert(
        artifact.value.observed_at === item.observation_timestamp,
        "provider artifact observation mismatch: " + item.id,
      );
      assert(
        artifact.value.request_query_fingerprint_sha256 ===
          item.request_query_fingerprint_sha256,
        "provider artifact query fingerprint mismatch: " + item.id,
      );
      assert(
        artifact.value.canonicalized_result_sha256 ===
          item.canonicalized_result_sha256,
        "provider artifact result digest field mismatch: " + item.id,
      );
      assert(
        sha256(JSON.stringify(artifact.value.result)) ===
          item.canonicalized_result_sha256,
        "provider canonicalized result mismatch: " + item.id,
      );
    } else if (item.kind === "workflow-run") {
      assert(item.repository === EXPECTED.repository, "workflow repository mismatch");
      assert(Number.isInteger(item.run_id), "workflow run id missing");
      assert(Number.isInteger(item.job_id), "workflow job id missing");
      assert(isNonEmptyString(item.workflow_path), "workflow path missing");
      assert(["pull_request", "push"].includes(item.event), "workflow event invalid");
      assert(isSha1(item.expected_head_sha), "expected head missing");
      assert(isSha1(item.checked_out_sha), "checked-out SHA missing");
      assert(
        item.expected_head_sha === item.checked_out_sha,
        "workflow checkout SHA differs from expected head",
      );
      assert(item.conclusion === "success", "workflow conclusion is not success");
      assert(isSha256(item.result_artifact_sha256), "workflow result digest missing");
    }
  }
}

function validateEntries(registry, manifest) {
  assert(Array.isArray(registry.entries), "entries array missing");
  const entryIds = registry.entries.map((entry) => entry.id);
  assert(new Set(entryIds).size === entryIds.length, "duplicate entry id");
  const evidenceIds = new Set(registry.evidence.map((item) => item.id));

  for (const entry of registry.entries) {
    assert(isNonEmptyString(entry.id), "entry id missing");
    assert(allowedPlanes.has(entry.plane), "invalid plane: " + entry.id);
    assert(
      allowedLifecycleStates.has(entry.lifecycle_state),
      "invalid lifecycle state: " + entry.id,
    );
    assert(
      ["archive-aggregate", "source-file", "provider-resource"].includes(
        entry.kind,
      ),
      "invalid entry kind: " + entry.id,
    );
    assert(
      entry.capability_family === "unclassified",
      "semantic family is unproved: " + entry.id,
    );
    assert(
      allowedReconciliationStatuses.has(entry.reconciliation_status),
      "invalid reconciliation status: " + entry.id,
    );
    assert(isNonEmptyString(entry.next_action), "next action missing: " + entry.id);
    assert(
      Array.isArray(entry.facts) && entry.facts.length > 0,
      "facts missing: " + entry.id,
    );
    const factNames = entry.facts.map((fact) => fact.name);
    assert(new Set(factNames).size === factNames.length, "duplicate fact name: " + entry.id);

    for (const fact of entry.facts) {
      assert(isNonEmptyString(fact.name), "fact name missing: " + entry.id);
      assert(
        allowedFactStatuses.has(fact.status),
        "invalid fact status: " + entry.id + "/" + fact.name,
      );
      assert(
        Array.isArray(fact.evidence_ids) && fact.evidence_ids.length > 0,
        "fact evidence missing: " + entry.id + "/" + fact.name,
      );
      for (const evidenceId of fact.evidence_ids) {
        assert(
          evidenceIds.has(evidenceId),
          "opaque or dangling evidence reference: " + evidenceId,
        );
      }
      assert(
        fact.as_of === null || isTimestamp(fact.as_of),
        "fact as_of invalid: " + entry.id + "/" + fact.name,
      );
      assert(
        Array.isArray(fact.limitations) &&
          fact.limitations.length > 0 &&
          fact.limitations.every(isNonEmptyString),
        "fact limitations missing: " + entry.id + "/" + fact.name,
      );
    }
  }

  const original = registry.entries.filter((entry) => entry.plane === "original");
  assert(original.length === 3, "exactly three original aggregate entries required");
  assert(
    original.every((entry) => entry.kind === "archive-aggregate"),
    "original per-file/resource entry is forbidden while archive proof is absent",
  );
  const archive = original.find((entry) => entry.id === "original-archive-aggregate");
  assert(archive, "original archive aggregate missing");
  assert(
    archive.reconciliation_status === "blocked-pending-proof",
    "original archive reconciliation must remain blocked",
  );
  assert(findFact(archive, "recorded_regular_file_count")?.value === 782, "recorded 782 count changed");
  assert(findFact(archive, "recorded_archive_byte_size")?.value === 1085918, "recorded archive size changed");
  assert(
    findFact(archive, "recorded_zip_sha256")?.value ===
      "b0cfc83e04798887d9e889f45a1b9c8cf0e42cc51ce7f46fb3923b3a22434f2b",
    "recorded ZIP digest changed",
  );
  assert(
    findFact(archive, "recorded_capsule_sha256")?.value ===
      "458e7fa22541f103d6ed22198418d38928bba9c43006136c70534f0afdefbb13",
    "recorded capsule digest changed",
  );
  assert(findFact(archive, "archive_bytes_available")?.value === false, "archive bytes cannot be claimed available");
  assert(
    findFact(archive, "deterministic_per_file_manifest_available")?.value === false,
    "original per-file manifest cannot be claimed available",
  );

  const families = original.find((entry) =>
    entry.id === "original-capability-families-aggregate"
  );
  assert(families, "original family aggregate missing");
  assert(
    JSON.stringify(findFact(families, "recorded_capability_families")?.value) ===
      JSON.stringify(expectedOriginalFamilies),
    "original family aggregate changed",
  );

  const suite = original.find((entry) => entry.id === "original-test-suite-aggregate");
  assert(suite, "original test aggregate missing");
  const suiteValue = findFact(suite, "recorded_test_suite_label")?.value;
  assert(suiteValue?.recorded_count === 113, "recorded 113-test label changed");
  assert(
    /unverified/.test(suiteValue?.count_unit || ""),
    "113-test semantics caveat missing",
  );

  const canonical = registry.entries.filter((entry) => entry.plane === "canonical");
  assert(canonical.length === 62, "exactly 62 canonical source-file entries required");
  assert(
    canonical.every((entry) =>
      entry.kind === "source-file" &&
      entry.lifecycle_state === "baseline" &&
      entry.reconciliation_status === "not-compared"
    ),
    "canonical rows may prove only baseline source presence",
  );
  const canonicalByPath = new Map(canonical.map((entry) => [entry.identity.path, entry]));
  assert(canonicalByPath.size === 62, "duplicate canonical path");
  for (const file of manifest.files) {
    const entry = canonicalByPath.get(file.path);
    assert(entry, "canonical baseline omission: " + file.path);
    assert(entry.identity.repository === EXPECTED.repository, "canonical repository mismatch");
    assert(entry.identity.commit_sha === EXPECTED.baselineCommit, "canonical commit mismatch");
    assert(entry.identity.tree_sha === EXPECTED.baselineTree, "canonical tree mismatch");
    assert(entry.identity.blob_sha === file.sha, "canonical blob mismatch: " + file.path);
    assert(entry.identity.byte_size === file.size, "canonical byte mismatch: " + file.path);
    assert(
      entry.facts.length === 1 &&
        entry.facts[0].name === "artifact_presence" &&
        entry.facts[0].value === true &&
        entry.facts[0].status === "verified",
      "canonical semantic overclaim: " + file.path,
    );
    const evidence = registry.evidence.find((item) =>
      item.id === entry.facts[0].evidence_ids[0]
    );
    assert(
      evidence?.kind === "git-object" &&
        evidence.path === file.path &&
        evidence.blob_sha === file.sha &&
        evidence.byte_size === file.size,
      "canonical Git evidence mismatch: " + file.path,
    );
  }

  const live = registry.entries.filter((entry) => entry.plane === "live");
  assert(live.length === requiredLiveEntries.size, "live resource count changed");
  for (const id of requiredLiveEntries) {
    assert(live.some((entry) => entry.id === id), "required live entry missing: " + id);
  }
  assert(
    live.every((entry) =>
      entry.kind === "provider-resource" &&
      entry.facts.every((fact) => fact.as_of !== null)
    ),
    "live facts require time-bound provider observations",
  );

  const ledger = live.find((entry) => entry.id === "live-supabase-migration-ledger");
  assert(findFact(ledger, "applied_identity_count")?.value === 68, "live migration count must be 68");
  assert(
    findFact(ledger, "latest_identity")?.value ===
      "20260813114649_remove_temporary_flutterflow_http_probe_20260813",
    "latest live migration identity changed",
  );
  const gateway = live.find((entry) => entry.id === "live-edge-pandora-machine-gateway-v3");
  assert(
    findFact(gateway, "same_owner_cross_namespace_negative_test")?.value === false,
    "gateway negative test cannot be claimed complete",
  );
  const production = live.find((entry) => entry.id === "live-vercel-projectos-production");
  assert(
    findFact(production, "production_acceptance_complete")?.value === false,
    "broad production acceptance cannot be claimed",
  );
  const historical = live.find((entry) =>
    entry.id === "live-vercel-historical-deployment-dpl9ekw"
  );
  assert(
    findFact(historical, "rollback_capable_for_current_connector")?.value === false,
    "historical deployment cannot be claimed rollback-capable",
  );
}

function validateComparisonsAndGaps(registry) {
  const entryIds = new Set(registry.entries.map((entry) => entry.id));
  const evidenceIds = new Set(registry.evidence.map((item) => item.id));

  assert(Array.isArray(registry.comparisons), "comparisons missing");
  const comparisonIds = registry.comparisons.map((item) => item.id);
  assert(new Set(comparisonIds).size === comparisonIds.length, "duplicate comparison id");
  for (const comparison of registry.comparisons) {
    assert(isNonEmptyString(comparison.id), "comparison id missing");
    assert(
      allowedReconciliationStatuses.has(comparison.status),
      "comparison status invalid: " + comparison.id,
    );
    assert(
      Array.isArray(comparison.subject_entry_ids) &&
        comparison.subject_entry_ids.length >= 2,
      "comparison subjects missing: " + comparison.id,
    );
    for (const id of comparison.subject_entry_ids) {
      assert(entryIds.has(id), "comparison entry reference missing: " + id);
    }
    assert(
      Array.isArray(comparison.evidence_ids) &&
        comparison.evidence_ids.length > 0,
      "comparison evidence missing: " + comparison.id,
    );
    for (const id of comparison.evidence_ids) {
      assert(evidenceIds.has(id), "comparison evidence reference missing: " + id);
    }
    assert(isNonEmptyString(comparison.claim), "comparison claim missing");
    assert(
      !comparison.subject_entry_ids.includes(
        "live-vercel-projectos-production",
      ),
      "Vercel source comparison requires a correctly scoped canonical web artifact",
    );
    assert(
      Array.isArray(comparison.limitations) &&
        comparison.limitations.length > 0 &&
        comparison.limitations.every(isNonEmptyString),
      "comparison limitations missing: " + comparison.id,
    );
    assert(isNonEmptyString(comparison.next_action), "comparison next action missing");
    if (comparison.status === "exact" || comparison.status === "different") {
      assert(
        comparison.comparison_contract &&
          isNonEmptyString(comparison.comparison_contract.method) &&
          isSha256(comparison.comparison_contract.left_digest_sha256) &&
          isSha256(comparison.comparison_contract.right_digest_sha256),
        "exact/different comparison requires two hashes and a method: " +
          comparison.id,
      );
    }
  }

  assert(Array.isArray(registry.gaps), "gaps missing");
  const gapIds = registry.gaps.map((gap) => gap.id);
  assert(new Set(gapIds).size === gapIds.length, "duplicate gap id");
  for (const gap of registry.gaps) {
    assert(isNonEmptyString(gap.id), "gap id missing");
    assert(isNonEmptyString(gap.name), "gap name missing: " + gap.id);
    assert(isNonEmptyString(gap.status), "gap status missing: " + gap.id);
    assert(
      Array.isArray(gap.related_entry_ids) &&
        gap.related_entry_ids.every((id) => entryIds.has(id)),
      "gap entry reference missing: " + gap.id,
    );
    assert(
      Array.isArray(gap.evidence_ids) &&
        gap.evidence_ids.length > 0 &&
        gap.evidence_ids.every((id) => evidenceIds.has(id)),
      "gap evidence reference missing: " + gap.id,
    );
    assert(
      Array.isArray(gap.limitations) &&
        gap.limitations.length > 0 &&
        gap.limitations.every(isNonEmptyString),
      "gap limitations missing: " + gap.id,
    );
    assert(isNonEmptyString(gap.next_action), "gap next action missing: " + gap.id);
  }
}

function validateRegistry(
  manifest,
  registry,
  roadmapBytes,
  manifestBytes,
  evidenceArtifacts,
) {
  rejectForbiddenKeys(registry);
  validateManifest(manifest, manifestBytes);

  assert(registry.schema_version === "2.0.0", "registry schema changed");
  assert(
    registry.registry_id ===
      "pandora-evidence-first-reconciliation-foundation-v2",
    "registry identity changed",
  );
  assert(isNonEmptyString(registry.scope), "registry scope missing");
  assert(
    registry.authority.repository === EXPECTED.repository,
    "registry authority repository changed",
  );
  assert(registry.authority.roadmap_issue === 22, "issue #22 must remain authority");
  assert(
    registry.authority.duplicate_issue === 23,
    "issue #23 duplicate record missing",
  );
  assert(
    registry.authority.baseline_commit_sha === EXPECTED.baselineCommit &&
      registry.authority.baseline_tree_sha === EXPECTED.baselineTree,
    "registry baseline authority changed",
  );
  assert(
    registry.authority.baseline_manifest_sha256 === EXPECTED.manifestSha256,
    "registry manifest digest changed",
  );
  assert(
    registry.authority.roadmap_source_sha256 === EXPECTED.roadmapSha256,
    "registry roadmap digest changed",
  );
  assert(
    sha256(roadmapBytes) === EXPECTED.roadmapSha256,
    "roadmap artifact digest mismatch",
  );
  assert(
    JSON.stringify(registry.allowed_planes) ===
      JSON.stringify([...allowedPlanes]),
    "allowed planes must be exactly original/canonical/live",
  );
  assert(
    JSON.stringify(registry.allowed_lifecycle_states) ===
      JSON.stringify([...allowedLifecycleStates]),
    "lifecycle vocabulary changed",
  );
  assert(
    JSON.stringify(registry.allowed_fact_statuses) ===
      JSON.stringify([...allowedFactStatuses]),
    "fact-status vocabulary changed",
  );
  assert(
    JSON.stringify(registry.allowed_reconciliation_statuses) ===
      JSON.stringify([...allowedReconciliationStatuses]),
    "reconciliation vocabulary changed",
  );

  validateEvidence(registry, evidenceArtifacts);
  validateEntries(registry, manifest);
  validateComparisonsAndGaps(registry);

  assert(Array.isArray(registry.blockers), "blockers missing");
  const blockerIds = new Set(registry.blockers.map((blocker) => blocker.id));
  assert(blockerIds.size === registry.blockers.length, "duplicate blocker id");
  for (const id of requiredBlockers) {
    assert(blockerIds.has(id), "required blocker missing: " + id);
  }
  for (const blocker of registry.blockers) {
    assert(isNonEmptyString(blocker.id), "blocker id missing");
    assert(["high", "blocking"].includes(blocker.severity), "blocker severity invalid");
    assert(isNonEmptyString(blocker.statement), "blocker statement blank: " + blocker.id);
  }

  assert(registry.completion.status === "withheld", "completion status must remain withheld");
  assert(registry.completion.percentage === null, "completion percentage must remain null");
  assert(
    /archive bytes.*per-file/i.test(registry.completion.reason),
    "completion blocker reason missing",
  );

  const referencedEvidence = new Set();
  for (const entry of registry.entries) {
    for (const fact of entry.facts) {
      for (const id of fact.evidence_ids) referencedEvidence.add(id);
    }
  }
  for (const comparison of registry.comparisons) {
    for (const id of comparison.evidence_ids) referencedEvidence.add(id);
  }
  for (const gap of registry.gaps) {
    for (const id of gap.evidence_ids) referencedEvidence.add(id);
  }
  for (const item of registry.evidence) {
    assert(referencedEvidence.has(item.id), "orphan evidence object: " + item.id);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectFailure(
  name,
  mutate,
  manifest,
  registry,
  roadmapBytes,
  manifestBytes,
  evidenceArtifacts,
) {
  const nextManifest = clone(manifest);
  const nextRegistry = clone(registry);
  const nextArtifacts = new Map(
    [...evidenceArtifacts.entries()].map(([key, value]) => [key, clone(value)]),
  );
  mutate(nextManifest, nextRegistry, nextArtifacts);
  let rejected = false;
  try {
    validateRegistry(
      nextManifest,
      nextRegistry,
      roadmapBytes,
      manifestBytes,
      nextArtifacts,
    );
  } catch {
    rejected = true;
  }
  assert(rejected, "self-test mutation was not rejected: " + name);
}

function loadEvidenceArtifacts(registry) {
  const artifacts = new Map();
  for (const item of registry.evidence || []) {
    if (item.kind !== "provider-snapshot") continue;
    const path = resolve(root, item.artifact_path);
    const bytes = readFileSync(path);
    artifacts.set(item.artifact_path, {
      value: JSON.parse(bytes.toString("utf8")),
      sha256: sha256(bytes),
    });
  }
  return artifacts;
}

const manifestBytes = readFileSync(manifestPath);
const registryBytes = readFileSync(registryPath);
const registrySummaryBytes = readFileSync(registrySummaryPath);
const roadmapBytes = readFileSync(roadmapPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const registry = JSON.parse(registryBytes.toString("utf8"));
const evidenceArtifacts = loadEvidenceArtifacts(registry);

assert(
  sha256(registrySummaryBytes) === EXPECTED.registrySummarySha256,
  "registry summary artifact digest mismatch",
);

validateRegistry(
  manifest,
  registry,
  roadmapBytes,
  manifestBytes,
  evidenceArtifacts,
);

let selfTestCount = 0;
if (process.argv.includes("--self-test")) {
  const mutations = [
    ["fourth plane", (_m, r) => {
      r.entries[0].plane = "candidate";
    }],
    ["opaque evidence reference", (_m, r) => {
      r.entries[0].facts[0].evidence_ids = ["mutable:latest"];
    }],
    ["provider timestamp missing", (_m, r) => {
      r.evidence.find((item) => item.kind === "provider-snapshot")
        .observation_timestamp = null;
    }],
    ["provider result digest missing", (_m, r) => {
      r.evidence.find((item) => item.kind === "provider-snapshot")
        .canonicalized_result_sha256 = null;
    }],
    ["original per-file row", (_m, r) => {
      r.entries.push({
        ...clone(r.entries.find((entry) => entry.plane === "canonical")),
        id: "forbidden-original-file",
        plane: "original",
      });
    }],
    ["canonical semantic family inference", (_m, r) => {
      r.entries.find((entry) => entry.plane === "canonical")
        .capability_family = "mcp-oauth";
    }],
    ["exact parity without two hashes", (_m, r) => {
      const comparison = r.comparisons.find((item) =>
        item.status === "blocked-pending-proof"
      );
      comparison.status = "exact";
      comparison.comparison_contract = null;
    }],
    ["aggregate production proof stage", (_m, r) => {
      r.entries.find((entry) => entry.plane === "live").proof_stage =
        "production-verified";
    }],
    ["workflow checkout mismatch", (_m, r) => {
      r.evidence.push({
        id: "workflow-mismatch",
        kind: "workflow-run",
        repository: EXPECTED.repository,
        run_id: 1,
        job_id: 2,
        workflow_path: ".github/workflows/capability-registry-gate.yml",
        event: "pull_request",
        expected_head_sha: "1111111111111111111111111111111111111111",
        checked_out_sha: "2222222222222222222222222222222222222222",
        conclusion: "success",
        result_artifact_sha256:
          "3333333333333333333333333333333333333333333333333333333333333333",
      });
    }],
    ["completion percentage", (_m, r) => {
      r.completion.percentage = 100;
    }],
    ["canonical omission", (m) => {
      m.files.pop();
    }],
    ["required live entry omission", (_m, r) => {
      r.entries = r.entries.filter((entry) =>
        entry.id !== "live-edge-pandora-machine-gateway-v3"
      );
    }],
    ["blank blocker", (_m, r) => {
      r.blockers[0].statement = " ";
    }],
    ["unscoped Vercel source comparison", (_m, r) => {
      r.comparisons[0].subject_entry_ids.push(
        "live-vercel-projectos-production",
      );
    }],
  ];
  for (const [name, mutate] of mutations) {
    expectFailure(
      name,
      mutate,
      manifest,
      registry,
      roadmapBytes,
      manifestBytes,
      evidenceArtifacts,
    );
    selfTestCount += 1;
  }
}

const attestationIndex = process.argv.indexOf("--attestation");
if (attestationIndex !== -1) {
  const outputPath = process.argv[attestationIndex + 1];
  assert(isNonEmptyString(outputPath), "--attestation requires a path");
  const checkedOutSha = execFileSync(
    "git",
    ["rev-parse", "HEAD"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  const attestation = {
    schema_version: "1.0.0",
    validation_result: "pass",
    candidate_sha: checkedOutSha,
    baseline_commit_sha: EXPECTED.baselineCommit,
    baseline_tree_sha: EXPECTED.baselineTree,
    manifest_sha256: sha256(manifestBytes),
    registry_sha256: sha256(registryBytes),
    registry_summary_sha256: sha256(registrySummaryBytes),
    roadmap_sha256: sha256(roadmapBytes),
    provider_snapshot_sha256: {
      supabase: evidenceArtifacts.get(
        "docs/capabilities/evidence/LIVE_SUPABASE_STATE_2026-08-14.json",
      )?.sha256,
      vercel: evidenceArtifacts.get(
        "docs/capabilities/evidence/LIVE_VERCEL_PROJECTOS_STATE_2026-08-14.json",
      )?.sha256,
    },
    rejection_self_tests_passed: selfTestCount,
    github: {
      run_id: process.env.GITHUB_RUN_ID || null,
      job: process.env.GITHUB_JOB || null,
      event_name: process.env.GITHUB_EVENT_NAME || null,
      expected_head: process.env.EXPECTED_HEAD || null,
    },
    generated_at: new Date().toISOString(),
  };
  assert(
    !attestation.github.expected_head ||
      attestation.github.expected_head === checkedOutSha,
    "attestation expected head differs from checkout",
  );
  const absolute = resolve(root, outputPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, JSON.stringify(attestation, null, 2) + "\n");
}

process.stdout.write(
  "Evidence-first registry valid" +
    (selfTestCount ? `; ${selfTestCount} rejection self-tests passed` : "") +
    ".\n",
);
