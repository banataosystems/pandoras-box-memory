# ProjectOS → Pandora Memory connector recovery — 2026-08-10

## Outcome

Production connector recovery is verified end-to-end.

- Canonical repository: `banataosystems/pandoras-box-memory`
- Repair PR: `#15` — Restore ProjectOS Memory health and search routes
- Repair merge commit: `fc6eea5b228533464633d2304b159e097b9e2b4f`
- Canonical Vercel project: `prj_brg3BJDcHfSftHH84NhnFtDJAnDO` (`memory`)
- Production origin: `https://pandorasbox-memory.vercel.app`
- Production deployment: `dpl_7CbTiMxMXQZjrLQDKchf455iBxi4`
- Pre-repair production / rollback baseline: `dpl_9EkwxicRPzigkvUis5m1qk644CrG`
- Pandora Memory recovery event: `4a183dde-12f5-4c9d-8a0c-1ef457ccf31f`

## Root cause

The canonical Memory web runtime did not contain the ProjectOS service-principal routes expected by MCPMaster:

- `GET /api/projectos/health`
- `POST /api/projectos/memory/search`

The Supabase Memory data plane and `pandora-projectos-bridge` remained healthy. The 404 therefore originated in the Vercel web/runtime route layer, not the Memory database.

## Source recovery

The missing route/proxy implementation was recovered from the preserved Memory source archive and restored into the canonical repository.

Recovered files:

1. `app/api/projectos/health/route.ts`
2. `app/api/projectos/memory/search/route.ts`
3. `lib/services/projectos-memory-bridge-client.ts`

Pre-write recovery hashes:

- health route SHA-256: `ffed6ab4ecc6f607f602bc4167d35b7b8a9025e40770cf8f7defdfec042bd582`
- search route SHA-256: `ef1642a3e860c786bb1f05685aaf27b914ee3d67306410ebf9146eac6f861c17`
- bridge client SHA-256: `539288ee7af5a37e039a1dbe3f71a75bbd86cafbb02a0d4c4a4d87eb157440c9`

The bridge is fail-closed and targets only the canonical Memory Supabase project `ivmvufhcsezyhczzondn` through `pandora-projectos-bridge`.

## Exact-head source verification

Repair branch head: `4790ceafae68187fe23f6a03a26e3fc8d23e035b`.

Before merge:

- `Pandora source security gate`: PASS
- `Memory recovery web build`: PASS
- TypeScript/typecheck: PASS
- Next.js production build: PASS
- PR mergeability: PASS
- patch review: only the intended three runtime files were added

The PR was merged only after those exact-head gates passed.

## Deployment verification

The existing Git-to-Vercel binding did not trigger a deployment after merge. To avoid leaving the repair implemented-but-not-deployed, the current canonical runtime was re-read from merge commit `fc6eea5b...` and deployed through the authenticated Vercel control plane.

The runtime bundle contained 17 files and preserved the current OAuth, PKCE, MCP, login, and consent fixes in addition to the repaired ProjectOS routes.

### Preview

- deployment: `dpl_H1x2iaZZSXyxF7eUApxL3mpVsxR8`
- state: `READY`
- Next.js compile: PASS
- type validity check: PASS
- route manifest contains both ProjectOS routes and the existing MCP/OAuth/auth routes

### Production

- deployment: `dpl_7CbTiMxMXQZjrLQDKchf455iBxi4`
- state: `READY`
- aliases include `pandorasbox-memory.vercel.app`
- alias error: none
- production build: PASS
- route manifest contains:
  - `/.well-known/oauth-protected-resource/api/mcp`
  - `/api/mcp`
  - `/api/projectos/health`
  - `/api/projectos/memory/search`
  - `/auth/confirm`
  - `/auth/login`
  - `/oauth/consent`

## Production acceptance proof

1. `GET https://pandorasbox-memory.vercel.app/api/projectos/health` without workload identity returns `401 {"ok":false,"error":"unauthorized"}` and `x-matched-path: /api/projectos/health`. This proves the prior 404 is removed while the application remains fail-closed.
2. Installed `Pandoras-box.memory.health` returns:
   - `ok: true`
   - `project: pandora-memory-engine`
   - `status: projectos-connected`
   - `origin: https://pandorasbox-memory.vercel.app`
   - `authentication: vercel_oidc`
3. Installed `Pandoras-box.memory.search` returns `ok: true` and real namespace-isolated canonical/open-loop context.
4. `/api/mcp` without a bearer token returns the expected `401` OAuth challenge.
5. `/.well-known/oauth-protected-resource/api/mcp` returns `200` and identifies the canonical Supabase authorization server.
6. `/auth/login` returns `200` and its served assets are tagged with production deployment `dpl_7CbTiMxMXQZjrLQDKchf455iBxi4`.
7. Vercel runtime error inspection after production verification reports zero runtime errors in the checked window.

## Rollback

The pre-repair READY production deployment `dpl_9EkwxicRPzigkvUis5m1qk644CrG` remains the rollback baseline. It is known to lack the ProjectOS routes and should be used only for emergency rollback if the new runtime develops a broader regression.

## Remaining non-blocking infrastructure gap

The Vercel Git auto-deploy binding did not create a deployment for merge commit `fc6eea5b...`. The connector itself is production-verified working because the exact canonical runtime was deployed directly through the authenticated Vercel control plane. Git auto-deploy repair remains a separate deployment-automation task; it is not a Memory availability blocker.

Do not mark the Git binding repaired until a future canonical `main` change automatically creates a Vercel deployment with verified source provenance.
