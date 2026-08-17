#!/usr/bin/env node
// Keep committed capability evidence bound to real commits.
//
// The defect this exists to prevent, found in independent review:
//
//   HARDENING_GATEWAY_API_BOUNDARIES_2026-08-17.json recorded
//   candidate_head = e7666300…, candidate_tree = 91d634c7…,
//   canonical_base = d0e68955… long after the branch had been rebased and
//   extended. Those commits were no longer in the branch's history at all. The
//   PR body had been refreshed, but the DURABLE evidence — the artifact a
//   future operator actually reads — still pointed at commits that no longer
//   existed on the lane. Prose was current; the binding was fiction.
//
// "Is the recorded commit still in history?" is too weak a rule: after a merge,
// every commit the lane ever had is still an ancestor, so an obsolete
// candidate_head passes. The rules are therefore per field:
//
//   candidate_head   must be HEAD itself, or a parent of HEAD. An artifact
//                    cannot contain the hash of the commit that introduces it,
//                    so naming its own parent is the closest honest binding.
//                    Enforced only for the artifact belonging to THIS lane
//                    (source.branch matches the checked-out branch). Artifacts
//                    inherited from other lanes are bound on their own lane;
//                    forcing them to track this head would be wrong.
//   canonical_base   must be an ancestor of HEAD, and must equal the merge-base
//                    with the default branch when that branch is resolvable.
//   historical facts must name commits that actually exist. These record what
//                    happened in the past (e.g. where a prior PR merged) and are
//                    correct precisely because they do NOT move.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { argv, exit } from "node:process";

const EVIDENCE_DIR = "docs/capabilities/evidence";
const SHA1_RE = /^[0-9a-f]{40}$/;

/**
 * Historical commit facts. They describe a past event, so they must exist but
 * must NOT track the current head — rewriting them would falsify history.
 */
const HISTORICAL_COMMIT_FIELDS = [
  "merge_commit",
  "merge_parent",
  "final_pull_request_head",
];

/** Tree-id fields, checked for shape only — trees are not reachable by rev-list. */
const TREE_FIELDS = ["candidate_tree", "merge_tree"];

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** True when `commit` is an ancestor of (or equal to) `descendant`. */
function inHistoryOf(commit, descendant) {
  if (git(["cat-file", "-e", `${commit}^{commit}`]) === null) return false;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, descendant], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function validateArtifact(
  artifact,
  name,
  { isInHistory, exists, head, headParents, mergeBase, branch },
) {
  const errors = [];
  const source = artifact?.source;
  if (!source || typeof source !== "object") return errors;

  const shaOf = (field) => {
    const value = source[field];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !SHA1_RE.test(value)) {
      errors.push(`${name}: ${field} is not a 40-hex commit id`);
      return null;
    }
    return value;
  };

  for (const field of TREE_FIELDS) {
    const value = source[field];
    if (value !== undefined && (typeof value !== "string" || !SHA1_RE.test(value))) {
      errors.push(`${name}: ${field} is not a 40-hex tree id`);
    }
  }

  // Only the artifact for the lane under test is required to track this head.
  const ownsThisLane =
    typeof source.branch !== "string" || branch === null || source.branch === branch;

  // candidate_head must be the CURRENT candidate, not merely a commit that was
  // once on this lane. This is the check that catches an artifact left behind
  // by a rebase or by further commits.
  const candidateHead = shaOf("candidate_head");
  if (
    ownsThisLane &&
    candidateHead &&
    candidateHead !== head &&
    !headParents.includes(candidateHead)
  ) {
    errors.push(
      `${name}: candidate_head ${candidateHead.slice(0, 12)}… is not the current ` +
        `head ${head.slice(0, 12)}… (nor its parent). The lane was rebased or ` +
        `extended after this artifact was written. Refresh the durable evidence, ` +
        `not just the pull-request body.`,
    );
  }

  const canonicalBase = shaOf("canonical_base");
  if (canonicalBase && ownsThisLane) {
    if (!isInHistory(canonicalBase)) {
      errors.push(
        `${name}: canonical_base ${canonicalBase.slice(0, 12)}… is not in the ` +
          `history of HEAD`,
      );
    } else if (mergeBase && canonicalBase !== mergeBase) {
      errors.push(
        `${name}: canonical_base ${canonicalBase.slice(0, 12)}… is not the ` +
          `merge-base with the default branch (${mergeBase.slice(0, 12)}…)`,
      );
    }
  }

  for (const field of HISTORICAL_COMMIT_FIELDS) {
    const value = shaOf(field);
    if (value && !exists(value)) {
      errors.push(`${name}: ${field} ${value.slice(0, 12)}… is not a real commit`);
    }
  }

  return errors;
}

