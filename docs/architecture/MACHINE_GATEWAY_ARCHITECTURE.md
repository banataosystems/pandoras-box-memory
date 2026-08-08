# Banatao Machine Gateway — Authentication and Authorization Architecture

**Status:** implementation design + first production-safe slice

## Purpose

Create one machine-facing ingress for trusted AI clients and automations while keeping human/operator UIs independently protected.

The gateway is reusable across Pandora Memory, ProjectOS, GitHub, Vercel, Supabase, PostHog, Resend, and future adapters, but it is **not** a universal master key.

## Security model

Every request passes four independent checks:

1. **Network reachability** — the machine endpoint is reachable without Vercel human SSO.
2. **Authentication** — caller identity is cryptographically verified.
3. **Authorization** — principal must hold an explicit service/action/environment grant.
4. **Downstream authorization** — the target adapter still enforces its own native authorization/RLS/permissions.

A gateway grant never implies unrestricted downstream access.

## Identity modes

### User-delegated OAuth

For ChatGPT/custom MCP clients and other user-delegated agents, use Supabase Auth OAuth 2.1/OIDC access tokens. OAuth tokens identify the user and client; gateway grants constrain which services/actions that client may invoke.

### Workload OIDC

For server-to-server automation, use verifiable workload identity (for example Vercel OIDC) and map issuer/subject/project/environment into a gateway principal. Do not distribute one long-lived shared gateway password.

## Secret policy

- provider/API secrets stay in Supabase Vault or provider-native secret stores;
- gateway tables store identities, scopes, grants, metadata, and references — never secret values;
- semantic memory never stores credentials;
- GitHub never stores credentials;
- logs/audit events store hashes/IDs, not bearer tokens or request bodies containing secrets.

## Authorization model

A principal is granted an explicit tuple:

`service_key + action_pattern + environment + optional resource_pattern`

Examples:

- `pandora_memory / health / production`
- `pandora_memory / search / production / namespace:worldstageinternational`
- `github / repo.read / production / banataosystems/nlp`
- `vercel / deployment.read / production / project:cherrypua`

Write/destructive actions require separate grants and can remain approval-gated upstream.

## Adapter model

The gateway authenticates/authorizes; adapters translate an approved request into the target service contract. Each adapter owns:

- accepted actions;
- input validation;
- downstream credential reference;
- data minimization;
- timeout/retry policy;
- audit metadata;
- response filtering.

## MCP surface

The first MCP surface exposes only Pandora Memory health/search until authentication and denial paths are proven. Additional adapters/tools are added incrementally after independent review.

## Non-negotiable rules

- fail closed on unknown identity, unknown client, missing grant, wrong environment, expired token, or ambiguous resource;
- no wildcard `*/*` production grant;
- no secret-bearing tool arguments persisted to Memory or analytics;
- no gateway bypass of downstream RLS/authorization unless the specific adapter is explicitly server-admin by design and separately audited;
- no AI inference can create or expand its own gateway grants;
- gateway outage must not stop Pandora's internal cron/learning loops.

## Rollout

1. Add identity/grant/audit registry (no secrets).
2. Deploy machine gateway Edge Function.
3. Prove unauthenticated denial.
4. Enable/configure Supabase OAuth 2.1 for ChatGPT user-delegated MCP.
5. Register ChatGPT/custom MCP client and grant only `pandora_memory:health/search`.
6. Prove authorized health/search and wrong-client/wrong-scope denial.
7. Migrate additional machine integrations one adapter at a time.

## Definition of done

The gateway is not considered production-ready until exact source SHA, deployed function version, OAuth client identity, authorization grants, positive tests, negative tests, audit rows, and rollback evidence are recorded.