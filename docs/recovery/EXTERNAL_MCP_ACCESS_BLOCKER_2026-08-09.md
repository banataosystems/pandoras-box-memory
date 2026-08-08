# Pandora Memory — External MCP Access Recovery

**Observed:** 2026-08-09 PHT

## Current verified facts

The original `https://mcpmaster.vercel.app/mcp` path is still intercepted by Vercel Deployment Protection/SSO. A direct Memory MCP path also exists, but current production evidence now proves that its OAuth flow is not fully usable.

### Direct production Memory OAuth MCP

The production Memory application exposes:

- MCP resource: `https://pandorasbox-memory.vercel.app/api/mcp`
- protected-resource metadata: `/.well-known/oauth-protected-resource/api/mcp`
- authorization-server metadata: `/.well-known/oauth-authorization-server`
- authorization endpoint: `/oauth/authorize`
- token endpoint: `/oauth/token`
- dynamic registration endpoint: `/oauth/register`
- login/callback: `/auth/login`, `/auth/callback`

Verified reachable behavior:

- `/api/mcp` reaches application auth directly rather than Vercel SSO;
- protected-resource metadata returns HTTP 200;
- authorization-server metadata returns HTTP 200 and advertises authorization-code + refresh-token grants, PKCE S256, public-client token auth, and `pandora.memory.read`, `pandora.memory.write`, `offline_access` scopes;
- `/oauth/authorize` and `/auth/login` are application routes rather than 404/SSO interception.

### New verified blocker: dynamic client registration fails in current production

ChatGPT connector creation on 2026-08-09 PHT reached `/oauth/register` but returned HTTP 500. Vercel production runtime errors for project `prj_brg3BJDcHfSftHH84NhnFtDJAnDO` show six failures on deployment `dpl_FvN5R5u7bzjcFiANisaNfkZC2mTT` with the exact error:

`mcp_oauth_signing_secret_missing`

Observed failure window: 2026-08-08 20:46:09Z through 21:21:25Z.

This supersedes the earlier statement that direct Memory OAuth was fully working. Discovery is healthy, but dynamic registration is currently blocked by missing runtime signing-secret configuration required by the present OAuth implementation.

Historical Vercel evidence also shows that deployment `dpl_EPXdLqmMJn9aEXyH5WyggDf37PKJ` previously returned HTTP 201 for `/oauth/register` twice. Therefore DCR has worked on this same Vercel project before; the present problem is a regression/configuration gap, not proof that ChatGPT or the public hostname cannot support DCR.

Do not call the direct Memory OAuth path production-verified until the signing-secret configuration is restored and a fresh ChatGPT DCR + authorization flow succeeds end to end.

### Reusable Supabase machine gateway

A second long-term machine ingress exists as Supabase Edge Function `pandora-machine-gateway` v3.

It provides:

- Supabase OAuth user/client authentication;
- Vercel workload OIDC authentication;
- explicit service/action/environment/resource authorization;
- only Pandora `health` and `search` enabled initially;
- exact ProjectOS production workload identity with only those grants;
- wrong workload subject and wrong namespace denial;
- future services, including FlutterFlow.io, registered disabled by default.

Canonical source:

- Memory recovery/gateway slice: `banataosystems/pandoras-box-memory@523fec111bfb2c327f69c2abdf0784775ab49a90`
- ProjectOS gateway-client overlay: `banataosystems/Pandoras-box@9defb265b5671fc8eb632c4a67ec90de7843d109`

## Current repair strategy

1. Restore the missing production OAuth signing-secret configuration for the current Memory Vercel project without placing the secret in GitHub, logs, screenshots, analytics, or semantic Memory.
2. Redeploy/restart only as required by the platform so the production deployment receives the restored configuration.
3. Re-run ChatGPT connector creation using `https://pandorasbox-memory.vercel.app/api/mcp`.
4. Require proof of DCR success, owner authorization, refresh/offline access, authenticated `memory.health`, approved `memory.search`, and wrong/missing-client denial.
5. Continue the long-term migration of ProjectOS and future automated adapters to the reusable Supabase machine gateway using short-lived workload identity or user OAuth plus least-privilege grants.

The new Supabase OAuth `/oauth/consent` overlay remains a separate future gateway authorization path. It is not a substitute for repairing the direct Memory DCR regression unless the gateway path is independently completed and production-verified.

## Forbidden shortcuts

- no anonymous Memory access;
- no disabling application authorization;
- no universal shared gateway credential;
- no secret or bearer token in source, logs, analytics, screenshots, issues, or semantic memory;
- no unverified principal changes;
- no enabling FlutterFlow or another provider merely because its capability is registered.

## Remaining exit proof

Do not call Pandora fully reconnected until:

- current production `/oauth/register` returns a valid DCR success response for ChatGPT;
- ChatGPT completes OAuth against the live Memory MCP resource;
- authenticated Memory health/search succeeds;
- wrong/missing client identity remains denied;
- real production MCPMaster performs a signed workload-OIDC call through the reusable Supabase gateway;
- wrong workload identity/resource remains denied;
- gateway/MCP audit evidence contains no bearer/workload token;
- internal Memory cron/learning continues during client outages;
- exact source/deployment and rollback/restore evidence is recorded.
