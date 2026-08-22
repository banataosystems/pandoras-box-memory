import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  REGISTRY_PATH,
  ROADMAP,
  readBaselineTree,
  validateRegistry,
} from "../scripts/compounding-registry-lib.mjs";

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
const roadmap = readFileSync(ROADMAP.path, "utf8");
const tree = readBaselineTree();

// `git commit-tree` refuses to run without an author identity, and CI runners
// have none configured. These commits are throwaway fixtures, so supply a
// fixed identity rather than depending on the environment.
const GIT_IDENTITY = {
  ...process.env,
  GIT_AUTHOR_NAME: "pandora-test",
  GIT_AUTHOR_EMAIL: "pandora-test@example.invalid",
  GIT_COMMITTER_NAME: "pandora-test",
  GIT_COMMITTER_EMAIL: "pandora-test@example.invalid",
};

function errorsAfter(change, roadmapText = roadmap) {
  const candidate = structuredClone(registry);
  change(candidate);
  return validateRegistry(candidate, tree, roadmapText);
}

function rejects(change, pattern, roadmapText = roadmap) {
  const errors = errorsAfter(change, roadmapText);
  assert.ok(errors.some((error) => pattern.test(error)), errors.join("\n"));
}

test("accepts the exact generated registry", () => {
  assert.deepEqual(validateRegistry(registry, tree, roadmap), []);
});

test("rejects an invalid classification", () => {
  rejects(
    (candidate) => {
      candidate.pinned_canonical_baseline.files[0].classification = "invented";
    },
    /invalid classification/u,
  );
});

test("rejects a duplicate baseline entry", () => {
  rejects(
    (candidate) => {
      candidate.pinned_canonical_baseline.files.push(
        structuredClone(candidate.pinned_canonical_baseline.files[0]),
      );
    },
    /duplicate baseline entry/u,
  );
});

test("rejects a missing baseline entry", () => {
  rejects(
    (candidate) => {
      candidate.pinned_canonical_baseline.files.pop();
    },
    /missing baseline entry/u,
  );
});

test("rejects missing blob identity", () => {
  rejects(
    (candidate) => {
      delete candidate.pinned_canonical_baseline.files[0].git_blob_sha1;
    },
    /blob SHA mismatch or omission/u,
  );
});

test("rejects missing byte size", () => {
  rejects(
    (candidate) => {
      delete candidate.pinned_canonical_baseline.files[0].size_bytes;
    },
    /byte size mismatch or omission/u,
  );
});

test("rejects missing provenance", () => {
  rejects(
    (candidate) => {
      candidate.pinned_canonical_baseline.files[0].evidence = [];
    },
    /missing provenance/u,
  );
});

test("rejects incomplete canonical-baseline coverage claims", () => {
  rejects(
    (candidate) => {
      candidate.pinned_canonical_baseline.coverage.complete = false;
      candidate.pinned_canonical_baseline.coverage.completion_percent = null;
    },
    /canonical baseline coverage must be complete/u,
  );
});

test("rejects provenance that is not bound to the exact blob", () => {
  rejects(
    (candidate) => {
      candidate.pinned_canonical_baseline.files[0].evidence[0].blob_sha1 =
        "0000000000000000000000000000000000000000";
    },
    /invalid provenance/u,
  );
});

test("rejects false original-archive completeness", () => {
  rejects(
    (candidate) => {
      candidate.original_archive.coverage.complete = true;
      candidate.original_archive.coverage.registered_file_count = 782;
      candidate.original_archive.coverage.completion_percent = 100;
    },
    /false archive completeness claim/u,
  );
});

test("rejects roadmap source drift", () => {
  rejects(() => {}, /versioned roadmap source does not match/u, `${roadmap}drift`);
});

test("rejects proof escalation without exact evidence", () => {
  rejects(
    (candidate) => {
      const proof = candidate.pinned_canonical_baseline.files[0].proof;
      proof.stages.production_verified = "proven";
      proof.strongest_proven_state = "production-verified";
    },
    /deterministic registry content drift/u,
  );
});

test("rejects weakening blocked and historical classifications", () => {
  rejects(
    (candidate) => {
      candidate.pinned_canonical_baseline.files.find(
        (file) => file.path === "docs/recovery/SOURCE_RECOVERY_MANIFEST.json",
      ).classification = "active-current";
    },
    /deterministic registry content drift/u,
  );
});

test("keeps the recovery manifest at documented and blocked proof", () => {
  const manifest = registry.pinned_canonical_baseline.files.find(
    (file) => file.path === "docs/recovery/SOURCE_RECOVERY_MANIFEST.json",
  );
  assert.equal(manifest.proof.strongest_proven_state, "documented");
  assert.equal(manifest.proof.stages.implemented, "blocked");
  assert.equal(manifest.proof.stages.production_verified, "blocked");
});

test("rejects false canonical Memory promotion", () => {
  rejects(
    (candidate) => {
      candidate.authoritative_roadmap.canonical_memory_state =
        "production-verified";
    },
    /deterministic registry content drift/u,
  );
});

test("rejects disabling review and replay gates", () => {
  rejects(
    (candidate) => {
      candidate.proof_gates.independent_different_vendor_review_required = false;
      candidate.proof_gates.no_historical_migration_or_edge_function_replay = false;
    },
    /deterministic registry content drift/u,
  );
});

