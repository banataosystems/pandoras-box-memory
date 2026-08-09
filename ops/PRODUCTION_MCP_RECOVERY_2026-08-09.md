# Pandora Memory MCP Production Recovery — 2026-08-09

## Source

- Canonical repository: `banataosystems/pandoras-box-memory`
- MCP proxy repair merged to `main`: `ff14877cff269ad6b75e36c1704d24af7526b519`
- Exact-head GitHub checks before merge:
  - `Memory recovery web build` — success
  - `Pandora source security gate` — success

## Vercel deployment

- Project: `memory`
- Project ID: `prj_brg3BJDcHfSftHH84NhnFtDJAnDO`
- Team: `team_IcdJUnzLi5wUN1GD8ALHyjF7`
- Production deployment: `dpl_Dmf7KCboiBVvAGG11V6R5swL4oaw`
- Public alias attached: `https://pandorasbox-memory.vercel.app`
- Deployment state: `READY`
- Deployment was created directly from the verified file tree, so it does not depend on the unavailable legacy Git repository.

## Production protocol evidence

Verified after deployment:

- `GET /api/mcp` → HTTP 401 `missing_bearer` and advertises the Memory protected-resource metadata URL.
- `GET /.well-known/oauth-protected-resource/api/mcp` → HTTP 200 and points to the Memory Supabase Auth OAuth 2.1 authorization server.
- `GET /oauth/consent` → HTTP 200.
- Vercel runtime error check after deployment → no runtime errors in the checked window.

## Gateway authorization

Migration `gateway_auto_enroll_oauth_memory_clients` is applied in production. A verified, owner-consented Supabase OAuth client may auto-enroll only into:

- `pandora_memory:health`
- `pandora_memory:search` scoped to `namespace:real_life`

No GitHub, Vercel, Supabase-admin, PostHog, Resend, FlutterFlow, or other provider capability is granted by this enrollment.

## Still open

Do **not** call external ChatGPT↔Pandora reconnection production-verified until a fresh ChatGPT DCR/OAuth flow completes and proves:

1. dynamic registration succeeds;
2. owner authorization succeeds;
3. token exchange/refresh succeeds;
4. authenticated `memory_health` succeeds;
5. authenticated `memory_search` succeeds;
6. missing/wrong identity remains denied;
7. audit evidence is recorded.
