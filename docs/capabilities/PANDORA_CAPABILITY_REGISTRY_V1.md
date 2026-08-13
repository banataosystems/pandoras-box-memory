# Pandora Capability Registry v1

Authority: [Pandora Compounding Intelligence — Master Roadmap v2](https://github.com/banataosystems/pandoras-box-memory/issues/22)

Evidence date: 2026-08-14 Asia/Manila

## Outcome

This candidate establishes a deterministic registry and CI gate for the exact 62-file canonical baseline at `main@db409325c15778a1a701dad3f931e4c0fd19447c`. It does **not** claim recovery or parity for the recorded 782-file historical archive.

The 62 canonical baseline blobs and 237,809 bytes are fully enumerated by path, Git blob SHA, byte size, capability family, preservation classification, proof stage, evidence, owner target, and next action. That is canonical-source inventory accounting only—not an original-source completion percentage.

## Three-plane truth

| Plane | What is proved | What remains blocked |
|---|---|---|
| Original archive | Recorded aggregate anchors: two unresolved filename aliases, 1,085,918 bytes, 782 regular files, ZIP/capsule hashes, historical commit, 17 families, and a roadmap-described 113-test suite | Archive bytes and per-file manifest are unavailable; no original filename, file mapping, test enumeration, comparison, or completion claim is valid |
| Canonical source | Exact Git baseline: 62 blobs, 237,809 bytes, immutable commit/tree, deterministic files-array checksum | Relationship to the original archive and universal historical SQL body parity are unproved |
| Live runtime | 68 migration identities; three active core Edge Functions; ProjectOS health and positive search path exercised; production deployment retained | Migration 68 source is absent; gateway row-level namespace proof, return-path reliability, Git-bound deploy provenance, capability-preserving rollback, and independent review remain open |

## Corrections preserved, not overwritten

- Live migration state is 68 identities through `20260813114649_remove_temporary_flutterflow_http_probe_20260813`; the issue body’s prior 67 count remains dated evidence.
- `pandora-machine-gateway@3` is executable-line equivalent to canonical source, but raw bytes differ by four canonical comment lines and one trailing blank.
- The retained `dpl_9Ekw…` deployment is READY but is not a capability-preserving rollback for current ProjectOS health/search; its exact health path returns 404.
- Production ProjectOS search has a verified positive path and an unresolved reliability defect: seven 200s and four 503s appeared in one observed Vercel log window while corresponding Supabase bridge calls returned 200. A proxy/read-return fault is plausible, not proven.

## Highest-value safe recovery candidate

The machine gateway’s `memory_search` path authorizes `namespace:real_life` but does not explicitly constrain the service-role `memory_items` query to that namespace. Treat this as a high-risk proof gap, not a claimed incident.

The next isolated source change must:

1. add an explicit `namespace = real_life` row filter;
2. add a negative test proving an AU row owned by the same user cannot be returned;
3. preserve grant checks, user isolation, canon-state filtering, limits, and privacy-safe audit behavior;
4. pass exact-source CI and distinct qualified review;
5. remain undeployed until the applicable production gate.

## Validator contract

`node scripts/validate_capability_registry.mjs --self-test` verifies the frozen Git manifest, roadmap digest, archive anchors, all required record fields, the exact 17 original family aggregates, the unverified 113-test aggregate, live migration 68, and required blockers. Its mutation tests prove that omissions, duplicate paths, false archive availability, and live-ledger regression are rejected.

## Current gate

Phase 1 is **implemented as an isolated source candidate** once this branch passes exact-head CI. It is not merged, deployed, independently reviewed, archive-complete, or parity-complete.

