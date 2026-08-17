# Capability-preserving rollback

**Proof stage: `documented`.**
**The rollback is NOT proven. No rehearsal was performed. See "Open gates".**

## Why the existing rollback target is insufficient

The preserved Vercel rollback deployment predates the current ProjectOS health
and search capabilities. Rolling back to it would restore a *working* Pandora
Memory, but not one with the capability set production currently serves — it
would silently drop `/api/projectos/health` and `/api/projectos/memory/search`.

A rollback that loses capabilities is a partial outage, not a recovery.

## Current production capability baseline

Observed 2026-08-17, read-only.

| Component | Production state |
| --- | --- |
| Vercel production deployment | `dpl_7CbTiMxMXQZjrLQDKchf455iBxi4` |
| `pandora-projectos-bridge` | v13 |
| `pandora-projectos-learning` | v1 |
| `pandora-machine-gateway` | v3 |
| Applied migrations | 68 |
| Canonical source at time of audit | `d0e689556cc01428500b796cade87032ea5c0ad8` |
| Canonical `main` at time of writing | `aa228d5bfb59c0e54ed85415d6faaea3340f6c56` (tree `852c6a4df8b9c20176c9b9aa701782dc23d5eddf`) |

**The 2026-08-17 source changes are not production deployed.** Production is
serving code that predates canonical main.

### Routes that must survive any rollback

- `/api/projectos/health`
- `/api/projectos/memory/search`
- `/api/mcp` — MCP discovery and the OAuth challenge boundary
- `/.well-known/oauth-protected-resource/api/mcp`
- `/oauth/consent`, `/auth/confirm`, `/auth/login`

## Rollback target — an immutable artifact, not a ref

Two target models have now been rejected in review, and both failures are worth
keeping visible:

1. **A hard-coded SHA in this document** (`d0e6895…`). It rotted the moment
   `main` advanced, and the document went on asserting it.
2. **"Whatever `origin/main` points at, at rollback time."** This fixed the rot
   but introduced a worse failure: current `main` can contain work that was
   merged but never production-authorized, deployed, rehearsed, or
   production-verified. Promoting it mid-incident would **ship unreleased
   changes while claiming to restore known-good state** — the opposite of a
   rollback.

**The target is an immutable provider artifact**, selected from
`docs/rollback/RELEASE_ARTIFACT_REGISTRY.json`. To qualify, an artifact needs
all four of:

| Requirement | Why |
| --- | --- |
| Immutable artifact id | A branch or tag moves; a deployment id does not. |
| Exact source commit | So what is being restored is knowable. |
| Capability manifest covering the required routes | A target that drops routes is a partial outage, not a recovery. |
| `production_verified` or `rehearsal_verified` | Otherwise it is a candidate, not a target. |

`scripts/check_rollback_targets.mjs` enforces this and runs in `npm run verify`.
It rejects a qualified artifact missing verification, capabilities, an exact
source commit, or a limitations list, and any summary that overstates what the
artifact list supports.

Artifact identifiers are validated against a **per-provider allowlist** of
immutable id shapes. An earlier version tried to keep moving refs out with a
blocklist of `origin/*`, `refs/*`, `main`, and `HEAD` — which let `v1.2.3`,
`release/foo`, and `feature/x` through, so the moving-ref model the registry
prohibits could return silently. Ref naming conventions are unenumerable; a
provider's own id format is exact. A provider with no registered id shape cannot
contribute a target at all.

### Currently qualified

| Artifact | Role | Qualified | Note |
| --- | --- | --- | --- |
| `dpl_7CbTiMxMXQZjrLQDKchf455iBxi4` | current production | **yes** | Production-verified, carries the full capability set. It is the target for a *future* deployment — it is what production runs now. |
| `dpl_9EkwxicRPzigkvUis5m1qk644CrG` | preserved prior baseline | **no** | Predates the ProjectOS health and Memory search routes. Promoting it would silently drop capabilities. |

**Both limitations are recorded and neither was closed in this pass:** the
capability manifest was not re-probed (Vercel is unauthenticated in this
session), and the source commit is asserted by prior evidence rather than
independently rebound to the artifact.

**If no artifact qualifies, rollback is UNAVAILABLE** and forward recovery is the
safe path. Saying that plainly is the correct outcome; inventing a target is not.

## Rollback procedure (NOT YET REHEARSED)

1. Select the most recent artifact with `qualified: true` from the registry
   whose capability manifest covers the routes the incident requires. **Do not
   take a target from prose, a branch, or `main`.**
2. Re-read that artifact from the provider and confirm it still exists and still
   reports the recorded source commit. A registry entry is a claim; the provider
   is the authority.
3. Confirm its capability manifest covers every route under "Routes that must
   survive". If the manifest was never probed, probe it in preview first, or
   treat rollback as unavailable.
4. Promote the pinned artifact id.
5. Re-read the production alias from the provider and confirm it points at the
   promoted artifact. **A promotion is not complete until provider readback
   proves it.**
6. Probe each required route, including that `/api/mcp` returns `401` with a
   `WWW-Authenticate` challenge for an unauthenticated request — not `200`, not
   `500`.
7. Record the resulting artifact id, source commit, and probe results as new
   evidence, and add the artifact to the registry. Do not edit this document;
   supersede it.

### Edge Functions and database

- **Edge Functions do not roll back with Vercel.** They are versioned
  independently at Supabase. A web rollback leaves the gateway at v3, the bridge
  at v13, and learning at v1.
- **The database does not roll back at all.** No applied migration has rollback
  metadata (0 of 68 — see `docs/migrations/MIGRATION_RECOVERY.md`). Any schema
  change must be reversed by a new, reviewed forward migration.

A change spanning the web tier and the database is therefore **not rollback-safe
today**, and that is a constraint on what may be deployed, not a documentation
gap.

## Forward-recovery procedure

If a rollback is performed, recovering forward requires:

1. Fix the defect on a branch from canonical `main`.
2. Green `pandora-verify` on the exact candidate head **and** on the merge
   result after landing.
3. Independent review of the exact release head.
4. Deploy, then verify by provider readback and route probes before declaring
   recovery.
5. Only then supersede the rollback evidence.

## Open gates — what is NOT proven

- **No rehearsal was performed.** This procedure has never been executed.
  Promoting a deployment and re-pointing a production alias are production
  mutations, outside the authorization of this pass.
- **The qualified target's capability manifest was not re-probed**, and its
  source commit was not independently rebound to the artifact. Both are recorded
  as limitations in the registry rather than assumed away.
- **No non-production environment was built or probed.** The release candidate
  is proven to build in CI; it has **not** been deployed to a preview
  environment, and its routes have **not** been exercised against a running
  instance.
- **OAuth-required surfaces were not tested.** Verifying the consent and token
  flows requires live credentials, which were not used.
- **Therefore rollback capability remains UNPROVEN.** The correct status is:
  procedure authored, candidate identified, rehearsal outstanding.

The next safe step is a **preview** deployment of the release candidate plus
route probes — which mutates nothing in production and would close the rehearsal
gate for the web tier. It would still leave the Edge Function and database
rollback gaps open, because those are structural, not procedural.
