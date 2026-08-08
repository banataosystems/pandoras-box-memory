# FlutterFlow Gateway Adapter

**Status:** adapter contract documented; provider write path not yet activated

## Purpose

Make FlutterFlow.io a first-class Banatao Machine Gateway target without creating a broad shared credential or allowing an AI client to mutate arbitrary FlutterFlow projects.

## Current provider capability basis

FlutterFlow's current Project API exposes programmatic project discovery and project-YAML operations, including listing projects, listing partitioned file names, exporting YAML, validating YAML, and updating a project by YAML. The Project API is currently beta, uses bearer-token authentication, requires read access for inspection/validation, editor access for updates, and may change in incompatible ways.

FlutterFlow also supports code export through its CLI/export workflow. Code export is a distinct operation and does not constitute production deployment or app-store release.

## Gateway service key

`flutterflow`

## Planned action scopes

### Read/inspection

- `project.list`
- `yaml.files.list`
- `yaml.read`

### Validation

- `yaml.validate`

### Mutation

- `yaml.update`

### Export

- `code.export`

Mutation and export scopes are independent. A principal holding `yaml.read` must not receive `yaml.update` or `code.export` implicitly.

## Resource model

All project-specific grants use an explicit resource pattern such as:

`project:<flutterflow_project_id>`

No production wildcard grant across all FlutterFlow projects is permitted.

## Credential model

- FlutterFlow API token remains server-side.
- The credential value must live in Supabase Vault or another approved provider-native server secret store.
- Gateway grants contain only credential references/metadata, not credential values.
- Tokens must never be emitted into MCP responses, semantic Memory, logs, analytics, screenshots, or GitHub.

## Read-first implementation order

1. `project.list`
2. `yaml.files.list`
3. `yaml.read`
4. `yaml.validate`
5. independently review provider schema/version behavior
6. `yaml.update` behind explicit approval and rollback evidence
7. `code.export` behind separate export authorization

## Write gate

A `yaml.update` request is allowed only when all of the following are true:

- caller identity is authenticated;
- OAuth/workload client maps to an active gateway principal;
- principal has `flutterflow / yaml.update / <environment> / project:<id>`;
- the request targets exactly the granted project;
- proposed YAML has passed `yaml.validate` for that same project;
- current project schema/version fingerprint has not drifted from the validated state;
- an upstream approval/evidence reference is supplied when the operation is consequential;
- an audit event is written for allow/deny/error;
- the provider response is checked rather than treating HTTP transport success as proof of a correct mutation.

## Release separation

A successful FlutterFlow edit, validation, or export does **not** mean:

- a Vercel/hosting deployment occurred;
- Android/iOS build verification passed;
- app-store submission occurred;
- production release was authorized;
- rollback was tested.

Those remain separate gates.

## Beta API safety

Because FlutterFlow Project API is beta:

- adapter records supported provider API version/base URL;
- schema fingerprint/version metadata is captured around project-YAML operations;
- unknown or changed response structures fail closed;
- adapter does not automatically retry a write after an ambiguous provider response;
- tests include provider-contract drift cases before write activation.

## Required proof before activation

### Read activation

- credential resolves server-side without disclosure;
- `project.list` returns only provider-authorized projects;
- project-scoped grant permits the intended project;
- wrong project is denied by gateway before provider mutation/read where applicable;
- audit records contain identity/service/action/resource/outcome but no bearer token.

### Write activation

- validated YAML can be applied to a non-production/test project;
- invalid YAML is denied;
- schema-fingerprint drift is denied;
- wrong project is denied;
- missing approval is denied for consequential updates;
- provider mutation result is independently re-read/verified;
- recovery/rollback procedure is recorded and tested;
- exact adapter source SHA and deployed gateway version are recorded.

## Live gateway registration evidence

The production gateway service/action registry now contains all six FlutterFlow actions:

- `project.list`
- `yaml.files.list`
- `yaml.read`
- `yaml.validate`
- `yaml.update`
- `code.export`

All six are currently `enabled = false` and `provider_status = planned`. `yaml.update` and `code.export` are marked approval-required. A direct authorization check for `flutterflow / project.list` currently fails closed with `capability_not_enabled`, proving that registration does not equal activation.

## Current state

- Documented: **yes**
- Registered as first-class gateway target: **yes**
- Production service/action registry entry: **yes**
- Fail-closed disabled-capability proof: **yes**
- Provider token installed in Vault: **not yet proven**
- Read adapter implemented: **not yet**
- Read adapter tested: **not yet**
- Write adapter implemented: **not yet**
- Production-verified: **no**
