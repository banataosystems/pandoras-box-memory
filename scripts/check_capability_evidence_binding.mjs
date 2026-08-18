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
// A fourth and fifth defect were found in review, both in this guard:
//
//   4. Absent binding fields were treated as acceptable, so an artifact could
//      evade validation by DELETING candidate_head, candidate_tree, or
//      canonical_base rather than keeping them correct.
//   5. Ownership was decided by the artifact's own `source.branch`. That field
//      is part of the artifact, so a changed artifact could exempt itself simply
//      by claiming to belong to another lane. A self-test had even encoded that
//      bypass as expected behavior.
//
// The fix is not to trust `source.branch`, nor to ignore it, but to RESOLVE it
// against git: an artifact that names a lane must bind to that lane's real head
// (or its parent), and the named lane must actually exist. Naming a different
// lane is therefore no longer an escape — the named lane's head will not match a
// stale value, and a fabricated lane name does not resolve at all. Binding
// fields are MANDATORY for any artifact that names a lane or was changed here,
// so deleting a field is not a way to pass either.
//
// A SIXTH defect was then demonstrated in review, and it was the residue of
// that same fix:
//
//   6. Resolving the declared lane made a FABRICATED lane useless, and made a
//      STALE value useless, but it still let the artifact pick WHICH lane it
//      would be graded against. Since the repository deliberately retains a
//      `recovery/review-*` branch at every superseded head, a changed artifact
//      could name one of those, bind to it perfectly — head, tree and base all
//      internally consistent — and pass, while the candidate it was actually
//      shipping with was never checked. Every field was honest about a question
//      nobody had asked.
//
// So redirection is no longer something an artifact may assert. It is a fact
// git has to confirm: an artifact may answer to a lane other than the one under
// test ONLY if its bytes here are identical to that lane's copy, which proves
// this lane inherited it rather than wrote it. Genuine cross-lane integration
// still works — a stacked lane carries its base lane's evidence in unchanged —
// but the moment this lane edits the file, the identity that licensed the
// redirect is gone and the artifact must answer to this candidate.
//
// Deliberately NOT a blocklist of `recovery/` or of any branch name: filtering
// names would leave the trust boundary exactly where it was, and the next
// retained branch would reopen the hole.
//
// This also handles a lane that integrates another: an artifact merged in from
// a different lane still binds correctly, because it is checked against the head
// of the lane it belongs to rather than the head of the lane under test.
//
// Rules, per field:
//
//   candidate_head   must be HEAD itself, or a parent of HEAD. An artifact
//                    cannot contain the hash of the commit that introduces it,
//                    so naming its own parent is the closest honest binding.
//                    Enforced for every artifact this lane wrote. An artifact
//                    inherited from another lane is bound on that lane instead,
//                    but only once git confirms it arrived here unchanged.
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
// Commits that ARE reachable in a full checkout. Once a pull request lands,
// both of these are on the default branch, so a value that does not resolve is
// either fabricated or names a different repository. Hard failure.
const REACHABLE_COMMIT_FIELDS = [
  "merge_commit",
  "merge_parent",
];

// A merged pull request's BRANCH head is a different case. GitHub retains it
// under refs/pull/<n>/head, but once the branch is deleted it is reachable from
// no branch at all — so `actions/checkout`, even at fetch-depth: 0, does not
// have the object. Requiring it to resolve does not make the gate stricter, it
// makes the gate unpassable: docs/capabilities/evidence/
// MEMORY_EVIDENCE_INTAKE_SOURCE_2026-08-17.json is already on main recording
// final_pull_request_head ab70b345… from PR #27, whose branch is gone.
//
// So the shape is enforced unconditionally, and the object is still verified
// whenever it IS present. A fabricated value is therefore caught in every
// checkout that could possibly have caught it, and an absent one is reported as
// unresolvable-here rather than silently accepted or falsely called fake.
// The historical exception below is NARROW BY CONSTRUCTION. Tolerating an
// absent object is only defensible for evidence that is already part of
// canonical history and is untouched by the lane under test. Anything the lane
// authored or edited must resolve, or a new artifact could simply invent a
// SHA-shaped value and rely on the object being missing to escape checking.
const PROVENANCE_COMMIT_FIELDS = ["final_pull_request_head"];

