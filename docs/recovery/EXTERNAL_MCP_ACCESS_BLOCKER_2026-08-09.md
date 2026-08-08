# Pandora Memory — External MCP Access Blocker

**Observed:** 2026-08-09 PHT

## Verified facts

- The canonical public MCP hostname is `mcpmaster.vercel.app`.
- That hostname is owned by Vercel project `prj_Y5rZVcq8xJVzHVt4uvfmg9wPvXMk` under team `team_IcdJUnzLi5wUN1GD8ALHyjF7` / slug `mbanatao-dc676069`.
- The active Pandora service principal `projectos-mcpmaster-production` is correctly bound to that same Vercel project/team identity and production environment.
- A direct request to `https://mcpmaster.vercel.app/mcp` is intercepted by Vercel Deployment Protection and returns a `302 Found` redirect to Vercel SSO before application MCP/OAuth handling occurs.
- The same outer interception is observed for protected-resource metadata paths beneath `mcpmaster.vercel.app`.
- Therefore the current external failure is at the Vercel infrastructure protection layer, not proof that the internal Pandora service principal or Supabase Memory bridge is stale.

## Required production fix

Choose one supported machine-safe edge pattern and prove it end-to-end:

1. Preferred minimal change: configure Vercel Deployment Protection automation/trusted-machine bypass for the MCP caller while preserving application-level MCP OAuth/workload authorization; or
2. Dedicated public machine endpoint: expose only the MCP protocol surface on a separate Vercel project/domain with application-level authentication and no UI/session surface, while keeping operator/UI deployments protected.

Do **not** solve this by making Pandora Memory anonymous, disabling application authorization, accepting caller-supplied identity claims without verification, or embedding bypass credentials in source/semantic memory.

## Acceptance proof

- unauthenticated request reaches application MCP boundary and receives application-level auth challenge/denial rather than Vercel SSO;
- authorized ProjectOS/ChatGPT MCP identity reaches the Memory bridge;
- `memory.health` succeeds;
- approved `memory.search` succeeds for the allowed namespace;
- wrong/missing identity fails closed;
- internal Memory cron/learning continues even when MCP is unavailable;
- exact deployment/source/provenance and rollback evidence are recorded.

## Current constraint

The currently connected Vercel management connector exposes protected-deployment fetch and documentation, but no mutation for Deployment Protection automation bypass/trusted-source settings. That platform setting cannot be truthfully claimed configured from this session until an authorized control-plane action exists or a dedicated gateway is deployed.
