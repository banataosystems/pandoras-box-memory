# Pandora Memory Recovery Status — 2026-08-09

## Current phase

Phase 0 — connector reachability and source recovery.

## Canonical source authority

- Canonical repository: `banataosystems/pandoras-box-memory`
- Canonical project key: `memory`
- Legacy `mbanatao/Memory` is historical/recovery provenance only and must not regain operational authority.

## Verified data-plane state

The Pandora Memory Supabase data plane has previously been verified ACTIVE_HEALTHY and contains governed Memory/project/source/audit records. Normal ChatGPT/ProjectOS MCP retrieval is not currently production-verified.

## Preserved source recovery evidence

Historical recovery artifact:

- Library artifact: `Memory-main (4)(2).zip`
- Size: 1,085,918 bytes
- ZIP SHA-256: `b0cfc83e04798887d9e889f45a1b9c8cf0e42cc51ce7f46fb3923b3a22434f2b`
- Embedded historical source commit: `7d4ec6cb30edb922024cf05f043807759d1fded7`
- Recovered regular-file count: 782
- Deterministic recovery capsule SHA-256: `458e7fa22541f103d6ed22198418d38928bba9c43006136c70534f0afdefbb13`

This artifact is recovery evidence, not proof of exact current production parity.

## Verified MCP failure boundary

The machine entrypoint is MCPMaster, not the Memory database directly.

Preserved MCPMaster routing establishes:

- canonical machine origin: `https://mcpmaster.vercel.app`
- canonical MCP route: `/mcp`
- Vercel rewrite: `/mcp` -> `/api/mcp`
- Memory base URL: `https://pandorasbox-memory.vercel.app`
- application MCP/OAuth authorization runs behind the route.

Current requests to `https://mcpmaster.vercel.app/mcp` and its OAuth protected-resource metadata are intercepted by Vercel Deployment Protection / SSO before MCP application authorization executes.

## Correct repair

Enable/generate Vercel **Protection Bypass for Automation** for the `mcpmaster` project and configure the authorized ProjectOS machine caller to send:

`x-vercel-protection-bypass: <automation-secret>`

This must bypass only Vercel's outer deployment-protection boundary. MCP/OAuth authorization must remain enabled and fail closed.

Do not make MCPMaster broadly anonymous/public as a workaround.

## Tooling limitation recorded 2026-08-09

The currently connected Vercel management tool can inspect protected deployments and create temporary share links, but it does not expose the project protection-bypass mutation / secret generation endpoint. No production protection setting was changed from this ChatGPT session.

## Acceptance proof required before declaring connected

1. Authorized ProjectOS call traverses Vercel protection using automation credentials.
2. MCP application authentication still rejects missing/wrong identities.
3. `memory.health` succeeds through the real ProjectOS workload identity.
4. A project-scoped search returns approved Memory records.
5. Cross-project / unauthorized retrieval is denied.
6. Exact production deployment ID, environment, endpoint, auth mode, and rollback target are recorded.
7. The repaired state is written back to Pandora Memory only after read/write verification.

## Current proof ladder

- Documented: yes.
- Source recovery evidence preserved: yes.
- Canonical source repository initialized: yes.
- Historical source fully promoted into canonical repository: not yet.
- MCP routing architecture recovered: yes.
- Vercel outer protection blocker independently re-verified: yes.
- Automation bypass configured: no — platform mutation unavailable in current connector.
- Authenticated MCP retrieval tested: no.
- Production-verified connection: no.

## Highest-value next action

Generate the `mcpmaster` Vercel Protection Bypass for Automation credential through an authorized Vercel control plane, configure the ProjectOS machine caller to send it as a header, then execute the full positive/negative MCP verification sequence before any connected/healthy claim.