function git(args) {
  try {
    // stderr is silenced deliberately: probing whether a ref resolves is a
    // normal control-flow question here, and git's "Needed a single revision"
    // noise would otherwise be mistaken for a real failure in CI logs.
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
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

/** Binding fields an artifact owned by this lane must carry. */
const REQUIRED_BINDING_FIELDS = [
  "candidate_head",
  "candidate_tree",
  "canonical_base",
];

export function validateArtifact(
  artifact,
  name,
  {
    isInHistory,
    exists,
    treeOf,
    headOf,
    parentsOf,
    blobAt,
    head,
    headParents,
    mergeBase,
    branch,
    owned,
    notes,
  },
) {
  const errors = [];
  // Facts worth printing that are not failures. Defaults to a throwaway array
  // so callers that do not care (the self-test) need not supply one.
  const unresolved = notes ?? [];
  const source = artifact?.source;

  // An owned artifact with no source block at all is the simplest evasion.
  if (!source || typeof source !== "object") {
    if (owned) {
      errors.push(
        `${name}: changed on this lane but carries no 'source' block. An evidence ` +
          `artifact modified here must bind to this candidate.`,
      );
    }
    return errors;
  }

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
  // An artifact must bind if it names a lane, or if this lane changed it.
  const mustBind = declaresLane || owned;

  // Resolve the head this artifact is accountable to.
  //
  // TRUST BOUNDARY. `source.branch` is artifact-controlled data, so on its own
  // it may never redirect validation away from the candidate under test. Review
  // demonstrated the escape it used to allow: an artifact edited on this lane
  // declared a RETAINED RECOVERY BRANCH pointing at a superseded head, bound
  // itself correctly to that branch, and passed — while the candidate it was
  // actually shipping with went unchecked. Every binding field was present and
  // internally consistent; the artifact had simply chosen a friendlier question
  // to answer.
  //
  // Answering to another lane is therefore no longer a claim but a fact git has
  // to confirm: the artifact's bytes here must be IDENTICAL to that lane's copy,
  // which proves this lane inherited it rather than authored or edited it. That
  // keeps real cross-lane integration working — a stacked lane carries its base
  // lane's evidence in unchanged — while making the redirect worthless to
  // anything this lane actually wrote, because writing to it breaks the
  // identity that licensed the redirect in the first place.
  //
  // Note this is deliberately NOT a blocklist of `recovery/` or of any branch
  // name. Name-based filtering would leave the design untouched and the next
  // retained branch would reopen it.
  let targetHead = head;
  let targetParents = headParents;
  let targetLabel = branch ?? "this lane";

  const redirects = declaresLane && (branch === null || source.branch !== branch);

  // Set when the declared lane is gone and identity has to come from the commit
  // graph instead of from a ref. See the deleted-lane block further down.
  let historicalProvenance = false;

  if (redirects) {
    const resolved = headOf(source.branch);

    if (resolved === null) {
      // The lane does not resolve. That is either a lane that was DELETED after
      // it merged — normal housekeeping, and it must not retroactively falsify
      // immutable history — or a name this lane invented. Ownership separates
      // them, because only one of those two can have been chosen here.
      if (owned) {
        errors.push(
          `${name}: declares source.branch '${source.branch}', which does not ` +
            `resolve, and this artifact was changed on this lane. A missing lane ` +
            `is not an escape from binding: evidence authored or edited here must ` +
            `name the lane under test and bind to the current candidate.`,
        );
        return errors;
      }
      // Untouched here, so the branch name is no longer needed to establish what
      // this artifact describes. Prove it from history instead, below.
      historicalProvenance = true;
    } else {
    const here = blobAt("HEAD", name);
    const there = blobAt(resolved, name);
    if (here === null || there === null || here !== there) {
      errors.push(
        `${name}: declares source.branch '${source.branch}', which is not the ` +
          `lane under test ('${branch ?? "unresolved"}'), and its content here is ` +
          `not identical to that lane's copy. Evidence may answer to another lane ` +
          `only when this lane inherited it unchanged. An artifact does not get ` +
          `to select the candidate it is validated against.`,
      );
      return errors;
    }

    targetHead = resolved;
    targetParents = parentsOf(resolved);
    targetLabel = source.branch;
    }
  } else if (owned && branch === null) {
    errors.push(
      `${name}: changed on this lane, but the lane under test could not be ` +
        `resolved. CI checks out a detached HEAD, so pass --lane <branch>, or ` +
        `run where GITHUB_HEAD_REF / GITHUB_REF_NAME is set. Refusing to skip ` +
        `the binding checks.`,
    );
    return errors;
  }

  if (owned && !declaresLane) {
    // Omitting the lane is not a way to sidestep the check above.
    errors.push(
      `${name}: changed on this lane but omits 'source.branch'. Evidence ` +
        `authored or edited here must name the lane it belongs to.`,
    );
  }

  if (mustBind) {
    // Mandatory, so deleting a field is not a way to pass.
    for (const field of REQUIRED_BINDING_FIELDS) {
      if (source[field] === undefined) {
        errors.push(
          `${name}: omits '${field}'. Binding fields are mandatory for an ` +
            `artifact bound to a lane; removing one is not a way to pass.`,
        );
      }
    }
  }

  const ownsThisLane = mustBind;

  const candidateHead = shaOf("candidate_head");
  const candidateTree = shaOf("candidate_tree");

  if (historicalProvenance) {
    // The lane that produced this artifact has been deleted. A branch is only a
    // moving label; the commit graph outlives it, so identity is re-established
    // from history rather than from the vanished ref:
    //
    //   - candidate_head must still be a real commit, and
    //   - it must be an ANCESTOR of HEAD — genuinely part of this repository's
    //     canonical history rather than an invented or foreign value, which is
    //     what a deleted-but-merged lane always satisfies and a fabrication
    //     cannot, and
    //   - candidate_tree must be that commit's real tree, checked by the
    //     ordinary binding below. Pinning the tree pins every blob under it, so
    //     the artifact's own content at that commit is fixed too.
    //
    // Note what is deliberately NOT required: that the file be byte-identical
    // here and at candidate_head. By this repository's own convention an
    // artifact names its PARENT (it cannot contain its own hash), and the commit
    // that carries it is precisely the one that rewrote it — so equality there
    // is false for every correctly-formed artifact and would reject all honest
    // history while admitting nothing.
    //
    // This path is strictly narrower than the resolved-lane one: `owned` was
    // rejected above, so a deleted branch can never launder current or edited
    // evidence out of its binding to this candidate.
    if (!candidateHead) {
      errors.push(
        `${name}: declares source.branch '${source.branch}', which no longer ` +
          `resolves, and names no usable candidate_head. A deleted lane is ` +
          `trustworthy only while the commit it named is still provable.`,
      );
      return errors;
    }
    if (!exists(candidateHead)) {
      errors.push(
        `${name}: declares the deleted lane '${source.branch}' and names ` +
          `candidate_head ${candidateHead.slice(0, 12)}…, which is not a commit in ` +
          `this repository. Deleting a branch does not excuse unverifiable ` +
          `provenance.`,
      );
      return errors;
    }
    if (!isInHistory(candidateHead)) {
      errors.push(
        `${name}: declares the deleted lane '${source.branch}' and names ` +
          `candidate_head ${candidateHead.slice(0, 12)}…, which is not in the ` +
          `history of HEAD. A vanished branch is forgiven only for work this ` +
          `history actually contains, never for a commit reachable from ` +
          `somewhere else.`,
      );
      return errors;
    }

    targetHead = candidateHead;
    targetParents = parentsOf(candidateHead);
    targetLabel = `${source.branch} (deleted lane, proven from history)`;
    unresolved.push(
      `${name}: lane '${source.branch}' no longer exists; provenance re-proven ` +
        `from git history — candidate_head ${candidateHead.slice(0, 12)}… is a real ` +
        `commit in the history of HEAD, and candidate_tree binds its tree`,
    );
  }

  if (ownsThisLane && candidateHead) {
    if (candidateHead !== targetHead && !targetParents.includes(candidateHead)) {
      errors.push(
        `${name}: candidate_head ${candidateHead.slice(0, 12)}… is not the head of ` +
          `'${targetLabel}' (${targetHead.slice(0, 12)}…) nor its parent. That lane ` +
          `was rebased or extended after this artifact was written. Refresh the ` +
          `durable evidence, not just the pull-request body.`,
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
    } else if (!historicalProvenance && mergeBase && canonicalBase !== mergeBase) {
      errors.push(
        `${name}: canonical_base ${canonicalBase.slice(0, 12)}… is not the ` +
          `merge-base with the default branch (${mergeBase.slice(0, 12)}…)`,
      );
    }
  }

  for (const field of REACHABLE_COMMIT_FIELDS) {
    const value = shaOf(field);
    if (value && !exists(value)) {
      errors.push(`${name}: ${field} ${value.slice(0, 12)}… is not a real commit`);
    }
  }

  for (const field of PROVENANCE_COMMIT_FIELDS) {
    // shaOf already records a shape violation, which stays a hard failure.
    const value = shaOf(field);
    if (!value) continue;
    if (exists(value)) continue;

    // The object is absent. Decide whether that is the legitimate
    // deleted-branch case or an attempt to cite something unverifiable.
    //
    // The exception requires ALL of:
    //   1. the artifact is NOT changed on this lane — this lane neither
    //      authored nor edited it, so it cannot have chosen the value;
    //   2. the artifact explicitly classifies itself as already-merged
    //      history (lifecycle.merged === true), which is the only state in
    //      which a pull-request branch is expected to be gone;
    //   3. no current-candidate binding rests on the same unresolvable sha.
    //
    // Any other shape fails closed.
    const isMergedHistory = artifact?.lifecycle?.merged === true;
    const citedAsCurrentProof =
      value === candidateHead || value === canonicalBase;

    if (owned) {
      errors.push(
        `${name}: ${field} ${value.slice(0, 12)}… does not resolve, and this ` +
          `artifact was changed on this lane. Evidence authored or edited here ` +
          `must cite a commit this checkout can verify — the deleted-branch ` +
          `exception covers untouched history only, never a value this lane ` +
          `chose.`,
      );
    } else if (!isMergedHistory) {
      errors.push(
        `${name}: ${field} ${value.slice(0, 12)}… does not resolve, and this ` +
          `artifact does not classify itself as merged history ` +
          `(lifecycle.merged is not true). Only evidence already landed on ` +
          `canonical history may have a deleted pull-request branch.`,
      );
    } else if (citedAsCurrentProof) {
      errors.push(
        `${name}: ${field} ${value.slice(0, 12)}… does not resolve and is also ` +
          `cited as candidate_head or canonical_base. A current-candidate ` +
          `binding may never rest on an object this checkout cannot verify.`,
      );
    } else {
      unresolved.push(
        `${name}: ${field} ${value.slice(0, 12)}… is not present in this ` +
          `checkout (merged history whose pull-request branch was deleted, ` +
          `reachable from no branch); shape verified, artifact unchanged here, ` +
          `no current-candidate binding depends on it`,
      );
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

  const OTHER_HEAD = "7".repeat(40);
  const OTHER_PARENT = "8".repeat(40);
  // A superseded candidate, still reachable because its recovery ref is retained.
  const SUPERSEDED = "9".repeat(40);
  const SUPERSEDED_TREE = "c".repeat(40);
  // A commit from a lane that has since been deleted: the ref is gone, the
  // object is not.
  const HIST = "d".repeat(40);
  const HIST_TREE = "e".repeat(40);
  // A commit reachable from somewhere else entirely: real, but not ours.
  const FOREIGN = "6".repeat(40);
  const ancestors = new Set([HEAD, PARENT, BASE, OLD, HIST]);
  const real = new Set([...ancestors, FOREIGN]);
  const trees = {
    [HEAD]: HEAD_TREE,
    [PARENT]: OTHER_TREE,
    [OLD]: OTHER_TREE,
    [OTHER_HEAD]: HEAD_TREE,
    [OTHER_PARENT]: HEAD_TREE,
    [SUPERSEDED]: SUPERSEDED_TREE,
    [HIST]: HIST_TREE,
    [FOREIGN]: HIST_TREE,
  };

  // Content identity per path, per revision. Equal ids mean equal bytes, which
  // is how the guard tells "inherited from that lane unchanged" apart from
  // "written here and pointed at that lane".
  const BLOBS = {
    // Arrived from lane 'other' untouched.
    "inherited.json": { HEAD: "blob-i", [OTHER_HEAD]: "blob-i", [OTHER_PARENT]: "blob-i" },
    // Written or edited on THIS lane; every other lane holds a different copy.
    "edited.json": {
      HEAD: "blob-e-here",
      [OTHER_HEAD]: "blob-e-there",
      [OTHER_PARENT]: "blob-e-there",
      [SUPERSEDED]: "blob-e-superseded",
    },
    // Merged long ago on a lane that has since been deleted, and untouched here.
    // Deliberately DIFFERENT at HEAD and at HIST: an artifact names its parent,
    // and the commit carrying it is the one that rewrote it, so this is what a
    // correctly-formed historical artifact actually looks like.
    "historical.json": { HEAD: "blob-h-now", [HIST]: "blob-h-then" },
    // Default fixture for cases that never redirect.
    sample: {
      HEAD: "blob-s",
      [HEAD]: "blob-s",
      [OTHER_HEAD]: "blob-s",
      [OTHER_PARENT]: "blob-s",
    },
  };
  const ctx = {
    isInHistory: (sha) => ancestors.has(sha),
    exists: (sha) => real.has(sha),
    treeOf: (sha) => trees[sha] ?? null,
    headOf: (lane) =>
      lane === "lane"
        ? HEAD
        : lane === "other"
        ? OTHER_HEAD
        : lane === "recovery/review-20260818/pr-x-abcdef12" ||
            lane === "superseded/candidate-lane"
        ? SUPERSEDED
        : null,
    parentsOf: (sha) => (sha === HEAD ? [PARENT] : sha === OTHER_HEAD ? [OTHER_PARENT] : []),
    blobAt: (rev, path) => BLOBS[path]?.[rev] ?? null,
    head: HEAD,
    headParents: [PARENT],
    mergeBase: BASE,
    branch: "lane",
    owned: true,
  };
  const inherited = { ...ctx, owned: false };
  const detached = { ...ctx, branch: null };

  const cases = [
    ["candidate_head is HEAD", ctx, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE } }, false],
    ["candidate_head is HEAD's parent", ctx, { source: { branch: "lane", candidate_head: PARENT, candidate_tree: OTHER_TREE, canonical_base: BASE } }, false],
    ["stale candidate_head still in history", ctx, { source: { branch: "lane", candidate_head: OLD, candidate_tree: OTHER_TREE, canonical_base: BASE } }, true],
    ["candidate_head no longer reachable", ctx, { source: { branch: "lane", candidate_head: GONE, candidate_tree: OTHER_TREE, canonical_base: BASE } }, true],
    ["canonical_base not the merge-base", ctx, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: OLD } }, true],
    ["canonical_base off-history", ctx, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: GONE } }, true],
    ["malformed commit id", ctx, { source: { branch: "lane", candidate_head: "nope", candidate_tree: HEAD_TREE, canonical_base: BASE } }, true],
    ["malformed tree id", ctx, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: "nope", canonical_base: BASE } }, true],
    ["owned artifact with no source block", ctx, {}, true],
    ["inherited artifact with no source block", inherited, {}, false],
    ["historical merge facts that still exist", inherited, { source: { merge_commit: FOREIGN, merge_parent: BASE } }, false],
    ["historical merge fact naming a non-commit", inherited, { source: { merge_commit: GONE } }, true],
    ["merge_parent naming a non-commit", inherited, { source: { merge_parent: GONE } }, true],

    // ------------------------------------------------------------------
    // final_pull_request_head: the deleted-branch exception, and its limits.
    //
    // A merged pull request's branch head is reachable from no branch once the
    // branch is deleted, so no checkout can resolve it. Tolerating that is only
    // safe for evidence this lane did not touch and that says it is already
    // merged. Everything else must fail closed, or a new artifact could invent
    // a SHA-shaped value and rely on the object being missing.
    // ------------------------------------------------------------------

    // C: unchanged, already-merged history whose ref disappeared. The ONLY
    // accepted shape — and it is accepted as historical provenance, never as
    // current-candidate proof.
    ["C: unchanged merged history whose PR branch was deleted", inherited, { lifecycle: { merged: true }, source: { final_pull_request_head: GONE } }, false],

    // A: an artifact CHANGED on this lane citing a sha that is not in the
    // repository. The lane chose the value, so it must resolve.
    ["A: changed artifact citing a random 40-hex sha not in the repository", ctx, { lifecycle: { merged: true }, source: { branch: "lane", candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE, final_pull_request_head: GONE } }, true],

    // B: a NEW artifact (owned by this lane) whose PR-head object does not
    // exist. Same reasoning as A.
    ["B: new artifact citing a nonexistent PR-head object", ctx, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE, final_pull_request_head: GONE } }, true],

    // D: historical artifact MODIFIED in this PR while keeping the missing
    // head. Editing it forfeits the exception.
    ["D: historical artifact modified here while retaining a missing head", ctx, { lifecycle: { merged: true }, source: { branch: "lane", candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE, final_pull_request_head: GONE } }, true],

    // E: an unresolvable sha may not double as current-candidate proof.
    ["E: unresolvable head also cited as candidate_head", inherited, { lifecycle: { merged: true }, source: { branch: "other", candidate_head: GONE, candidate_tree: HEAD_TREE, canonical_base: BASE, final_pull_request_head: GONE } }, true],
    ["E2: unresolvable head also cited as canonical_base", inherited, { lifecycle: { merged: true }, source: { canonical_base: GONE, final_pull_request_head: GONE } }, true],

    // An unchanged artifact that does NOT declare merged history cannot claim
    // the exception either — an unmerged lane's branch should still exist.
    ["unchanged artifact with a missing head but no merged classification", inherited, { source: { final_pull_request_head: GONE } }, true],

    // Resolvable and malformed values are unaffected by any of the above.
    ["final_pull_request_head that does resolve", inherited, { source: { final_pull_request_head: BASE } }, false],
    ["final_pull_request_head with a malformed sha", inherited, { source: { final_pull_request_head: "nope" } }, true],

    // Ownership comes from the lane diff. An UNCHANGED artifact from another
    // lane is legitimately not bound here.
    // An artifact naming another lane answers to THAT lane's head, so a merged-in
    // artifact stays valid without being forced onto this lane's head.
    ["artifact bound to another real lane's head", inherited, { source: { branch: "other", candidate_head: OTHER_HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE } }, false],
    ["artifact bound to another lane's parent", inherited, { source: { branch: "other", candidate_head: OTHER_PARENT, candidate_tree: HEAD_TREE, canonical_base: BASE } }, false],

    // The bypass: naming another lane no longer exempts anything, because the
    // named lane's real head will not match a stale value. An earlier self-test
    // wrongly encoded this bypass as acceptable.
    ["changed artifact cannot exempt itself via source.branch", ctx, { source: { branch: "other", candidate_head: OLD, candidate_tree: OTHER_TREE, canonical_base: BASE } }, true],
    ["a fabricated lane name does not resolve", ctx, { source: { branch: "invented", candidate_head: OLD, candidate_tree: OTHER_TREE, canonical_base: BASE } }, true],
    ["an artifact naming a lane must still carry binding fields", inherited, { source: { branch: "other" } }, true],
    ["this lane's artifact is enforced", ctx, { source: { branch: "lane", candidate_head: OLD, candidate_tree: OTHER_TREE, canonical_base: BASE } }, true],

    // Deleting a binding field must not be a way to pass.
    ["changed artifact omitting candidate_head", ctx, { source: { branch: "lane", candidate_tree: HEAD_TREE, canonical_base: BASE } }, true],
    ["changed artifact omitting candidate_tree", ctx, { source: { branch: "lane", candidate_head: HEAD, canonical_base: BASE } }, true],
    ["changed artifact omitting canonical_base", ctx, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: HEAD_TREE } }, true],
    ["changed artifact omitting every binding field", ctx, { source: { note: "none" } }, true],

    // Regression: the tree must match the commit, not merely look like a tree.
    ["candidate_tree matches candidate_head", ctx, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE } }, false],
    ["candidate_tree does not match candidate_head", ctx, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: OTHER_TREE, canonical_base: BASE } }, true],

    // Regression: a detached checkout must not silently disable the checks.
    // Detached HEAD no longer disables anything for an artifact that names its
    // lane: the name resolves against git independently of the checkout.
    ["detached HEAD still rejects a stale binding", detached, { source: { branch: "lane", candidate_head: OLD, candidate_tree: OTHER_TREE, canonical_base: BASE } }, true],
    ["detached HEAD accepts a correct named-lane binding", detached, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE } }, false],
    // But an artifact changed here that names NO lane still has nothing to
    // resolve against, so it must fail closed rather than be skipped.
    ["detached HEAD fails closed for a changed artifact naming no lane", detached, { source: { candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE } }, true],
    ["detached HEAD is fine for an artifact not changed here", { ...detached, owned: false }, { source: { merge_commit: BASE } }, false],

    // ------------------------------------------------------------------
    // Lane-redirection matrix.
    //
    // Review demonstrated that a changed artifact could answer to a RETAINED
    // RECOVERY BRANCH on a superseded head and pass with every field
    // internally consistent. `source.branch` is artifact-controlled, so it
    // chose the question it would be graded on. Redirecting now requires the
    // artifact's bytes here to match that lane's copy, which an artifact this
    // lane wrote cannot arrange. Case 11 is the exploit itself.
    // ------------------------------------------------------------------

    // 1. Changed artifact naming the lane actually under test.
    ["1: changed artifact + correct current lane", ctx, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE } }, false, "edited.json"],

    // 2-4. Redirects to a real, resolvable branch that is not this lane.
    ["2: changed artifact + another existing live branch", ctx, { source: { branch: "other", candidate_head: OTHER_HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE } }, true, "edited.json"],
    ["3: changed artifact + retained recovery branch", ctx, { source: { branch: "recovery/review-20260818/pr-x-abcdef12", candidate_head: SUPERSEDED, candidate_tree: SUPERSEDED_TREE, canonical_base: BASE } }, true, "edited.json"],
    ["4: changed artifact + superseded candidate branch", ctx, { source: { branch: "superseded/candidate-lane", candidate_head: SUPERSEDED, candidate_tree: SUPERSEDED_TREE, canonical_base: BASE } }, true, "edited.json"],

    // 5-7. A lane that cannot be resolved, or is not named at all.
    ["5: changed artifact + invented branch", ctx, { source: { branch: "no-such-lane", candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE } }, true, "edited.json"],
    ["6: changed artifact + empty branch", ctx, { source: { branch: "", candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE } }, true, "edited.json"],
    ["7: changed artifact + missing branch", ctx, { source: { candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE } }, true, "edited.json"],

    // 8-10. Exact-head/tree/base binding is not weakened by any of the above.
    ["8: changed artifact + wrong candidate head", ctx, { source: { branch: "lane", candidate_head: OLD, candidate_tree: OTHER_TREE, canonical_base: BASE } }, true, "edited.json"],
    ["9: changed artifact + wrong candidate tree", ctx, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: OTHER_TREE, canonical_base: BASE } }, true, "edited.json"],
    ["10: changed artifact + wrong canonical base", ctx, { source: { branch: "lane", candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: OLD } }, true, "edited.json"],

    // 11. THE EXPLOIT. Before the fix this was ACCEPTED: a changed artifact
    // redirected onto a retained recovery branch and bound to it flawlessly,
    // leaving the real candidate unverified.
    ["11: changed artifact self-selecting another lane with otherwise-correct binding", ctx, { source: { branch: "recovery/review-20260818/pr-x-abcdef12", candidate_head: SUPERSEDED, candidate_tree: SUPERSEDED_TREE, canonical_base: BASE } }, true, "edited.json"],

    // 12. Genuine cross-lane integration still works: inherited byte-for-byte
    // from lane 'other', so it answers to that lane rather than to this head.
    ["12: unchanged historical artifact inherited from another lane", inherited, { source: { branch: "other", candidate_head: OTHER_HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE } }, false, "inherited.json"],
    ["12b: artifact inherited unchanged even though this lane also changed files", { ...ctx, owned: false }, { source: { branch: "other", candidate_head: OTHER_PARENT, candidate_tree: HEAD_TREE, canonical_base: BASE } }, false, "inherited.json"],

    // 13. The deleted-branch exception stays narrow and stays out of reach of
    // anything this lane wrote.
    ["13: deleted historical branch exception still valid for untouched merged history", inherited, { lifecycle: { merged: true }, source: { final_pull_request_head: GONE } }, false],
    ["13b: deleted-branch exception unusable by a changed artifact", ctx, { lifecycle: { merged: true }, source: { branch: "lane", candidate_head: HEAD, candidate_tree: HEAD_TREE, canonical_base: BASE, final_pull_request_head: GONE } }, true, "edited.json"],

    // ------------------------------------------------------------------
    // Deleted lanes.
    //
    // Deleting a merged branch is routine housekeeping and must not
    // retroactively invalidate the immutable evidence that lane produced — the
    // commit graph outlives the ref, so provenance is re-proven from it. The
    // same disappearance must never become a way for CURRENT or CHANGED
    // evidence to slip its binding to this candidate's head/tree/base/lane.
    // Ownership is what separates the two, and it is not artifact-controlled.
    // ------------------------------------------------------------------

    // 14. The case that would otherwise break `pandora-verify` on main after a
    // lane merges and its branch is deleted.
    ["14: deleted lane + untouched artifact whose commit is still provable", inherited, { source: { branch: "deleted/merged-lane", candidate_head: HIST, candidate_tree: HIST_TREE, canonical_base: BASE } }, false, "historical.json"],

    // 15. The escape stays shut: a deleted lane proves nothing for evidence
    // this lane wrote or edited.
    ["15: deleted lane + changed artifact", ctx, { source: { branch: "deleted/merged-lane", candidate_head: HIST, candidate_tree: HIST_TREE, canonical_base: BASE } }, true, "historical.json"],

    // 16-19. Historical provenance still has to be provable.
    ["16: deleted lane + candidate_head that is not a real commit", inherited, { source: { branch: "deleted/merged-lane", candidate_head: GONE, candidate_tree: HIST_TREE, canonical_base: BASE } }, true, "historical.json"],
    ["17: deleted lane + candidate_tree that is not the tree of candidate_head", inherited, { source: { branch: "deleted/merged-lane", candidate_head: HIST, candidate_tree: OTHER_TREE, canonical_base: BASE } }, true, "historical.json"],
    ["18: deleted lane + candidate_head real but outside this history", inherited, { source: { branch: "deleted/merged-lane", candidate_head: FOREIGN, candidate_tree: HIST_TREE, canonical_base: BASE } }, true, "historical.json"],
    ["19: deleted lane + no candidate_head to prove anything with", inherited, { source: { branch: "deleted/merged-lane", candidate_tree: HIST_TREE, canonical_base: BASE } }, true, "historical.json"],

    // 20. History records the base as it WAS. Forcing an old artifact onto
    // today's merge-base would falsify it, which is the thing this file exists
    // to prevent — so the merge-base equality is not applied to proven history.
    ["20: deleted lane + historical canonical_base older than today's merge-base", inherited, { source: { branch: "deleted/merged-lane", candidate_head: HIST, candidate_tree: HIST_TREE, canonical_base: OLD } }, false, "historical.json"],
  ];

  let failures = 0;
  for (const [label, context, artifact, shouldReject, path] of cases) {
    const rejected = validateArtifact(artifact, path ?? "sample", context).length > 0;
    if (rejected !== shouldReject) {
      console.error(
        `SELF-TEST FAIL: '${label}' expected ${shouldReject ? "rejection" : "acceptance"}`,
      );
      failures += 1;
    }
  }

  // A rejection is only meaningful if it fires for the reason claimed. Case 11's
  // head, tree and base bindings are all internally correct against the lane it
  // names, so the ONLY thing that may reject it is the redirect itself. Without
  // this assertion the case could silently start passing for an unrelated reason
  // and stop covering the exploit.
  const exploitErrors = validateArtifact(
    {
      source: {
        branch: "recovery/review-20260818/pr-x-abcdef12",
        candidate_head: SUPERSEDED,
        candidate_tree: SUPERSEDED_TREE,
        canonical_base: BASE,
      },
    },
    "edited.json",
    ctx,
  );
  if (
    exploitErrors.length !== 1 ||
    !exploitErrors[0].includes("not identical to that lane's copy")
  ) {
    console.error(
      "SELF-TEST FAIL: the lane-redirect exploit must be rejected by the " +
        `redirect guard specifically, got: ${JSON.stringify(exploitErrors)}`,
    );
    failures += 1;
  }

  // The same artifact, inherited unchanged instead of written here, must still
  // be accepted — the fix must not break cross-lane integration.
  if (
    validateArtifact(
      {
        source: {
          branch: "other",
          candidate_head: OTHER_HEAD,
          candidate_tree: HEAD_TREE,
          canonical_base: BASE,
        },
      },
      "inherited.json",
      ctx,
    ).length !== 0
  ) {
    console.error(
      "SELF-TEST FAIL: an artifact inherited byte-for-byte from another lane " +
        "must still bind against that lane",
    );
    failures += 1;
  }

  // A deleted lane must never become the escape the resolved-lane path closed.
  // Asserted on the reason, not just the outcome: if this ever starts failing
  // because of an incidental binding mismatch instead of the ownership rule, the
  // case has stopped covering what it was written for.
  const deletedLaneEscape = validateArtifact(
    {
      source: {
        branch: "deleted/merged-lane",
        candidate_head: HIST,
        candidate_tree: HIST_TREE,
        canonical_base: BASE,
      },
    },
    "historical.json",
    ctx,
  );
  if (
    deletedLaneEscape.length !== 1 ||
    !deletedLaneEscape[0].includes("changed on this lane")
  ) {
    console.error(
      "SELF-TEST FAIL: a changed artifact naming a deleted lane must be " +
        `rejected for ownership specifically, got: ${JSON.stringify(deletedLaneEscape)}`,
    );
    failures += 1;
  }

  // ...while the same artifact, untouched, keeps its history. This is the pair
  // the acceptance rule turns on: deletion must not invalidate immutable
  // evidence, but must not launder current evidence either.
  if (
    validateArtifact(
      {
        source: {
          branch: "deleted/merged-lane",
          candidate_head: HIST,
          candidate_tree: HIST_TREE,
          canonical_base: BASE,
        },
      },
      "historical.json",
      inherited,
    ).length !== 0
  ) {
    console.error(
      "SELF-TEST FAIL: untouched historical evidence from a deleted lane must " +
        "remain valid when its commit and tree are still provable",
    );
    failures += 1;
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

  const mergeBase = defaultBranch ? git(["merge-base", "HEAD", defaultBranch]) : null;

  // Ownership is derived from the lane diff, not from any field inside the
  // artifacts themselves. An evidence file changed here must bind to this
  // candidate no matter what it claims about its own lane.
  const changed = new Set(
    mergeBase
      ? (git(["diff", "--name-only", `${mergeBase}...HEAD`, "--", EVIDENCE_DIR]) ?? "")
        .split("\n")
        .filter(Boolean)
      : [],
  );

  const ctx = {
    isInHistory: (sha) => inHistoryOf(sha, "HEAD"),
    exists: (sha) => git(["cat-file", "-e", `${sha}^{commit}`]) !== null,
    treeOf: (sha) => git(["rev-parse", `${sha}^{tree}`]),
    // Resolve a named lane to its real head. Remote first: it is the shared
    // truth, and a local branch may be stale or absent in CI.
    headOf: (lane) =>
      git(["rev-parse", "--verify", `origin/${lane}^{commit}`]) ??
        git(["rev-parse", "--verify", `${lane}^{commit}`]),
    parentsOf: (sha) =>
      (git(["rev-list", "--parents", "-n", "1", sha]) ?? "").split(/\s+/).slice(1),
    // Content identity of one path at one revision. Comparing blob ids compares
    // bytes, so this answers "did this lane change the file relative to that
    // lane?" without reading either copy.
    blobAt: (rev, path) => git(["rev-parse", `${rev}:${path}`]),
    head,
    headParents,
    mergeBase,
    branch,
  };

  const errors = [];
  let checked = 0;
  const notes = [];
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
    errors.push(
      ...validateArtifact(artifact, path, {
        ...ctx,
        owned: changed.has(path),
        notes,
      }),
    );
  }

  if (errors.length > 0) {
    console.error("Capability evidence binding gate FAILED:");
    for (const message of errors) console.error(`  - ${message}`);
    exit(1);
  }

  for (const note of notes) console.log(`  note: ${note}`);

  console.log(
    `Capability evidence binding gate passed: ${checked} artifacts ` +
      `(${changed.size} changed on lane '${branch ?? "unresolved"}'), every ` +
      `recorded commit and tree bound${
        notes.length > 0
          ? `; ${notes.length} provenance sha(s) shape-verified but not present here`
          : ""
      }.`,
  );
}

main();
