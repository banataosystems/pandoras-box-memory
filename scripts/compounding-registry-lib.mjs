import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export const BASELINE = Object.freeze({
  repository: "banataosystems/pandoras-box-memory",
  commit: "db409325c15778a1a701dad3f931e4c0fd19447c",
  tree: "fecb745e193c78420c19c4bbb0ee0830510a08c4",
  regularFileCount: 62,
});

export const ROADMAP = Object.freeze({
  issue: 22,
  title: "Pandora Compounding Intelligence — Master Roadmap v2",
  issueUrl:
    "https://github.com/banataosystems/pandoras-box-memory/issues/22",
  apiUrl:
    "https://api.github.com/repos/banataosystems/pandoras-box-memory/issues/22",
  path: "docs/roadmap/PANDORA_COMPOUNDING_INTELLIGENCE_MASTER_ROADMAP_V2.md",
  bodySha256: "6edfccb01d9b0a386906383b2c954471544f86ed15c5338005edb8f569048548",
});

// Fixed observation timestamp. The registry is deterministic — a wall-clock
// value here would make every regeneration produce a different document and
// defeat the drift check.
export const OBSERVED_AT = "2026-08-18T00:00:00Z";

export const REGISTRY_PATH =
  "docs/capabilities/PANDORA_COMPOUNDING_CAPABILITY_REGISTRY_V1.json";

export const CLASSIFICATIONS = Object.freeze([
  "active-current",
  "current-better-than-original",
  "original-better-than-current",
  "missing-from-current",
  "candidate-for-recovery",
  "duplicate",
  "obsolete-superseded",
  "historical-only",
  "blocked-pending-proof",
]);

const PROOF_VALUES = new Set(["proven", "unknown", "blocked", "not-applicable"]);
const PROOF_STAGES = [
  "documented",
  "implemented",
  "tested",
  "deployed",
  "production_verified",
];

const HISTORICAL_PATHS = new Set([
  "RECOVERY_STATUS_2026-08-09.md",
  "docs/project-state/PANDORA_FULL_CAPACITY_MEMORY_CANON_PROOF_2026-08-12.md",
  "docs/project-state/PANDORA_FULL_CAPACITY_PLAN_2026-08-12.md",
  "docs/recovery/AUTH_RECOVERY_2026-08-09.md",
  "docs/recovery/EXTERNAL_MCP_ACCESS_BLOCKER_2026-08-09.md",
  "docs/recovery/LIVE_MEMORY_STATE_2026-08-09.md",
  "docs/recovery/LIVE_MIGRATION_INVENTORY_2026-08-09.md",
  "docs/recovery/LIVE_PARITY_RECONCILIATION_2026-08-10.md",
  "docs/security/2026-08-09_LEGACY_SECRET_MIGRATION_FINDING.md",
  "ops/PRODUCTION_MCP_RECOVERY_2026-08-09.md",
  "ops/projectos-memory-connector-recovery-2026-08-10.md",
  "ops/vercel-rebind-probe-2026-08-09.md",
]);

