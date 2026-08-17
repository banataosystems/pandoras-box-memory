# Banatao Machine Gateway — Authentication and Authorization Architecture

**Status:** implementation design + first production-safe slice

## Purpose

Create one machine-facing ingress for trusted AI clients and automations while keeping human/operator UIs independently protected.

The gateway is reusable across Pandora Memory, ProjectOS, GitHub, Vercel, Supabase, PostHog, Resend, FlutterFlow.io, and future adapters, but it is **not** a universal master key.

## Security model

Every request passes four independent checks:

1. **Network reachability** — the machine endpoint is reachable without Vercel human SSO.
2. **Authentication** — caller identity is cryptographically verified.
3. **Authorization** — principal must hold an explicit service/action/environment grant.
4. **Downstream authorization** — the target adapter still enforces its own native authorization/RLS/permissions.

A gateway grant never implies unrestricted downstream access.

For service-role adapters, grant authorization and downstream row scope are
separate mandatory controls. Pandora `memory_search` is authorized only for
`namespace:real_life`, and its database query must independently constrain
the same user's rows to `namespace = real_life` before text matching, ordering,
or limiting. A negative regression must prove that an AU row owned by the same
user cannot cross this resource boundary. `memory_health` uses the same row
namespace for its active-item count so metadata cannot disclose same-owner AU
rows even though the health grant itself has no resource selector.

The function pins its npm imports and commits a function-scoped `package-lock.json`.
Candidate CI installs that lock with lifecycle scripts disabled before Deno
type-checking, preventing a floating dependency range from silently changing
the reviewed source contract.

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
- `flutterflow / project.list / production`
- `flutterflow / yaml.read / production / project:<project_id>`
- `flutterflow / yaml.validate / production / project:<project_id>`
- `flutterflow / yaml.update / production / project:<project_id>` — separately approval-gated

Write/destructive actions require separate grants and can remain approval-gated upstream.

## Capability registry

Production maintains an explicit `gateway_service_actions` registry. A grant alone is insufficient: the requested service/action must also be registered and `enabled = true`.

This provides two independent switches:

1. **Capability activation** — whether the gateway supports the provider/action at all.
2. **Principal grant** — whether a specific caller may use that enabled capability.

Unknown or disabled capabilities fail closed with `capability_not_enabled` before a grant can authorize them.

Current live state:

- `pandora_memory / health` — enabled, implemented;
- `pandora_memory / search` — enabled, implemented;
- all other registered provider actions — disabled/planned;
- FlutterFlow's six planned actions are registered but disabled.

## Adapter model

The gateway authenticates/authorizes; adapters translate an approved request into the target service contract. Each adapter owns:

- accepted actions;
- input validation;
- downstream credential reference;
- data minimization;
- timeout/retry policy;
- audit metadata;
- response filtering.

## First-class adapter target registry

The planned adapter registry is intentionally explicit:

- `pandora_memory`
- `projectos`
- `github`
- `vercel`
- `supabase`
- `posthog`
- `resend`
- `flutterflow`

Future services must be added explicitly; unknown service keys fail closed.

### FlutterFlow adapter contract

FlutterFlow is a first-class gateway target, but it does not inherit permissions from GitHub, Supabase, or ProjectOS.

Initial actions:

- `project.list` — list projects available to the configured FlutterFlow credential;
- `yaml.files.list` — list partitioned project YAML file names;
- `yaml.read` — export/read project YAML configuration;
- `yaml.validate` — validate proposed YAML before any mutation;
- `yaml.update` — update project configuration only with a separate write grant and upstream approval evidence;
- `code.export` — later adapter capability using the supported FlutterFlow export workflow, separate from YAML mutation.

Required safety rules:

- read/inspect capabilities are implemented before write capabilities;
- FlutterFlow API token remains server-side and is referenced through Vault/provider secret storage;
- every request is constrained to an explicitly granted FlutterFlow project ID/resource;
- `yaml.update` requires successful validation against the same project state before mutation;
- project schema/version fingerprints are recorded around YAML operations to detect drift;
- no blind bulk update across multiple FlutterFlow projects;
- write operations preserve source/evidence and rollback/recovery artifacts where the platform exposes them;
- production/app-store release is not implied by a successful FlutterFlow project edit or code export;
- release/deployment remains a separate approval and verification gate.

Because FlutterFlow's Project API is currently beta, the adapter must tolerate contract/version drift and fail closed when the project schema fingerprint or API response shape is incompatible with the validated implementation.

## MCP surface

The first MCP surface exposes only Pandora Memory health/search until authentication and denial paths are proven. Additional adapters/tools are added incrementally after independent review.

FlutterFlow will therefore appear in the registry before its tools appear in the public MCP surface. This prevents an unproven provider adapter from becoming reachable merely because the gateway supports the service key.

## Non-negotiable rules

- fail closed on unknown identity, unknown client, missing grant, wrong environment, expired token, ambiguous resource, unknown capability, or disabled capability;
- no wildcard `*/*` production grant;
- no secret-bearing tool arguments persisted to Memory or analytics;
- no gateway bypass of downstream RLS/authorization unless the specific adapter is explicitly server-admin by design and separately audited;
- no AI inference can create or expand its own gateway grants;
- gateway outage must not stop Pandora's internal cron/learning loops.

## Rollout

1. Add identity/grant/audit registry (no secrets).
2. Deploy machine gateway Edge Function.
3. Add explicit service/action capability registry; keep unimplemented actions disabled.
4. Prove unauthenticated denial.
5. Enable/configure Supabase OAuth 2.1 for ChatGPT user-delegated MCP.
6. Register ChatGPT/custom MCP client and grant only `pandora_memory:health/search`.
7. Prove authorized health/search and wrong-client/wrong-scope denial.
8. Add adapters one at a time using read-first scopes and separate mutation grants.
9. FlutterFlow enters with `project.list`, `yaml.files.list`, `yaml.read`, and `yaml.validate`; `yaml.update` remains separately approval-gated until its negative/rollback tests pass.

## Definition of done

The gateway is not considered production-ready until exact source SHA, deployed function version, OAuth client identity, authorization grants, positive tests, negative tests, audit rows, and rollback evidence are recorded.

No individual adapter is considered production-ready merely because the common gateway is production-ready. Each adapter requires its own source, credential-reference, authorization, positive/negative, provider-contract, and rollback evidence.
