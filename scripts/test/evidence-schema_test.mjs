import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { validateEntry, validateIndex } from "../lib/evidence-schema.mjs";
import { PROOF_STAGES, proofStageAtLeast } from "../lib/proof.mjs";

const VALID = Object.freeze({
  evidence_id: "sample",
  path: "docs/evidence/EVIDENCE_INDEX.json",
  observed_at: "2026-08-17T10:00:00Z",
  source_commit: "d0e689556cc01428500b796cade87032ea5c0ad8",
  source_tree: "8f31f2f752ce5d8704a25d70266763f30faa72f2",
  environment: "source",
  provider: "none",
  provider_resource_id: null,
  proof_stage: "documented",
  current: true,
  supersedes: [],
  superseded_by: null,
  evidence_sha256: "a".repeat(64),
  review_status: "not_submitted",
  deployment_status: "source_only",
  production_verified: false,
  rollback_ref: null,
});

test("accepts a well-formed entry", () => {
  assert.deepEqual(validateEntry({ ...VALID }), []);
});

test("proof stages are strictly ordered", () => {
  assert.equal(proofStageAtLeast("merged", "implemented"), true);
  assert.equal(proofStageAtLeast("implemented", "merged"), false);
  assert.equal(proofStageAtLeast("production_verified", "documented"), true);
  assert.equal(proofStageAtLeast("nonsense", "documented"), false);
  assert.equal(PROOF_STAGES[0], "documented");
  assert.equal(PROOF_STAGES.at(-1), "production_verified");
});

test("rejects a naive timestamp without timezone", () => {
  const errors = validateEntry({ ...VALID, observed_at: "2026-08-17T10:00:00" });
  assert.ok(errors.some((message) => message.includes("observed_at")));
});

test("rejects an abbreviated commit SHA", () => {
  assert.ok(
    validateEntry({ ...VALID, source_commit: "d0e6895" }).some((message) =>
      message.includes("source_commit")
    ),
  );
});

test("production_verified cannot be claimed without a production deployment", () => {
  const errors = validateEntry({
    ...VALID,
    production_verified: true,
    proof_stage: "production_verified",
    deployment_status: "source_only",
  });
  assert.ok(errors.some((message) => message.includes("production_deployed")));
});

test("source_only cannot claim the deployed proof stage", () => {
  const errors = validateEntry({
    ...VALID,
    proof_stage: "deployed",
    deployment_status: "source_only",
  });
  assert.ok(errors.some((message) => message.includes("contradicts")));
});

test("an entry cannot be both current and superseded", () => {
  const errors = validateEntry({ ...VALID, superseded_by: "newer" });
  assert.ok(errors.some((message) => message.includes("cannot be current and superseded")));
});

test("a stale entry must name its successor", () => {
  const errors = validateEntry({ ...VALID, current: false });
  assert.ok(errors.some((message) => message.includes("must name the evidence_id")));
});

test("supersession links must be symmetric", () => {
  const errors = validateIndex({
    entries: [
      { ...VALID, evidence_id: "new", supersedes: ["old"] },
      { ...VALID, evidence_id: "old", current: false, superseded_by: "unrelated" },
    ],
  });
  assert.ok(errors.some((message) => message.includes("symmetric")));
});

test("duplicate evidence ids are rejected", () => {
  const errors = validateIndex({
    entries: [{ ...VALID }, { ...VALID }],
  });
  assert.ok(errors.some((message) => message.includes("duplicate evidence_id")));
});

test("dangling supersedes references are rejected", () => {
  const errors = validateIndex({
    entries: [{ ...VALID, supersedes: ["ghost"] }],
  });
  assert.ok(errors.some((message) => message.includes("unknown evidence_id")));
});

test("the committed evidence index satisfies its own contract", () => {
  const index = JSON.parse(readFileSync("docs/evidence/EVIDENCE_INDEX.json", "utf8"));
  assert.deepEqual(validateIndex(index), []);
  assert.ok(index.entries.length > 0, "index must classify at least one artifact");
  assert.ok(
    index.entries.some((entry) => entry.current === false),
    "index must retain historical evidence, not only current state",
  );
});
