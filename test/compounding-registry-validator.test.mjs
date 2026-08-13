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
      candidate.current_canonical_source.files[0].classification = "invented";
    },
    /invalid classification/u,
  );
});

test("rejects a duplicate baseline entry", () => {
  rejects(
    (candidate) => {
      candidate.current_canonical_source.files.push(
        structuredClone(candidate.current_canonical_source.files[0]),
      );
    },
    /duplicate baseline entry/u,
  );
});

test("rejects a missing baseline entry", () => {
  rejects(
    (candidate) => {
      candidate.current_canonical_source.files.pop();
    },
    /missing baseline entry/u,
  );
});

test("rejects missing blob identity", () => {
  rejects(
    (candidate) => {
      delete candidate.current_canonical_source.files[0].git_blob_sha1;
    },
    /blob SHA mismatch or omission/u,
  );
});

test("rejects missing byte size", () => {
  rejects(
    (candidate) => {
      delete candidate.current_canonical_source.files[0].size_bytes;
    },
    /byte size mismatch or omission/u,
  );
});

test("rejects missing provenance", () => {
  rejects(
    (candidate) => {
      candidate.current_canonical_source.files[0].evidence = [];
    },
    /missing provenance/u,
  );
});

test("rejects incomplete canonical-baseline coverage claims", () => {
  rejects(
    (candidate) => {
      candidate.current_canonical_source.coverage.complete = false;
      candidate.current_canonical_source.coverage.completion_percent = null;
    },
    /canonical baseline coverage must be complete/u,
  );
});

test("rejects provenance that is not bound to the exact blob", () => {
  rejects(
    (candidate) => {
      candidate.current_canonical_source.files[0].evidence[0].blob_sha1 =
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
      const proof = candidate.current_canonical_source.files[0].proof;
      proof.stages.production_verified = "proven";
      proof.strongest_proven_state = "production-verified";
    },
    /deterministic registry content drift/u,
  );
});

test("rejects weakening blocked and historical classifications", () => {
  rejects(
    (candidate) => {
      candidate.current_canonical_source.files.find(
        (file) => file.path === "docs/recovery/SOURCE_RECOVERY_MANIFEST.json",
      ).classification = "active-current";
    },
    /deterministic registry content drift/u,
  );
});

test("keeps the recovery manifest at documented and blocked proof", () => {
  const manifest = registry.current_canonical_source.files.find(
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
