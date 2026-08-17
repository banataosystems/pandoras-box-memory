#!/usr/bin/env node
// Keep committed capability evidence bound to the commit it claims to describe.
//
// Two defects have been found here in review, and both were fail-open — the
// gate reported success while the binding it exists to protect had rotted.
//
//   1. The original artifact recorded candidate_head = e7666300… long after the
//      lane was rebased and extended. The pull-request body had been refreshed;
//      the DURABLE evidence a future operator actually reads had not.
//
//   2. The first guard resolved the lane with `git rev-parse --abbrev-ref HEAD`.
//      CI checks out the exact PR SHA, which is a DETACHED HEAD, so that returns
//      the literal string "HEAD". The lane never matched, the lane-scoped checks
//      were skipped, and CI stayed green over a rotted binding.
//
// So lane resolution now fails CLOSED. If the lane cannot be established from a
// trustworthy source, and any artifact declares one, the gate errors instead of
// quietly skipping.
//
// Rules, per field:
//
//   candidate_head   must be HEAD itself, or a parent of HEAD. An artifact
//                    cannot contain the hash of the commit that introduces it,
//                    so naming its own parent is the closest honest binding.
//                    Enforced only for the artifact belonging to THIS lane;
//                    artifacts inherited from other lanes are bound on theirs.
//   candidate_tree   must be the actual tree of candidate_head. A 40-hex shape
//                    check alone lets a stale or fabricated tree through.
//   canonical_base   must be an ancestor of HEAD, and must equal the merge-base
//                    with the default branch when that branch is resolvable.
//   historical facts must name commits that exist. They record what happened in
//                    the past and are correct precisely because they do NOT move.

import { execFileSync } from "node:child_process";
import { argv, env, exit } from "node:process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

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

/**
 * Resolve the lane under test from a source that survives a detached checkout.
 *
 * Order matters: an explicit argument wins, then the CI-provided branch names,
 * then a symbolic ref. `git rev-parse --abbrev-ref HEAD` is deliberately LAST
 * and is rejected when it returns "HEAD", which is exactly what a detached
 * checkout yields.
 *
 * Returns null when the lane is genuinely unknown. Callers must fail closed.
 */
export function resolveLane({ argLane, githubHeadRef, githubRefName, githubRefType, symbolicRef }) {
  if (argLane) return argLane;
  // pull_request events: the head branch, populated even though HEAD is detached.
  if (githubHeadRef) return githubHeadRef;
  // push events: the branch that was pushed.
  if (githubRefName && githubRefType === "branch") return githubRefName;
  if (symbolicRef && symbolicRef !== "HEAD") return symbolicRef;
  return null;
}