test("rejects archive identity drift", () => {
  rejects(
    (candidate) => {
      candidate.original_archive.deterministic_capsule_sha256 =
        "0000000000000000000000000000000000000000000000000000000000000000";
      candidate.original_archive.recorded_source_commit =
        "0000000000000000000000000000000000000000";
    },
    /deterministic registry content drift/u,
  );
});

test("rejects runtime provider identity drift", () => {
  rejects(
    (candidate) => {
      candidate.live_runtime_snapshot.production_deployment.id = "invented";
      candidate.live_runtime_snapshot.edge_functions[0].provider_bundle_sha256 =
        "0000000000000000000000000000000000000000000000000000000000000000";
    },
    /deterministic registry content drift/u,
  );
});

test("secret scanner fails without printing a single-file secret", () => {
  const fixtureRoot = mkdtempSync(join(process.cwd(), ".secret-scan-test-"));
  const secret = `github_pat_${"A".repeat(24)}`;
  try {
    mkdirSync(join(fixtureRoot, "app", "api"), { recursive: true });
    writeFileSync(
      join(fixtureRoot, "app", "api", "fixture.ts"),
      `export const credential = "${secret}";\n`,
    );
    const result = spawnSync(
      "bash",
      [resolve("scripts/check_no_literal_secrets.sh")],
      { cwd: fixtureRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /app\/api\/fixture\.ts:1/u);
    assert.doesNotMatch(result.stdout, new RegExp(secret, "u"));
    assert.doesNotMatch(result.stderr, new RegExp(secret, "u"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Observational canonical-main semantics.
//
// The earlier shape recorded `current_canonical_main` and the validator checked
// it against whatever main happened to be. That is self-staling: it is true
// until this registry merges and false immediately afterwards, because merging
// advances main. The record is now an OBSERVATION plus a BASE RELATIONSHIP, and
// these tests pin both halves of that contract.
// ---------------------------------------------------------------------------

test("the observation does not claim to remain the current default branch", () => {
  const observed = registry.canonical_main_observed_at_generation;
  assert.equal(observed.candidate_base, observed.observed_main_sha);
  assert.match(observed.semantics, /does NOT/);
  // No field may be named as though it tracks the live default branch.
  assert.equal(registry.current_canonical_main, undefined);
  assert.equal(registry.pinned_canonical_baseline.is_current_canonical_main, false);
});

test("a later main advancement does not invalidate the recorded evidence", () => {
  // Prove it against real git rather than by inspection: build a throwaway
  // clone, advance its default branch beyond the observed commit, and run the
  // real validator script there. The candidate is untouched, so a validator
  // that still compared against "current main" would now fail.
  const dir = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "pandora-main-advance-"));
  try {
    const repo = resolve(".");
    const run = (args, cwd = dir) =>
      spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_IDENTITY });

    assert.equal(run(["clone", "--shared", "--no-checkout", repo, "clone"], dir).status, 0);
    const clone = join(dir, "clone");
    const head = run(["rev-parse", "HEAD"], repo).stdout.trim();
    assert.equal(run(["checkout", "--detach", head], clone).status, 0);

    const observedMain = registry.canonical_main_observed_at_generation.observed_main_sha;

    // Advance the default branch past the observed commit, exactly as merging
    // any pull request would.
    const advanced = run(
      ["commit-tree", `${observedMain}^{tree}`, "-p", observedMain, "-m", "advance main"],
      clone,
    );
    assert.equal(advanced.status, 0, advanced.stderr);
    const newMain = advanced.stdout.trim();
    assert.notEqual(newMain, observedMain);
    assert.equal(run(["update-ref", "refs/remotes/origin/main", newMain], clone).status, 0);
    assert.equal(run(["update-ref", "refs/heads/main", newMain], clone).status, 0);

    const result = spawnSync(
      process.execPath,
      [join(repo, "scripts/validate_compounding_registry.mjs")],
      { cwd: clone, encoding: "utf8" },
    );
    assert.equal(
      result.status,
      0,
      `validator must still pass after main advanced:\n${result.stdout}\n${result.stderr}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects a candidate_base that is not the observed canonical main", () => {
  rejects(
    (candidate) => {
      candidate.canonical_main_observed_at_generation.candidate_base =
        candidate.pinned_canonical_baseline.commit;
    },
    /candidate_base must be the canonical main this candidate was generated against/,
  );
});

test("rejects an observed main that is not an ancestor of the candidate", () => {
  // An orphan commit is real but was never in this candidate's history, so it
  // cannot be the base the candidate was built on.
  const orphan = spawnSync(
    "git",
    ["commit-tree", "HEAD^{tree}", "-m", "orphan"],
    { cwd: resolve("."), encoding: "utf8", env: GIT_IDENTITY },
  );
  assert.equal(orphan.status, 0, orphan.stderr);
  const sha = orphan.stdout.trim();
  rejects(
    (candidate) => {
      candidate.canonical_main_observed_at_generation.observed_main_sha = sha;
      candidate.canonical_main_observed_at_generation.candidate_base = sha;
    },
    /must be an ancestor of the candidate|observed_main_tree|observed_main_regular_file_count/,
  );
});

test("rejects an observation that omits its non-currency statement", () => {
  rejects(
    (candidate) => {
      candidate.canonical_main_observed_at_generation.semantics =
        "This is the current canonical main.";
    },
    /does not claim to remain current/,
  );
});
