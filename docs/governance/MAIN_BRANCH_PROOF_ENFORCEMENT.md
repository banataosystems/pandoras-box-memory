# Main-branch proof enforcement

**Proof stage of this document: `documented`.**
The workflow changes it describes are `implemented` and `source_tested`.
The branch-protection ruleset it references is **prepared, not applied.**

## The defect this closes

On 2026-08-17, canonical `main` at `d0e689556cc01428500b796cade87032ea5c0ad8`
failed the Capability Registry Gate. PR #27 had been green on its own head, but
the commit that actually became canonical was never held to the same contract.
Two independent gaps produced that outcome:

1. **Branch filters that excluded `main`.** `memory-evidence-intake.yml` ran on
   pushes to `feature/projectos-memory-evidence-intake`; `web-recovery-build.yml`
   ran on pushes to `recovery/deployable-web-v1`;
   `verify-memory-searchpath-advisor.yml` ran on pushes to a verification branch.
   None of them ran on `main`. A merge could therefore land typecheck-, build-,
   and contract-affecting source without any of those checks executing against
   the merge result.

2. **No branch protection.** `main` was observed unprotected, so nothing
   *required* any check to pass before the merge happened at all.

The result is the failure mode the project's own registry already names as the
blocker `registry-required-check-not-enforced`: **a PR head can be green while
its canonical merge commit is unverified.**

## What is now enforced in-repo

| Gate | Runs on PR | Runs on `main` push | Exact-head asserted |
| --- | --- | --- | --- |
| Pandora verify (`npm run verify`) | yes | yes | yes |
| Capability Registry Gate | yes | yes | yes |
| Pandora source security gate | yes | yes | yes (new) |
| Memory evidence intake contract | yes | yes (new) | yes |
| Memory recovery web build | yes | yes (new) | yes (new) |
| Machine gateway namespace isolation | yes | yes | yes |
| Search-path advisor proof contract | yes | yes (new) | yes |

Every workflow resolves the commit under test as:

```yaml
EXPECTED_HEAD: ${{ github.event_name == 'pull_request'
  && github.event.pull_request.head.sha || github.sha }}
```

checks it out by that SHA, and then asserts `git rev-parse HEAD` equals it. On a
`push` to `main`, `github.sha` **is** the merge result, so the canonical commit
is verified as a whole rather than inferred from its parents.

## Determinism changes

- `web-recovery-build.yml` used `npm install`, which could resolve dependency
  versions the lockfile did not describe. It now uses `npm ci`, which fails if
  `package.json` and `package-lock.json` have drifted.
- Dependency caches are keyed on `package-lock.json`, never `package.json`, so a
  cache hit cannot restore a tree the lockfile no longer describes.
- `pandora-verify.yml` fails if `node_modules/` or `.next/` is ever tracked in
  git, so generated output cannot become source.
- Third-party actions are pinned to immutable commit SHAs.

### Known limitation — one unpinned action

`actions/setup-python@v5` in `verify-memory-searchpath-advisor.yml` remains
pinned to a tag, not a SHA. This session's GitHub access is scoped to
`banataosystems/pandoras-box-memory`, so the authentic release SHA for
`actions/setup-python` could not be read. Fabricating a plausible-looking SHA
would be a falsified pin, which is worse than an honest tag. **A reviewer with
broader read access should replace it with the verified SHA.**

## Branch protection — prepared, not applied

`.github/branch-protection/main.json` contains the ruleset that closes gap (2).
It is deliberately **not applied** by this change: applying it mutates
repository administrative configuration, which is a governed action requiring
the same independent review as any other.

### Required contexts must be able to report

Independent review of the first draft caught a defect that would have been worse
than the gap it was closing: the ruleset required contexts produced by
**path-filtered** workflows. GitHub blocks a pull request until every required
context reports, and a path-filtered workflow never runs — so never reports — on
a PR that touches none of its paths. A valid documentation-only PR would have
been **permanently unmergeable**, waiting on a check that could never arrive.

The rule is now explicit: **a context may be required only if its workflow runs
unconditionally on `pull_request`.**

- `capability-registry-gate.yml` and `machine-gateway-namespace-isolation.yml`
  had their path filters removed so they always report. The registry gate's
  co-change logic already passes when no tracked source changed.
- `web-recovery-build.yml` and `memory-evidence-intake.yml` stay path-filtered
  and are **not** required. `pandora-verify` already runs typecheck, the
  production build, and the Memory evidence intake contract on every PR, so
  nothing is lost as a gate — they remain useful as targeted signal.
- `scripts/check_branch_protection_contexts.mjs` parses the workflow files and
  fails if any required context is path-filtered, unknown, ambiguous, or lacks a
  `pull_request` trigger. It runs in `npm run verify`, so this class of defect
  cannot be reintroduced silently.

Key properties of the prepared ruleset:

- `strict: true` — a PR must be up to date with `main` before merging, so the
  tested tree and the merge result cannot diverge.
- `enforce_admins: true` — the rule cannot be bypassed by an administrator,
  which is how the original bypass became possible.
- `required_linear_history: true` and `allow_force_pushes: false` — canonical
  history cannot be rewritten.
- `require_last_push_approval: true` — a push after approval invalidates it.

**Do not record branch protection as enforced until a provider readback of
`repos/.../branches/main/protection` proves it.** Until then the correct status
is: ruleset authored, review pending, not applied, not verified.

## What this does not prove

- It does not prove `main` is currently protected. It is not.
- It does not prove anything about deployed or production behavior. Every gate
  here is a **source** gate; passing them yields `source_tested`, never
  `deployed` or `production_verified`.
- It does not retroactively verify commits that landed before it.
