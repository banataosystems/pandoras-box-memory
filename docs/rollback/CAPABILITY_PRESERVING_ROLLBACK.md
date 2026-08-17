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

## Release candidate

The capability-preserving release candidate is **whatever commit canonical
`main` points at when the rollback is performed** — not an older deployment, and
not a SHA copied out of this document.

That distinction is the point. Independent review caught an earlier draft naming
`d0e689556cc01428500b796cade87032ea5c0ad8` as *the* full-capability target.
`main` has since advanced, so that SHA is now a historical observation, not a
valid target: rolling to it would drop everything merged after it. **A rollback
target read from a document is stale by construction.**

**Rule: resolve the target from the repository at rollback time**, then verify it
carries the capability set below. The row underneath is an observation recorded
when this document was written, useful for comparison and nothing else.

| Property | Value (observed aa228d5, not a fixed target) |
| --- | --- |
| Ref | `main@aa228d5bfb59c0e54ed85415d6faaea3340f6c56` |
| Tree | `852c6a4df8b9c20176c9b9aa701782dc23d5eddf` |
| Build | `npm ci && npm run build` |
| Build inputs | `package-lock.json` committed; caches keyed on it |
| Credentials required to build | none beyond the two public `NEXT_PUBLIC_*` values |

Reproducibility is enforced by `pandora-verify.yml`, which runs `npm ci` and
`npm run build` against the exact commit on every push to `main`.

## Rollback procedure (NOT YET REHEARSED)

1. Identify the target deployment id from the Vercel deployment list for the
   project. Do not rely on a deployment id recorded in any document — read it
   from the provider at rollback time.
2. Resolve the intended target from `git rev-parse origin/main` (or the exact
   reviewed release ref), **not** from any SHA written in this document.
3. Confirm the target's source commit contains the required capability set
   above. **A target that predates those routes is not a valid rollback**, and
   a target older than current `main` silently discards everything merged since.
4. Promote the target to production via the Vercel dashboard or API.
5. Re-read the production alias from the provider and confirm it points at the
   promoted deployment. **A promotion is not complete until provider readback
   proves it.**
6. Probe each route in "Routes that must survive" and confirm the expected
   status — including that `/api/mcp` returns `401` with a `WWW-Authenticate`
   challenge for an unauthenticated request, not `200` and not `500`.
7. Record the resulting deployment id, source commit, and probe results as new
   evidence. Do not edit this document; supersede it.

### Edge Functions and database

- **Edge Functions do not roll back with Vercel.** They are versioned
  independently at Supabase. A Vercel rollback leaves the gateway at v3, the
  bridge at v13, and learning at v1.
- **The database does not roll back at all.** No applied migration has rollback
  metadata at the provider (0 of 68 — see
  `docs/migrations/MIGRATION_RECOVERY.md`). Any schema change must be reversed
  by a new, reviewed forward migration. **There is no down-migration path.**

This means a rollback is only safe for changes that are web-tier only. A change
that spans the web tier and the database is not rollback-safe today, and that is
a real constraint on what may be deployed.

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
  mutations, which are outside the authorization of this remediation pass.
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
