#!/usr/bin/env node
// Validate docs/evidence/EVIDENCE_INDEX.json against the schema and the tree.
//
// Three independent failures are caught here:
//
//   1. A malformed or self-contradictory index entry (schema + consistency).
//   2. A tracked evidence artifact whose bytes changed without the index being
//      deliberately updated — i.e. history was rewritten in place.
//   3. An evidence artifact that exists on disk but is not classified at all,
//      which is how stale snapshots quietly re-enter circulation as "truth".
//
// Run with --self-test to prove the validator rejects the shapes it claims to.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { argv, exit } from "node:process";

import {
  EVIDENCE_INDEX_PATH,
  fileSha256,
  validateEntry,
  validateIndex,
} from "./lib/evidence-schema.mjs";

// Evidence artifacts live under these roots. Anything matching here must be
// classified in the index.
const EVIDENCE_GLOB_ROOTS = [
  "docs/capabilities/evidence",
  "docs/project-state",
  "docs/recovery",
  "docs/verification",
  "ops",
];

const EXCLUDED_FROM_COVERAGE = new Set([
  // Fixture inputs consumed by a verifier, indexed explicitly where relevant.
  "docs/verification/fixtures",
]);

function trackedFiles() {
  // Use the committed tree, not a directory walk, so untracked scratch files
  // never influence the gate.
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function loadIndex() {
  if (!existsSync(EVIDENCE_INDEX_PATH)) {
    console.error(`Missing ${EVIDENCE_INDEX_PATH}`);
    exit(1);
  }
  try {
    return JSON.parse(readFileSync(EVIDENCE_INDEX_PATH, "utf8"));
  } catch (error) {
    console.error(`${EVIDENCE_INDEX_PATH} is not valid JSON: ${error.message}`);
    exit(1);
  }
}

function selfTest() {
  const base = {
    evidence_id: "sample",
    path: "docs/evidence/EVIDENCE_INDEX.json",
    observed_at: "2026-08-17T00:00:00Z",
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
  };

  const cases = [
    ["valid baseline", base, false],
    ["unknown proof stage", { ...base, proof_stage: "shipped" }, true],
    ["naive timestamp", { ...base, observed_at: "2026-08-17 00:00:00" }, true],
    ["short commit", { ...base, source_commit: "d0e6895" }, true],
    [
      "production_verified without production deployment",
      { ...base, production_verified: true, proof_stage: "production_verified" },
      true,
    ],
    [
      "source_only claiming deployed",
      { ...base, proof_stage: "deployed", deployment_status: "source_only" },
      true,
    ],
    ["current and superseded", { ...base, superseded_by: "other" }, true],
    ["stale with no successor", { ...base, current: false }, true],
    ["bad digest", { ...base, evidence_sha256: "nope" }, true],
    ["unknown provider", { ...base, provider: "netlify" }, true],
    [
      "resource id set for provider none",
      { ...base, provider_resource_id: "abc" },
      true,
    ],
  ];

  let failures = 0;
  for (const [label, entry, shouldReject] of cases) {
    const errors = validateEntry(entry);
    const rejected = errors.length > 0;
    if (rejected !== shouldReject) {
      console.error(
        `SELF-TEST FAIL: '${label}' expected ${shouldReject ? "rejection" : "acceptance"}` +
          `, got ${rejected ? "rejection" : "acceptance"}${rejected ? `: ${errors[0]}` : ""}`,
      );
      failures += 1;
    }
  }

  // Asymmetric supersession must be caught at index level.
  const asymmetric = {
    entries: [
      { ...base, evidence_id: "new", supersedes: ["old"] },
      { ...base, evidence_id: "old", current: false, superseded_by: "someone-else" },
    ],
  };
  if (!validateIndex(asymmetric).some((message) => message.includes("symmetric"))) {
    console.error("SELF-TEST FAIL: asymmetric supersession link was not rejected");
    failures += 1;
  }

  if (failures > 0) exit(1);
  console.log(`Evidence schema self-test passed (${cases.length + 1} cases).`);
}

function main() {
  if (argv.includes("--self-test")) {
    selfTest();
  }

  const index = loadIndex();
  const errors = validateIndex(index);

  const indexed = new Set();
  for (const entry of index.entries) {
    if (typeof entry?.path !== "string") continue;
    indexed.add(entry.path);

    if (!existsSync(entry.path)) {
      errors.push(`${entry.evidence_id}: path '${entry.path}' does not exist`);
      continue;
    }
    const actual = fileSha256(entry.path);
    if (actual !== entry.evidence_sha256) {
      errors.push(
        `${entry.evidence_id}: '${entry.path}' content changed — indexed ` +
          `${entry.evidence_sha256}, on disk ${actual}. Historical evidence is ` +
          `immutable; add a new superseding entry instead of editing in place.`,
      );
    }
  }

  // Coverage: every tracked evidence artifact must be classified.
  for (const file of trackedFiles()) {
    if (!/\.(json|md)$/.test(file)) continue;
    if (!EVIDENCE_GLOB_ROOTS.some((root) => file.startsWith(`${root}/`))) continue;
    if ([...EXCLUDED_FROM_COVERAGE].some((root) => file.startsWith(`${root}/`))) continue;
    if (!indexed.has(file)) {
      errors.push(
        `unclassified evidence artifact '${file}' — add it to ${EVIDENCE_INDEX_PATH} ` +
          `so readers can tell whether it is current or historical`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("Evidence metadata gate FAILED:");
    for (const message of errors) console.error(`  - ${message}`);
    exit(1);
  }

  const current = index.entries.filter((entry) => entry.current);
  console.log(
    `Evidence metadata gate passed: ${index.entries.length} classified artifacts, ` +
      `${current.length} current, ${index.entries.length - current.length} historical.`,
  );
}

main();