function selfTest() {
  const HEAD = "h".repeat(40).replace(/h/g, "1");
  const PARENT = "2".repeat(40);
  const BASE = "3".repeat(40);
  const OLD = "4".repeat(40); // once on the lane, still an ancestor, now obsolete
  const GONE = "5".repeat(40);

  const ancestors = new Set([HEAD, PARENT, BASE, OLD]);
  const real = new Set([...ancestors, "6".repeat(40)]);
  const ctx = {
    isInHistory: (sha) => ancestors.has(sha),
    exists: (sha) => real.has(sha),
    head: HEAD,
    headParents: [PARENT],
    mergeBase: BASE,
    branch: "lane",
  };

  const cases = [
    ["candidate_head is HEAD", { source: { candidate_head: HEAD, canonical_base: BASE } }, false],
    ["candidate_head is HEAD's parent", { source: { candidate_head: PARENT } }, false],
    // The exact defect: an older lane commit that is still an ancestor.
    ["stale candidate_head still in history", { source: { candidate_head: OLD } }, true],
    ["candidate_head no longer reachable", { source: { candidate_head: GONE } }, true],
    ["canonical_base not the merge-base", { source: { canonical_base: OLD } }, true],
    ["canonical_base off-history", { source: { canonical_base: GONE } }, true],
    ["malformed commit id", { source: { candidate_head: "nope" } }, true],
    ["malformed tree id", { source: { candidate_tree: "nope" } }, true],
    ["no source block", {}, false],
    ["historical merge facts that still exist", { source: { merge_commit: "6".repeat(40), merge_parent: BASE } }, false],
    ["historical merge fact naming a non-commit", { source: { merge_commit: GONE } }, true],
    // An artifact from another lane is bound on that lane, not this one.
    ["another lane's artifact is not forced to track this head", { source: { branch: "other-lane", candidate_head: OLD, canonical_base: OLD } }, false],
    ["this lane's artifact is still enforced", { source: { branch: "lane", candidate_head: OLD } }, true],
  ];

  let failures = 0;
  for (const [label, artifact, shouldReject] of cases) {
    const rejected = validateArtifact(artifact, "sample", ctx).length > 0;
    if (rejected !== shouldReject) {
      console.error(
        `SELF-TEST FAIL: '${label}' expected ${shouldReject ? "rejection" : "acceptance"}`,
      );
      failures += 1;
    }
  }
  if (failures > 0) exit(1);
  console.log(`Capability evidence binding self-test passed (${cases.length} cases).`);
}

function main() {
  if (argv.includes("--self-test")) selfTest();
  if (!existsSync(EVIDENCE_DIR)) {
    console.log(`No ${EVIDENCE_DIR}; nothing to bind.`);
    return;
  }

  const head = git(["rev-parse", "HEAD"]);
  const headParents = (git(["rev-list", "--parents", "-n", "1", "HEAD"]) ?? "")
    .split(/\s+/)
    .slice(1);
  // Resolve the default branch if it is present; in a shallow or detached
  // checkout it may not be, in which case the merge-base equality check is
  // skipped rather than guessed at.
  const defaultBranch = ["origin/main", "main"].find(
    (ref) => git(["rev-parse", "--verify", `${ref}^{commit}`]) !== null,
  );
  const mergeBase = defaultBranch ? git(["merge-base", "HEAD", defaultBranch]) : null;

  const ctx = {
    isInHistory: (sha) => inHistoryOf(sha, "HEAD"),
    exists: (sha) => git(["cat-file", "-e", `${sha}^{commit}`]) !== null,
    head,
    headParents,
    mergeBase,
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
  };

  const errors = [];
  let checked = 0;
  for (const file of readdirSync(EVIDENCE_DIR).filter((n) => n.endsWith(".json"))) {
    const path = `${EVIDENCE_DIR}/${file}`;
    let artifact;
    try {
      artifact = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      errors.push(`${path}: not valid JSON (${error.message})`);
      continue;
    }
    checked += 1;
    errors.push(...validateArtifact(artifact, path, ctx));
  }

  if (errors.length > 0) {
    console.error("Capability evidence binding gate FAILED:");
    for (const message of errors) console.error(`  - ${message}`);
    exit(1);
  }

  console.log(
    `Capability evidence binding gate passed: ${checked} artifacts, every recorded ` +
      `commit is in the history of HEAD.`,
  );
}

main();
