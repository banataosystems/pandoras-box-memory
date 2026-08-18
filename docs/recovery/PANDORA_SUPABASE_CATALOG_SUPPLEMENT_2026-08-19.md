# Pandora Memory Supabase live catalog supplement — 2026-08-19

This supplement closes the catalog-inventory gap left intentionally open by the initial PR #42 observation. It records read-only production evidence for project `ivmvufhcsezyhczzondn` without changing the database, Edge Functions, Auth configuration, grants, branches, deployments, or production data.

## Verified current state

- **Migrations:** 68 live identities, 542 stored statements, 246,216 bytes; full provider-generated TSV SHA-256 `1ee828f6844dfedf800b3c5a7a2b8e35c785214e548213defaf01013dd5bda65`. Classification remains 14 exact/authentic, 1 sanitized, and 53 identity-known/source-missing. No migration carries provider rollback or idempotency metadata.
- **Application relations:** 89 across `public` and `private`; 83 have RLS enabled and 31 force RLS. Six private credential/recovery relations intentionally do not rely on RLS and must remain owner/function/ACL bounded.
- **Policies:** 117 policies across 62 tables: 44 SELECT, 44 INSERT, 11 UPDATE, 18 ALL, and no standalone DELETE policy.
- **Functions:** 25 application functions; 11 are SECURITY DEFINER, all 11 have fixed `search_path`, and none is executable by PUBLIC, anon, or authenticated. The 10 broadly executable RPCs are SECURITY INVOKER.
- **Automatic execution:** 14 enabled application triggers, all timestamp-maintenance triggers; one active 15-minute ProjectOS Memory daily-context-pack cron job; six provider-managed event triggers; no application event trigger.
- **Privileges:** 1,797 privilege entries grouped into 280 object/role grants. Public-schema broad grants are constrained by RLS. Private relation access is limited to three explicit `service_role` grant groups listed in the manifest.
- **Security advisors:** 27 current notices. Leaked-password protection remains disabled and is a real separate security change; this evidence lane does not mutate Auth.
- **Edge Functions:** bridge v13, learning v1, and machine gateway v3 remain ACTIVE at their recorded provider hashes. Raw bundle retrieval still returns HTTP 502, so fresh exact executable parity is not claimed.

## Recovery conclusion

The live **current catalog state** is now production-verified at deterministic fingerprint level. The **historical migration chain** is still only partially reconstructable because 53 authentic SQL sources are missing. No database rollback point is qualified. Recovery must use forward reconciliation against the committed fingerprints, preserving data and requiring independent review plus release authorization for any production repair.

## Safety

No production DDL/DML, migration replay, data change, Edge deployment, branch creation, new spending, credential rotation, grant change, merge, or production release was performed.
