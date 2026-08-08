# Pandora Memory — Phase 0 Source Recovery Gate

**Purpose:** prevent always-on architecture work from mutating production against an unrecovered or mismatched source tree.

## Canonical source authority

- Canonical repository: `banataosystems/pandoras-box-memory`
- Legacy repository: `mbanatao/Memory` — recovery/provenance only; not operational authority.
- Current canonical repository state: recovery shell plus governance/architecture documents; application-source parity is not yet proven.

## Preserved recovery artifact

Historical recovery evidence currently includes:

- Archive name: `Memory-main (4)(2).zip`
- Archive byte size: `1085918`
- Recorded SHA-256: `b0cfc83e04798887d9e889f45a1b9c8cf0e42cc51ce7f46fb3923b3a22434f2b`
- Recorded historical source commit: `7d4ec6cb30edb922024cf05f043807759d1fded7`

These values are recovery evidence, not proof that the archive exactly matches the active production deployment.

## Active deployment evidence to reconcile

Previous Vercel build evidence showed the active Memory deployment being built from the legacy repository `mbanatao/Memory`, branch `main`, at abbreviated commit `49e0dcd`.

Runtime evidence also showed:

- protected-resource metadata route responding;
- `/api/mcp` reaching application/serverless handling but returning `401` without successful auth;
- `/mcp` and `/mcp/sse` requests returning `404` in the Memory project runtime.

This must be re-verified against the current active deployment before release work.

## Required recovery procedure

1. Materialize/unpack the preserved archive in a trusted working environment.
2. Inventory all files, migrations, package lockfiles, route definitions, OAuth/MCP handlers, tests, and deployment configuration.
3. Compute a deterministic manifest of paths, sizes, and SHA-256 values.
4. Recover Git history/parent lineage where available.
5. Compare the archive state to the active Vercel deployment build metadata and runtime behavior.
6. Identify whether the deployment commit `49e0dcd` is an ancestor, descendant, divergent sibling, or unrelated snapshot relative to recovered commit `7d4ec6...`.
7. Recover missing deltas from preserved evidence when possible; otherwise document them explicitly.
8. Import the verified recovered source into this canonical repository additively, preserving provenance.
9. Run the recovered source's existing tests before architectural changes.
10. Produce a source-parity statement with confidence and unresolved gaps.

## Fail-closed rule

Do **not**:

- apply new Supabase schema migrations;
- change production MCP/OAuth behavior;
- move/rotate production secrets;
- replace the active Vercel production deployment;
- claim source recovery complete;

until source parity and live-schema compatibility are verified.

## Phase 0 exit evidence

Phase 0 is complete only when all are present:

- recovered source tree in canonical repository;
- source manifest/hash set;
- parent/history provenance;
- active Vercel deployment mapping;
- verified live Supabase schema/migration mapping;
- current MCP/OAuth route map;
- current environment map;
- test baseline;
- rollback target;
- explicit unresolved-gap register (empty or accepted by owner/policy).

## Current state

- Recovery artifact preserved: **yes**.
- Canonical repository established: **yes**.
- Architecture documented: **yes**.
- Exact source parity with production: **not yet verified**.
- Live schema parity: **not yet verified**.
- Safe to apply always-on migrations to production: **no**.
