# PXE-0008: Independent Re-Review Report

## Reviewer & Vendor Identity
- **Reviewer Identity:** Google Jules
- **Vendor Identity:** Google
- **Target Repository:** `banataosystems/pandoras-box-memory`
- **Target Main SHA:** `478105057c1ca5fb5b356750ba1fa1fb58b1f42c`
- **Date of Review:** 2026-08-21 UTC

---

## Evidence Identities & Hashes
The re-evaluation incorporates the fresh live provider and runtime evidence observed through the governed provider path on 2026-08-20 UTC:

### Deployed Edge Functions & Live Provider Package Hashes
- **`pandora-projectos-bridge@15`**: ACTIVE, `verify_jwt=false`, provider package SHA-256 `7d2388c4c101ea3ca023e7c354aa5e08e7e02c49db5d51baf752ef27debfcb0a`.
- **`pandora-projectos-learning@1`**: ACTIVE, provider package SHA-256 `eec5a67e3e9af88850aa2a0e98dca7a344a54086b51166b5cc0a91e2b0ac82fe`.
- **`pandora-machine-gateway@3`**: ACTIVE, provider package SHA-256 `6dcdce080275161311a3a872c821db826d09adc02eee5ff9866fcb406d02a30f`.

### Reviewed Source Identities & Raw SHA-256 Hashes
- **Bridge Source:** Recovered bridge source commit `523fec111bfb2c327f69c2abdf0784775ab49a90`, raw SHA-256 `7cdb0e6a2ae74a6ea970ba537f8ff04c64cfd2c608e8b8e6c4a394dcff8d07cf`.
- **Learning Source:** Memory merge commit `478105057c1ca5fb5b356750ba1fa1fb58b1f42c`, raw SHA-256 `f12e08e1ed43f0730b0d19567a74cdaef86bdc5fa55637865647d6abb8df26e4`.
- **Machine-Gateway Source:** Memory merge commit `478105057c1ca5fb5b356750ba1fa1fb58b1f42c`, raw SHA-256 `ffab631b5c12c229e99942823940be4cb87c6d5f1c468949b5b5350b44296d45`.

---

## Recovery Status of Literal B1/B2 Criteria
- **Status:** **NOT RECOVERED / ABSENT**
- **Details:** Exhaustive search across canonical Memory repository source, Git commit history, pull requests, issues, and audit/recovery documentation confirmed that the literal historical wording and proof contracts for B1 and B2 criteria are not present. In accordance with the governing review contract, missing criteria or absent required proof prohibits constructing or inferring substitute criteria and requires maintaining the existing verdict.

---

## Findings

### Critical
- **CRIT-01: Absence of Literal B1/B2 Proof Gate Specifications**
  - The exact historical reviewer definitions of B1 and B2 remain unavailable in canonical Memory and historical audit artifacts. Under the Google Jules review contract, reviewers must evaluate against original criteria without reconstructing missing gates. Because the original B1/B2 contract cannot be recovered, PASS cannot be granted.

### High
- **HIGH-01: Upstream Provider Obstructions to Live Raw Artifact Verification**
  - Supabase Management API endpoint `/functions/{slug}/body` currently returns HTTP 502 upstream errors, preventing exact raw live-bundle extraction for complete provider-to-source byte parity verification. Additionally, provider analytics log queries encounter backend errors.

### Medium
- **MED-01: Non-JWT Verification Setting on Deployed Bridge Function**
  - Live observation confirms `pandora-projectos-bridge@15` has `verify_jwt=false`. While runtime routing executes, bypassing platform-level JWT verification delegates all authorization checks strictly to internal function code, requiring continuous maintenance of internal guards.

### Low
- **LOW-01: Incomplete Automated Live Execution Coverage Proof**
  - While negative probes (e.g., invalid HMAC signature returning 401 before candidate write) demonstrate expected fail-closed runtime execution, complete end-to-end positive candidate promotion proof depends on full downstream provider availability.

---

## Technical Assessments

### Source / Runtime Parity Assessment
The fresh live evidence confirms that deployed Edge Functions (`pandora-projectos-bridge@15`, `pandora-projectos-learning@1`, and `pandora-machine-gateway@3`) execute on the Edge runtime (as demonstrated by HTTP 405 `method_not_allowed` responses on GET requests and HTTP 401 on negative HMAC probes). However, due to upstream 502 responses when querying `/functions/{slug}/body`, raw bytecode extraction parity against repository source SHA-256 hashes cannot be independently verified at the binary level.

### HMAC / Outbox Privacy Assessment
Source inspection and negative runtime probing confirm robust HMAC verification on intake. The deliberately invalid HMAC probe returned HTTP 401 `invalid_signature` prior to entering candidate or write execution paths. No candidate or canonical Memory record was generated, verifying that negative probes do not corrupt canonical Memory or leak outbox payload content.

### Cron / Worker Behavior Assessment
Provider observations and repository migrations document scheduled job structures, but complete historical timeline verification remains constrained by provider backend log errors. Scheduled background processing fails closed when authorization or parameters drift.

### Tenant / Auth Boundaries Assessment
Machine-gateway and Memory endpoints correctly enforce Vercel OIDC workload identity and Supabase OAuth 2.1 boundaries. Public GET queries on machine-gateway present proper capabilities while restricting unauthorized data access across tenant and project boundaries.

### Rollback Assessment
The repository contains explicit, tested SQL rollback scripts (e.g. `20260820_disable_projectos_evidence_candidate_write_scope.sql` and `20260810_memory_searchpath_001.rollback.sql`) designed to disable candidate write scopes and reset function search paths if drift occurs. Rollback readiness is confirmed at the source schema level.

---

## Unresolved Evidence Gaps
1. **Literal B1/B2 Gate Definitions:** Original historical reviewer definitions for B1 and B2 gates remain unrecovered in canonical repository artifacts.
2. **Raw Live-Bundle Retrieval:** Upstream Supabase Management API (`/functions/{slug}/body`) returning 502 prevents raw live-bundle extraction.
3. **Provider Analytics Logs:** Provider backend error on analytics log queries prevents complete historical execution verification.

---

projectos-verdict: fail
