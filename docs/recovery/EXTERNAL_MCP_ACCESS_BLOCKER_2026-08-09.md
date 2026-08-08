# Pandora Memory — External MCP Access Recovery

**Observed:** 2026-08-09 PHT

## Current verified facts

The original `https://mcpmaster.vercel.app/mcp` path is still intercepted by Vercel Deployment Protection/SSO. That is no longer the only machine-access path and must not be treated as the sole Pandora connection blocker.

### Direct production Memory OAuth MCP

The production Memory application exposes:

- MCP resource: `https://pandorasbox-memory.vercel.app/api/mcp`
- protected-resource metadata: `/.well-known/oauth-protected-resource/api/mcp`
- authorization-server metadata: `/.well-known/oauth-authorization-server`
- authorization endpoint: `/oauth/authorize`
- token endpoint: `/oauth/token`
- dynamic registration endpoint: `/oauth/register`
- login/callback: `/auth/login`, `/auth/callback`

Live behavior verified:

- `/api/mcp` reaches application auth directly and returns HTTP 401 `mcp_token_missing` when no bearer token is supplied;
- the 401 includes `WWW-Authenticate` with the correct MCP protected-resource metadata URL;
- protected-resource metadata returns HTTP 200;
- authorization-server metadata returns HTTP 200;
- OAuth metadata advertises authorization-code and refresh-token grants, PKCE S256, public-client token auth, and `pandora.memory.read`, `pandora.memory.write`, `offline_access` scopes;
- `/oauth/authorize` returns application-level `invalid_request` when called without required OAuth parameters, proving the route is active rather than 404/SSO intercepted;
- `/auth/login` is active and exposes GitHub + existing-user magic-link session flows.

Vercel build history proves both the known-good OAuth production deployment and the current production deployment contain the OAuth/MCP route set. The known-good OAuth build passed 113 test files / 795 tests, including OAuth discovery, token lifecycle, GitHub session, MCP auth, and MCP tool tests.

### Reusable Supabase machine gateway

A second long-term machine ingress is now live as Supabase Edge Function `pandora-machine-gateway` v3.

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

Use two complementary paths:

1. **Immediate ChatGPT reconnection:** connect ChatGPT directly to the already-live production Memory OAuth MCP endpoint at `https://pandorasbox-memory.vercel.app/api/mcp` and complete its existing OAuth flow.
2. **Long-term machine standardization:** migrate ProjectOS and future automated adapters to the Supabase machine gateway using short-lived workload identity or user OAuth plus least-privilege grants.

The new Supabase OAuth `/oauth/consent` overlay remains a future gateway authorization path. It is **not required for immediate Pandora reconnection** because the production Memory application already has a functioning OAuth authorization server at `/oauth/authorize`.

## Forbidden shortcuts

- no anonymous Memory access;
- no disabling application authorization;
- no universal shared gateway credential;
- no secret or bearer token in source, logs, analytics, screenshots, issues, or semantic memory;
- no unverified principal changes;
- no enabling FlutterFlow or another provider merely because its capability is registered.

## Remaining exit proof

Do not call Pandora fully reconnected until:

- ChatGPT completes OAuth against the live Memory MCP resource;
- authenticated Memory health/search succeeds;
- wrong/missing client identity remains denied;
- real production MCPMaster performs a signed workload-OIDC call through the reusable Supabase gateway;
- wrong workload identity/resource remains denied;
- gateway/MCP audit evidence contains no bearer/workload token;
- internal Memory cron/learning continues during client outages;
- exact source/deployment and rollback/restore evidence is recorded.