export function validateArtifact(
  artifact,
  name,
  { isInHistory, exists, treeOf, head, headParents, mergeBase, branch },
) {
  const errors = [];
  const source = artifact?.source;
  if (!source || typeof source !== "object") return errors;

  const shaOf = (field) => {
    const value = source[field];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !SHA1_RE.test(value)) {
      errors.push(`${name}: ${field} is not a 40-hex id`);
      return null;
    }
    return value;
  };

  const declaresLane = typeof source.branch === "string";

  // Fail closed rather than skipping. An unknown lane used to silently disable
  // every lane-scoped check below.
  if (declaresLane && branch === null) {
    errors.push(
      `${name}: declares source.branch '${source.branch}' but the lane under ` +
        `test could not be resolved. CI checks out a detached HEAD, so pass ` +
        `--lane <branch>, or run where GITHUB_HEAD_REF / GITHUB_REF_NAME is set. ` +
        `Refusing to skip the binding checks.`,
    );
    return errors;
  }

  const ownsThisLane = !declaresLane || source.branch === branch;

  const candidateHead = shaOf("candidate_head");
  const candidateTree = shaOf("candidate_tree");

  if (ownsThisLane && candidateHead) {
    if (candidateHead !== head && !headParents.includes(candidateHead)) {
      errors.push(
        `${name}: candidate_head ${candidateHead.slice(0, 12)}… is not the current ` +
          `head ${head.slice(0, 12)}… (nor its parent). The lane was rebased or ` +
          `extended after this artifact was written. Refresh the durable evidence, ` +
          `not just the pull-request body.`,
      );
    }

    // Bind the tree to the commit. Shape alone proves nothing.
    if (candidateTree) {
      const actualTree = treeOf(candidateHead);
      if (actualTree === null) {
        errors.push(
          `${name}: candidate_head ${candidateHead.slice(0, 12)}… could not be ` +
            `resolved, so candidate_tree cannot be verified`,
        );
      } else if (actualTree !== candidateTree) {
        errors.push(
          `${name}: candidate_tree ${candidateTree.slice(0, 12)}… is not the tree ` +
            `of candidate_head ${candidateHead.slice(0, 12)}… (actual ` +
            `${actualTree.slice(0, 12)}…)`,
        );
      }
    }
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
  const HEAD = "1".repeat(40);
  const PARENT = "2".repeat(40);
  const BASE = "3".repeat(40);
  const OLD = "4".repeat(40); // still an ancestor, but obsolete
  const GONE = "5".repeat(40);
  const HEAD_TREE = "a".repeat(40);
  const OTHER_TREE = "b".repeat(40);

  const ancestors = new Set([HEAD, PARENT, BASE, OLD]);
  const real = new Set([...ancestors, "6".repeat(40)]);
  const trees = { [HEAD]: HEAD_TREE, [PARENT]: OTHER_TREE, [OLD]: OTHER_TREE };
  const ctx = {
    isInHistory: (sha) => ancestors.has(sha),
    exists: (sha) => real.has(sha),
    treeOf: (sha) => trees[sha] ?? null,
    head: HEAD,
    headParents: [PARENT],
    mergeBase: BASE,
    branch: "lane",
  };
  const detached = { ...ctx, branch: null };

  const cases = [
    ["candidate_head is HEAD", ctx, { source: { branch: "lane", candidate_head: HEAD, canonical_base: BASE } }, false],
    ["candidate_head is HEAD's parent", ctx, { source: { branch: "lane", candidate_head: PARENT } }, false],
    ["stale candidate_head still in history", ctx, { source: { branch: "lane", candidate_head: OLD } }, true],
    ["candidate_head no longer reachable", ctx, { source: { branch: "lane", candidate_head: GONE } }, true],
    ["canonical_base not the merge-base", ctx, { source: { branch: "lane", canonical_base: OLD } }, true],
    ["canonical_base off-history", ctx, { source: { branch: "lane", canonical_base: GONE } }, true],
    ["malformed commit id", ctx, { source: { branch: "lane", candidate_head: "nope" } }, true],
    ["malformed tree id", ctx, { source: { branch: "lane", candidate_tree: "nope" } }, true],
    ["no source block", ctx, {}, false],
    ["historical merge facts that still exist", ctx, { source: { merge_commit: "6".repeat(40), merge_parent: BASE } }, false],
    ["historical merge fact naming a non-commit", ctx, { source: { merge_commit: GONE } }, true],
    ["another lane's artifact is not forced to track this head", ctx, { source: { branch: "other", candidate_head: OLD, canonical_base: OLD } }, false],
    ["this lane's artifact is enforced", ctx, { source: { branch: "lane", candidate_head: OLD } }, true],

    // Regression: the tree must match the commit, not merely look like a tree.
    ["candidate_tree matches candidate_head", ctx, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: HEAD_TREE } }, false],
    ["candidate_tree does not match candidate_head", ctx, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: OTHER_TREE } }, true],

    // Regression: a detached checkout must not silently disable the checks.
    ["detached HEAD fails closed instead of skipping", detached, { source: { branch: "lane", candidate_head: OLD } }, true],
    ["detached HEAD fails closed even for a correct binding", detached, { source: { branch: "lane", candidate_head: HEAD } }, true],
    ["detached HEAD is fine for an artifact declaring no lane", detached, { source: { merge_commit: BASE } }, false],
  ];

  let failures = 0;
  for (const [label, context, artifact, shouldReject] of cases) {
    const rejected = validateArtifact(artifact, "sample", context).length > 0;
    if (rejected !== shouldReject) {
      console.error(
        `SELF-TEST FAIL: '${label}' expected ${shouldReject ? "rejection" : "acceptance"}`,
      );
      failures += 1;
    }
  }

  // Lane resolution must prefer CI-provided names over a detached symbolic ref.
  const laneCases = [
    ["explicit argument wins", { argLane: "explicit", githubHeadRef: "pr", symbolicRef: "HEAD" }, "explicit"],
    ["pull_request head ref", { githubHeadRef: "lane", symbolicRef: "HEAD" }, "lane"],
    ["push ref name", { githubRefName: "main", githubRefType: "branch", symbolicRef: "HEAD" }, "main"],
    ["tag ref is not a lane", { githubRefName: "v1", githubRefType: "tag", symbolicRef: "HEAD" }, null],
    ["symbolic ref when attached", { symbolicRef: "lane" }, "lane"],
    ["detached with nothing else is unknown", { symbolicRef: "HEAD" }, null],
    ["nothing at all is unknown", {}, null],
  ];
  for (const [label, input, expected] of laneCases) {
    if (resolveLane(input) !== expected) {
      console.error(`SELF-TEST FAIL: lane resolution '${label}'`);
      failures += 1;
    }
  }

  if (failures > 0) exit(1);
  console.log(
    `Capability evidence binding self-test passed ` +
      `(${cases.length + laneCases.length} cases).`,
  );
}

function arg(flag) {
  const index = argv.indexOf(flag);
  return index !== -1 && argv[index + 1] ? argv[index + 1] : null;
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
  const defaultBranch = ["origin/main", "main"].find(
    (ref) => git(["rev-parse", "--verify", `${ref}^{commit}`]) !== null,
  );
  const branch = resolveLane({
    argLane: arg("--lane"),
    githubHeadRef: env.GITHUB_HEAD_REF,
    githubRefName: env.GITHUB_REF_NAME,
    githubRefType: env.GITHUB_REF_TYPE,
    symbolicRef: git(["rev-parse", "--abbrev-ref", "HEAD"]),
  });

  const ctx = {
    isInHistory: (sha) => inHistoryOf(sha, "HEAD"),
    exists: (sha) => git(["cat-file", "-e", `${sha}^{commit}`]) !== null,
    treeOf: (sha) => git(["rev-parse", `${sha}^{tree}`]),
    head,
    headParents,
    mergeBase: defaultBranch ? git(["merge-base", "HEAD", defaultBranch]) : null,
    branch,
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
    `Capability evidence binding gate passed: ${checked} artifacts, lane ` +
      `'${branch ?? "(none declared)"}', every recorded commit and tree bound.`,
  );
}

main();