const ARCHIVE_CAPABILITY_FAMILIES = Object.freeze([
  "adaptive-memory",
  "autopilot-distillation",
  "compaction-and-scoring",
  "candidate-review",
  "persistence-readback-and-retrieval",
  "operator-and-admin-console",
  "operating-brain",
  "project-context-engine",
  "shadow-context-packs",
  "preflight",
  "promotion-request-execution-and-rollback",
  "operator-actions",
  "mcp-and-oauth",
  "environment-governance",
  "automated-tests",
  "documentation-and-skills",
]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeRoadmap(value) {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}


/** Current default-branch commit, or null when it cannot be resolved offline. */
export function resolveDefaultBranchCommit() {
  for (const ref of ["origin/main", "main"]) {
    try {
      return execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // try the next ref
    }
  }
  return null;
}

export function resolveTree(commit) {
  try {
    return execFileSync("git", ["rev-parse", `${commit}^{tree}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function countTreeFiles(commit) {
  const blobs = readTreeBlobs(commit);
  return blobs.size > 0 ? blobs.size : null;
}


/**
 * The pinned baseline is history; this block is the present.
 *
 * The registry previously described the baseline commit under a field named
 * `current_canonical_source`. That was true when written and became false the
 * moment main advanced, which is exactly the drift the registry exists to
 * catch. The per-file registry stays pinned — overwriting it would destroy the
 * historical evidence — so the relationship to current main is computed here
 * instead, by comparing blob SHA-1s across both trees.
 */

/** path -> blob SHA-1 for every regular file in `commit`. */
export function readTreeBlobs(commit) {
  const map = new Map();
  let raw;
  try {
    raw = execFileSync("git", ["ls-tree", "-r", commit], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return map;
  }
  for (const line of raw.trim().split("\n").filter(Boolean)) {
    const match = line.match(/^\d+\s+blob\s+([0-9a-f]{40})\t(.+)$/u);
    if (match) map.set(match[2], match[1]);
  }
  return map;
}

/**
 * Record the canonical main this candidate was GENERATED AGAINST.
 *
 * The previous shape named this `current_canonical_main` and asserted the
 * observed SHA. That claim is true only until this very registry merges: main
 * necessarily advances, and a field called "current" is then false about the
 * repository it describes. Embedding the SHA of the commit that contains this
 * file is not an alternative — changing the embedded value changes the commit
 * hash, so the self-reference cannot close.
 *
 * So this records an OBSERVATION with a base relationship instead. Both remain
 * true forever: `observed_main_sha` was main when the candidate was generated,
 * and `candidate_base` is an ancestor of the candidate. Neither claims to be
 * the present state of the default branch.
 */
export function buildObservedCanonicalMainBlock() {
  const observed = resolveDefaultBranchCommit();
  const baseline = new Map(
    readBaselineTree().map((entry) => [entry.path, entry.blobSha]),
  );
  const observedBlobs = observed ? readTreeBlobs(observed) : new Map();

  const changed = [];
  const removed = [];
  let unchanged = 0;
  for (const [path, sha] of baseline) {
    if (!observedBlobs.has(path)) removed.push(path);
    else if (observedBlobs.get(path) !== sha) changed.push(path);
    else unchanged += 1;
  }
  let added = 0;
  for (const path of observedBlobs.keys()) if (!baseline.has(path)) added += 1;

  return {
    repository: BASELINE.repository,
    observed_main_sha: observed,
    observed_main_tree: observed ? resolveTree(observed) : null,
    observed_main_regular_file_count: observedBlobs.size,
    observed_at: OBSERVED_AT,
    candidate_base: observed,
    semantics:
      "Observation recorded when this registry candidate was generated. It " +
      "states which canonical main the candidate was built on; it does NOT " +
      "claim to remain the current default branch. Main advances after this " +
      "candidate merges, and that does not make this record false.",
    relationship_to_pinned_baseline: {
      baseline_commit: BASELINE.commit,
      baseline_regular_file_count: BASELINE.regularFileCount,
      baseline_files_unchanged_at_observed_main: unchanged,
      baseline_files_changed_at_observed_main: changed.length,
      baseline_files_removed_at_observed_main: removed.length,
      files_added_since_baseline: added,
      changed_paths: changed.sort(),
      removed_paths: removed.sort(),
      snapshot_scope:
        "Computed between the pinned baseline and observed_main_sha at " +
        "generation time. Snapshot-scoped, not a live figure.",
      method: "git blob SHA-1 comparison of every path in both trees",
    },
    per_file_registry_coverage_of_observed_main: "not-claimed",
    note:
      "The per-file registry is pinned to the historical baseline and is NOT " +
      "regenerated against observed main, so the historical registry evidence " +
      "is preserved rather than overwritten. Files added since the baseline " +
      "are therefore unregistered, and no coverage or completion percentage " +
      "is claimed.",
  };
}

/** True when `ancestor` is an ancestor of (or equal to) `descendant`. */
export function isAncestorOf(ancestor, descendant) {
  if (!ancestor || !descendant) return false;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveHeadCommit() {
  return git_rev_parse("HEAD");
}

function git_rev_parse(ref) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function readBaselineTree() {
  const raw = execFileSync(
    "git",
    ["ls-tree", "-r", "-l", BASELINE.commit],
    { encoding: "utf8" },
  );

  const entries = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\d+\s+blob\s+([0-9a-f]{40})\s+(\d+)\t(.+)$/u);
      if (!match) {
        throw new Error(`Unsupported baseline tree entry: ${line}`);
      }
      return { blobSha: match[1], sizeBytes: Number(match[2]), path: match[3] };
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  const tree = execFileSync(
    "git",
    ["rev-parse", `${BASELINE.commit}^{tree}`],
    { encoding: "utf8" },
  ).trim();
  if (tree !== BASELINE.tree) {
    throw new Error(`Baseline tree drift: expected ${BASELINE.tree}, received ${tree}`);
  }
  return entries;
}

function capabilityFamily(path) {
  if (path.startsWith(".github/workflows/")) return "delivery-governance";
  if (path === "PROJECT_CUSTOM_INSTRUCTION.md") return "product-canon";
  if (path.startsWith("app/.well-known/") || path === "app/api/mcp/route.ts") {
    return "mcp-and-oauth";
  }
  if (path.startsWith("app/api/projectos/")) return "memory-connector";
  if (path.startsWith("app/auth/") || path.startsWith("app/oauth/")) {
    return "authentication-and-consent";
  }
  if (path.startsWith("app/")) return "operator-web-surface";
  if (path.startsWith("docs/adapters/")) return "provider-adapters";
  if (path.startsWith("docs/architecture/")) return "architecture";
  if (path.startsWith("docs/auth/")) return "authentication-and-consent";
  if (path.startsWith("docs/project-state/")) return "project-state-evidence";
  if (path.startsWith("docs/recovery/") || path.startsWith("recovery/")) {
    return "source-and-runtime-recovery";
  }
  if (path.startsWith("docs/roadmap/")) return "roadmap";
  if (path.startsWith("docs/security/")) return "security-evidence";
  if (path.startsWith("lib/services/")) return "memory-connector";
  if (path.startsWith("lib/supabase/")) return "supabase-data-access";
  if (path.startsWith("ops/")) return "operations-and-rollback";
  if (path === "scripts/check_no_literal_secrets.sh") return "source-security";
  if (path.includes("pandora-machine-gateway")) return "machine-gateway";
  if (path.includes("pandora-projectos-bridge")) return "projectos-memory-bridge";
  if (path.includes("pandora-projectos-learning")) return "post-task-learning";
  if (path.startsWith("supabase/migrations/")) {
    if (path.includes("flutterflow")) return "flutterflow-governance";
    if (path.includes("oauth")) return "mcp-and-oauth";
    if (path.includes("vault") || path.includes("authorization")) {
      return "security-and-credential-governance";
    }
    return "gateway-governance";
  }
  return "application-build-and-configuration";
}

function classificationFor(path) {
  if (path === "docs/roadmap/ALWAYS_ON_MEMORY_IMPLEMENTATION_ROADMAP.md") {
    return "obsolete-superseded";
  }
  if (
    path === "docs/recovery/PHASE0_SOURCE_RECOVERY_GATE.md" ||
    path === "docs/recovery/SOURCE_RECOVERY_MANIFEST.json"
  ) {
    return "blocked-pending-proof";
  }
  if (HISTORICAL_PATHS.has(path) || path.startsWith("recovery/web-overlay/")) {
    return "historical-only";
  }
  return "active-current";
}

function isDocument(path) {
  return path.endsWith(".md");
}

function proofFor(path, classification) {
  if (classification === "blocked-pending-proof") {
    return {
      strongest_proven_state: "documented",
      stages: {
        documented: "proven",
        implemented: "blocked",
        tested: "blocked",
        deployed: "blocked",
        production_verified: "blocked",
      },
    };
  }
  if (isDocument(path)) {
    return {
      strongest_proven_state: "documented",
      stages: {
        documented: "proven",
        implemented: "not-applicable",
        tested: "unknown",
        deployed: "unknown",
        production_verified: "unknown",
      },
    };
  }
  return {
    strongest_proven_state: "implemented",
    stages: {
      documented: "unknown",
      implemented: "proven",
      tested: "unknown",
      deployed: "unknown",
      production_verified: "unknown",
    },
  };
}

function ownerTargetFor(family) {
  if (family === "delivery-governance" || family === "source-security") {
    return "Pandora delivery governance";
  }
  if (family.includes("gateway") || family.includes("bridge") || family.includes("learning")) {
    return "Pandora Memory runtime";
  }
  if (family.includes("supabase") || family.includes("credential")) {
    return "Pandora Memory Supabase boundary";
  }
  if (family.includes("operator") || family.includes("authentication")) {
    return "Pandora phone-first operator experience";
  }
  if (family.includes("recovery") || family.includes("operations")) {
    return "Pandora recovery and operations";
  }
  return "Pandora product canon";
}

function nextActionFor(path, classification) {
  if (classification === "obsolete-superseded") {
    return "Retain as provenance; link retrieval to Roadmap v2 and never treat this older roadmap as current authority.";
  }
  if (classification === "historical-only") {
    return "Retain as dated evidence; supersede stale state through linked current records without deleting history.";
  }
  if (classification === "blocked-pending-proof") {
    return "Reconcile against the content-addressed original archive and live provider state; do not infer or replay missing source.";
  }
  if (path.startsWith("supabase/migrations/")) {
    return "Reconcile identity and content against the 67-item live ledger; never replay historical migrations solely for parity.";
  }
  if (path.startsWith("supabase/functions/")) {
    return "Preserve exact live/source parity evidence and obtain different-vendor review before any deployment.";
  }
  return "Map exact tests and live evidence before advancing this file beyond its currently proven source state.";
}

export function buildRegistry(treeEntries) {
  const files = treeEntries.map(({ path, blobSha, sizeBytes }) => {
    const family = capabilityFamily(path);
    const classification = classificationFor(path);
    return {
      path,
      git_blob_sha1: blobSha,
      size_bytes: sizeBytes,
      capability_family: family,
      classification,
      proof: proofFor(path, classification),
      evidence: [
        {
          type: "github-blob",
          repository: BASELINE.repository,
          commit: BASELINE.commit,
          tree: BASELINE.tree,
          path,
          blob_sha1: blobSha,
          size_bytes: sizeBytes,
        },
      ],
      owner_target: ownerTargetFor(family),
      next_action: nextActionFor(path, classification),
    };
  });

  return {
    schema_version: "1.0.0",
    registry_id: "pandora-compounding-capability-registry-v1",
    generated_at: "2026-08-14T01:45:00+08:00",
    authoritative_roadmap: {
      title: ROADMAP.title,
      github_issue: ROADMAP.issue,
      issue_url: ROADMAP.issueUrl,
      versioned_source_path: ROADMAP.path,
      normalized_body_sha256: ROADMAP.bodySha256,
      state: "documented",
      canonical_memory_state: "blocked-pending-reviewed-persistence-and-readback",
    },
    security_privacy_reliability_cross_cutting_from_phase_1: true,
    project_completion_percent: null,
    original_archive: {
      identity_rule: "SHA-256 plus byte size; filenames are aliases, not authority",
      filename_aliases: ["Memory-main (4).zip", "Memory-main (4)(2).zip"],
      size_bytes: 1085918,
      zip_sha256: "b0cfc83e04798887d9e889f45a1b9c8cf0e42cc51ce7f46fb3923b3a22434f2b",
      deterministic_capsule_sha256:
        "458e7fa22541f103d6ed22198418d38928bba9c43006136c70534f0afdefbb13",
      recorded_source_commit: "7d4ec6cb30edb922024cf05f043807759d1fded7",
      expected_regular_file_count: 782,
      archive_bytes_available_in_canonical_repository: false,
      deterministic_per_file_manifest_available: false,
      coverage: {
        registered_file_count: 0,
        expected_file_count: 782,
        complete: false,
        completion_percent: null,
        classification: "blocked-pending-proof",
        blocking_reason:
          "The content-addressed archive bytes and deterministic per-file manifest are not present in the exact canonical baseline; unseen files must not be reconstructed from model inference.",
      },
      known_capability_families: ARCHIVE_CAPABILITY_FAMILIES.map((family) => ({
        family,
        classification: "blocked-pending-proof",
        evidence: ROADMAP.issueUrl,
      })),
    },
    pinned_canonical_baseline: {
      repository: BASELINE.repository,
      commit: BASELINE.commit,
      tree: BASELINE.tree,
      git_signature_verification: {
        state: "provider-verified",
        evidence_url: `https://github.com/${BASELINE.repository}/commit/${BASELINE.commit}`,
        independently_reverified_in_registry_cycle: false,
      },
      baseline_regular_file_count: BASELINE.regularFileCount,
      coverage: {
        registered_file_count: files.length,
        expected_file_count: BASELINE.regularFileCount,
        complete: files.length === BASELINE.regularFileCount,
        completion_percent:
          files.length === BASELINE.regularFileCount ? 100 : null,
        scope: "exact canonical baseline only; not original-archive or live-runtime completeness",
      },
      relationship_to_original_archive: "not-proven",
      relationship_to_current_production_deployment: "not-proven-file-by-file",
      snapshot_scope:
        "per-file registry pinned to the historical baseline commit below. " +
        "This is NOT a file listing of current canonical main; see " +
        "canonical_main_observed_at_generation for that relationship.",
      is_current_canonical_main: false,
      files,
    },
    canonical_main_observed_at_generation: buildObservedCanonicalMainBlock(),
    live_runtime_snapshot: {
      observed_at: "2026-08-14T01:36:00+08:00",
      durable_documentary_source: {
        issue_url: ROADMAP.issueUrl,
        normalized_body_sha256: ROADMAP.bodySha256,
        evidence_limit:
          "Provider-native identifiers and hashes are documented; independent review and file-by-file deployment parity remain open.",
      },
      production_origin: "https://pandorasbox-memory.vercel.app",
      production_deployment: {
        id: "dpl_7CbTiMxMXQZjrLQDKchf455iBxi4",
        state: "deployed",
        exact_relationship_to_canonical_baseline: "not-proven-file-by-file",
      },
      rollback_target: {
        id: "dpl_9EkwxicRPzigkvUis5m1qk644CrG",
        state: "recorded",
        exercise_state: "not-proven-in-this-registry-cycle",
      },
      connector_health_and_search: {
        state: "observed-provider-readback-not-yet-canonized",
        authentication: "vercel_oidc",
        evidence:
          "Pandora Memory health and search read-back in the 2026-08-14 ProjectOS recovery cycle; durable Memory-canon transition remains blocked.",
      },
      migration_ledger: {
        live_identity_count: 67,
        latest_live_version: "20260810115547",
        canonical_baseline_migration_file_count: 15,
        state: "deployed-identities-source-content-parity-incomplete",
        replay_authorized: false,
      },
      edge_functions: [
        {
          name: "pandora-projectos-bridge",
          live_version: 13,
          provider_bundle_sha256:
            "3c63c366389e9cc294b548643738b06d0e594a6ee064a6976dd558e489f5fe0a",
          state: "deployed-source-equivalence-recorded",
          independent_review: "open",
        },
        {
          name: "pandora-projectos-learning",
          live_version: 1,
          provider_bundle_sha256:
            "eec5a67e3e9af88850aa2a0e98dca7a344a54086b51166b5cc0a91e2b0ac82fe",
          state: "deployed-source-equivalence-recorded",
          independent_review: "open",
        },
        {
          name: "pandora-machine-gateway",
          live_version: 3,
          provider_bundle_sha256:
            "6dcdce080275161311a3a872c821db826d09adc02eee5ff9866fcb406d02a30f",
          state: "deployed-comment-only-source-difference-recorded",
          independent_review: "open",
        },
      ],
      production_mutation_in_registry_cycle: false,
    },
    proof_gates: {
      states: ["documented", "implemented", "tested", "deployed", "production-verified"],
      independent_different_vendor_review_required: true,
      merge_authorized: false,
      production_release_authorized: false,
      no_new_spending: true,
      no_historical_migration_or_edge_function_replay: true,
    },
  };
}

function expectedStrongestState(stages) {
  if (stages.production_verified === "proven") return "production-verified";
  if (stages.deployed === "proven") return "deployed";
  if (stages.tested === "proven") return "tested";
  if (stages.implemented === "proven") return "implemented";
  if (stages.documented === "proven") return "documented";
  return null;
}

export function validateRegistry(registry, treeEntries, roadmapText) {
  const errors = [];
  const add = (condition, message) => {
    if (!condition) errors.push(message);
  };

  add(registry?.schema_version === "1.0.0", "invalid schema version");
  add(registry?.project_completion_percent === null, "project completion percent must remain null");
  add(
    registry?.security_privacy_reliability_cross_cutting_from_phase_1 === true,
    "security/privacy/reliability must be cross-cutting from Phase 1",
  );
  add(
    registry?.authoritative_roadmap?.github_issue === ROADMAP.issue,
    "roadmap issue identity mismatch",
  );
  add(
    registry?.authoritative_roadmap?.normalized_body_sha256 === ROADMAP.bodySha256,
    "roadmap hash identity mismatch",
  );
  add(
    sha256(normalizeRoadmap(roadmapText)) === ROADMAP.bodySha256,
    "versioned roadmap source does not match issue #22",
  );

  const archive = registry?.original_archive;
  add(archive?.zip_sha256 === "b0cfc83e04798887d9e889f45a1b9c8cf0e42cc51ce7f46fb3923b3a22434f2b", "archive SHA-256 mismatch");
  add(archive?.size_bytes === 1085918, "archive byte size mismatch");
  add(archive?.filename_aliases?.includes("Memory-main (4).zip"), "missing roadmap archive alias");
  add(archive?.filename_aliases?.includes("Memory-main (4)(2).zip"), "missing recovery-manifest archive alias");
  add(archive?.archive_bytes_available_in_canonical_repository === false, "archive availability must fail closed");
  add(archive?.deterministic_per_file_manifest_available === false, "per-file archive manifest must fail closed");
  add(archive?.coverage?.registered_file_count === 0, "archive registered count must remain zero without artifact");
  add(archive?.coverage?.expected_file_count === 782, "archive expected file count mismatch");
  add(archive?.coverage?.complete === false, "false archive completeness claim");
  add(archive?.coverage?.completion_percent === null, "archive completion percentage must remain null");
  add(archive?.coverage?.classification === "blocked-pending-proof", "archive must remain blocked-pending-proof");

  // The pinned baseline is deliberately historical, so it must SAY so. A block
  // that pins an old commit while presenting itself as current state is the
  // exact drift this registry exists to prevent.
  add(
    registry?.pinned_canonical_baseline?.is_current_canonical_main === false,
    "pinned baseline must not present itself as current canonical main",
  );

  // The observation block is checked as an OBSERVATION plus a BASE
  // RELATIONSHIP, never as a claim about the present default branch.
  //
  // Checking it against "whatever main is now" is what rotted the previous
  // shape: it was true until this registry merged and false immediately after.
  // These properties instead stay true forever — the observed commit really was
  // a commit, its tree really is its tree, and it really is an ancestor of the
  // candidate that recorded it.
  const observed = registry?.canonical_main_observed_at_generation;
  const observedSha = observed?.observed_main_sha;

  add(
    typeof observedSha === "string" && /^[0-9a-f]{40}$/u.test(observedSha),
    "canonical_main_observed_at_generation.observed_main_sha must be a 40-hex commit id",
  );

  if (typeof observedSha === "string") {
    add(
      resolveTree(observedSha) !== null,
      `observed_main_sha ${observedSha.slice(0, 12)}… must be a real commit`,
    );
    add(
      observed?.observed_main_tree === resolveTree(observedSha),
      "observed_main_tree must be the tree of observed_main_sha",
    );
    add(
      observed?.observed_main_regular_file_count === countTreeFiles(observedSha),
      "observed_main_regular_file_count must match the observed tree",
    );

    // The candidate/base relationship, proven from git. This is what makes the
    // record verifiable after main advances: the base stays an ancestor of the
    // candidate forever, whereas "current main" does not.
    add(
      observed?.candidate_base === observedSha,
      "candidate_base must be the canonical main this candidate was generated against",
    );
    const head = resolveHeadCommit();
    if (head) {
      add(
        isAncestorOf(observedSha, head),
        `candidate_base ${observedSha.slice(0, 12)}… must be an ancestor of the ` +
          `candidate (${head.slice(0, 12)}…) — a base this candidate was not built on is not its base`,
      );
    }
  }

  add(
    typeof observed?.observed_at === "string" && observed.observed_at.trim() !== "",
    "canonical_main_observed_at_generation must record observed_at",
  );
  add(
    typeof observed?.semantics === "string" &&
      /does NOT|not.*claim/u.test(observed.semantics),
    "the observation must state explicitly that it does not claim to remain current",
  );
  add(
    observed?.relationship_to_pinned_baseline?.baseline_commit === BASELINE.commit,
    "the observation must name the pinned baseline it is compared against",
  );
  add(
    typeof observed?.relationship_to_pinned_baseline?.snapshot_scope === "string",
    "the baseline relationship must declare its snapshot scope",
  );
  add(
    observed?.per_file_registry_coverage_of_observed_main === "not-claimed",
    "per-file coverage of observed main must not be claimed while the registry stays pinned",
  );

  const current = registry?.pinned_canonical_baseline;
  add(current?.repository === BASELINE.repository, "canonical repository mismatch");
  add(current?.commit === BASELINE.commit, "canonical baseline commit mismatch");
  add(current?.tree === BASELINE.tree, "canonical baseline tree mismatch");
  add(current?.relationship_to_original_archive === "not-proven", "archive relationship overclaim");
  add(current?.relationship_to_current_production_deployment === "not-proven-file-by-file", "production relationship overclaim");

  const files = Array.isArray(current?.files) ? current.files : [];
  const expected = new Map(treeEntries.map((entry) => [entry.path, entry]));
  const seen = new Set();
  add(files.length === BASELINE.regularFileCount, `canonical file count must equal ${BASELINE.regularFileCount}`);
  add(current?.coverage?.registered_file_count === files.length, "canonical coverage count mismatch");
  add(current?.coverage?.expected_file_count === BASELINE.regularFileCount, "canonical expected count mismatch");
  add(current?.coverage?.complete === true, "canonical baseline coverage must be complete");
  add(current?.coverage?.completion_percent === 100, "canonical baseline coverage must be exactly 100 percent");

  for (const file of files) {
    add(typeof file?.path === "string" && file.path.length > 0, "missing file path");
    if (typeof file?.path !== "string") continue;
    add(!seen.has(file.path), `duplicate baseline entry: ${file.path}`);
    seen.add(file.path);
    const baseline = expected.get(file.path);
    add(Boolean(baseline), `non-baseline file registered: ${file.path}`);
    if (baseline) {
      add(file.git_blob_sha1 === baseline.blobSha, `blob SHA mismatch or omission: ${file.path}`);
      add(file.size_bytes === baseline.sizeBytes, `byte size mismatch or omission: ${file.path}`);
    }
    add(CLASSIFICATIONS.includes(file.classification), `invalid classification: ${file.path}`);
    add(typeof file.capability_family === "string" && file.capability_family.length > 0, `missing capability family: ${file.path}`);
    add(typeof file.owner_target === "string" && file.owner_target.length > 0, `missing owner/target: ${file.path}`);
    add(typeof file.next_action === "string" && file.next_action.length > 0, `missing next action: ${file.path}`);
    add(Array.isArray(file.evidence) && file.evidence.length > 0, `missing provenance: ${file.path}`);
    const evidence = file.evidence?.[0];
    add(
      evidence?.type === "github-blob" &&
        evidence?.repository === BASELINE.repository &&
        evidence?.commit === BASELINE.commit &&
        evidence?.tree === BASELINE.tree &&
        evidence?.path === file.path &&
        evidence?.blob_sha1 === file.git_blob_sha1 &&
        evidence?.size_bytes === file.size_bytes,
      `invalid provenance: ${file.path}`,
    );

    const stages = file.proof?.stages || {};
    for (const stage of PROOF_STAGES) {
      add(PROOF_VALUES.has(stages[stage]), `invalid proof stage ${stage}: ${file.path}`);
    }
    add(
      file.proof?.strongest_proven_state === expectedStrongestState(stages),
      `strongest proof mismatch: ${file.path}`,
    );
  }

  for (const path of expected.keys()) {
    add(seen.has(path), `missing baseline entry: ${path}`);
  }

  const byPath = new Map(files.map((file) => [file.path, file]));
  add(byPath.get("RECOVERY_STATUS_2026-08-09.md")?.classification === "historical-only", "stale recovery status must be historical-only");
  add(byPath.get("docs/roadmap/ALWAYS_ON_MEMORY_IMPLEMENTATION_ROADMAP.md")?.classification === "obsolete-superseded", "older roadmap must be explicitly superseded");
  add(byPath.get("docs/recovery/PHASE0_SOURCE_RECOVERY_GATE.md")?.classification === "blocked-pending-proof", "Phase 0 recovery gate must stay blocked");
  add(registry?.proof_gates?.merge_authorized === false, "registry must not authorize merge");
  add(registry?.proof_gates?.production_release_authorized === false, "registry must not authorize production release");
  add(registry?.live_runtime_snapshot?.production_mutation_in_registry_cycle === false, "registry cycle must not claim production mutation");

  const expectedRegistry = buildRegistry(treeEntries);
  add(
    JSON.stringify(registry) === JSON.stringify(expectedRegistry),
    "deterministic registry content drift: regenerate from the pinned baseline and review any semantic change",
  );

  return errors;
}

export async function fetchPinnedRoadmap() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "pandora-compounding-registry-verifier/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(ROADMAP.apiUrl, { headers });
  if (!response.ok) {
    throw new Error(`Roadmap retrieval failed with HTTP ${response.status}`);
  }
  const issue = await response.json();
  if (
    issue.number !== ROADMAP.issue ||
    issue.title !== ROADMAP.title ||
    issue.state !== "open" ||
    typeof issue.body !== "string"
  ) {
    throw new Error("Roadmap issue identity, title, state, or body is invalid");
  }
  const roadmapBody = normalizeRoadmap(issue.body);
  if (sha256(roadmapBody) !== ROADMAP.bodySha256) {
    throw new Error(
      "Roadmap issue #22 changed; review and deliberately update the pinned hash",
    );
  }
  return roadmapBody;
}
