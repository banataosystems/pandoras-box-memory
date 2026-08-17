# Pandora Capability Registry v2

Authority: [Pandora Compounding Intelligence — Master Roadmap v2](https://github.com/banataosystems/pandoras-box-memory/issues/22)

Evidence date: 2026-08-14 Asia/Manila

## Outcome

This candidate establishes an evidence-first **Phase 1 registry foundation**. It does not claim Phase 1 completion, recovery of the recorded historical archive, original/canonical/live parity, or a completion percentage.

The registry separates four independent questions:

1. Is an artifact present?
2. What time-bounded operational state was observed?
3. Has a comparison been performed with content-addressed evidence?
4. Which claim-specific limitations and blockers remain?

No single aggregate proof stage is used.

## Three-plane truth

| Plane | What is proved | What remains blocked |
|---|---|---|
| Original archive | Recorded aggregate anchors: two unresolved filename aliases, 1,085,918 bytes, 782 regular files, ZIP/capsule hashes, a historical commit, 17 family labels, and a roadmap-described 113-test suite | Archive bytes and a deterministic per-file manifest are unavailable; no original filenames, test enumeration, per-file mapping, comparison, or completion claim is valid |
| Canonical source | Exact presence at `main@db409325c15778a1a701dad3f931e4c0fd19447c`: 62 blobs and 237,809 bytes, each recorded by path, blob SHA, and byte size | Capability family, runtime activity, historical status, obsolescence, relationship to the original archive, and current/live parity are unclassified or not compared |
| Live runtime | Two privacy-safe, hashed provider snapshots record time-bounded observations for 68 migration identities, three active Edge Function versions, and two Vercel deployments | Migration 68 source, gateway row-level namespace proof, connector reliability, Git-bound deployment provenance, a functional rollback, freshness recheck, and independent review remain open |

`candidate` and `current` are lifecycle concepts, not additional planes. Candidate branches and FlutterFlow gaps belong in comparisons, gap records, or delivery state outside this three-plane registry.

## Corrections preserved

- Live migration state was observed at 68 identities through `20260813114649_remove_temporary_flutterflow_http_probe_20260813`; the roadmap body’s prior 67 count remains dated evidence rather than being silently erased.
- `pandora-machine-gateway@3` is recorded as deployed/provider-observed. Its canonical/live byte relationship remains comparison-unverified in this registry.
- The retained `dpl_9Ekw…` deployment is READY but is not a capability-preserving rollback for ProjectOS health/search; the observed health path returned 404.
- Production ProjectOS search has bounded positive-path evidence and an unresolved reliability defect: seven 200s and four 503s appeared in one observed Vercel log window while corresponding bridge calls returned 200. A Vercel proxy/read-return fault is an inference, not a proved cause.

## Highest-value safe recovery candidate

The deployed machine gateway authorizes `namespace:real_life` for `memory_search`, while the observed service-role query does not explicitly constrain rows to that namespace. This is a high-risk proof gap, not a claimed incident.

The isolated source candidate must:

1. add an explicit `namespace = real_life` row constraint;
2. add a negative test proving an AU row owned by the same user cannot be returned;
3. preserve grant checks, user isolation, canon-state filtering, limits, and privacy-safe audit behavior;
4. pass exact-source CI and distinct qualified review; and
5. remain undeployed until the production gate is explicitly satisfied.

## Validator contract

Run:

```bash
node scripts/validate_capability_registry.mjs --self-test
```

The validator checks the exact 62-file Git manifest, three-plane vocabulary, immutable and content-addressed evidence, provider snapshot digests, presence-only canonical rows, required live observations and downgrades, archive aggregate anchors, blockers, and a withheld completion percentage. Fourteen rejection mutations exercise the major invariant families, including rejection of an unscoped Vercel-to-bridge source comparison.

The workflow explicitly checks out and asserts the pull request head SHA, requires a registry/manifest/evidence/roadmap co-change when tracked source changes, emits content digests, and uploads a hash-bearing attestation. This is a co-change signal, not proof that a semantic reconciliation is complete. A successful run is evidence only for that exact candidate SHA; the gate is not a required main-branch check until repository rules enforce it.

## Current gate

Only the Phase 1 registry foundation is implemented in this isolated source candidate. Phase 1 remains incomplete. This candidate is not merged, deployed, independently reviewed, archive-complete, current-tree-complete, or parity-complete.
