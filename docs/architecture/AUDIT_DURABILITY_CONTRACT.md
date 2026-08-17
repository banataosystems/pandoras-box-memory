# Audit durability contract

**Proof stage: `documented`.** The learning-function implementation is
`implemented` and `source_tested`. It is **not deployed.**

## The finding

Two Edge Functions treated audit persistence as best-effort while presenting it
as part of the security contract:

- `pandora-machine-gateway` inserted `gateway_audit_events` rows and **never
  read the returned Supabase error**. A failed audit write was indistinguishable
  from a successful one.
- `pandora-projectos-learning` logged the audit error and **still returned
  success**, so a caller received `202 accepted_for_review` for an operation
  with no durable audit evidence.

Neither is a crash. Both are silent: the system reports a governed action as
completed-and-audited when only the first half is true.

## Classification

Every operation that writes audit evidence falls into exactly one class. There
is no fourth "log it and hope" class.

### 1. Audit-required / fail-closed

**Rule:** the operation must not report success unless the audit row is durable.

**Applies to:** `pandora-projectos-learning` post-task learning intake.

**Why this is safe here:** every write in that path is idempotent and keyed on
`source_ref`. Failing after the candidate, review item, and digest are persisted
does not lose work — the caller retries, the retry adopts the persisted state,
and the missing audit row is healed. Failing closed costs a retry; returning
success would cost the audit trail permanently.

**Implementation:** `writeAudit()` returns whether the row is durable, and the
handler returns `500 audit_persistence_failed` when it is not. A failed audit
*lookup* also fails closed (`500 audit_lookup_failed`) — an unreadable audit
table cannot be used to conclude that no audit row is needed.

**Ordering rule.** Audit reconciliation runs **before** the changed-content
conflict decision, not after. Independent review caught the inverted order,
which left this hole:

1. a first request persists candidate, review item, and digest, then its audit
   write fails, so it returns `500`;
2. the caller retries with changed content;
3. the retry reconciles review and digest, then returns `409` — never reaching
   the audit write;
4. every subsequent changed retry does the same, so the persisted candidate is
   stranded **permanently without audit evidence**.

The audit row is evidence about the *persisted* candidate, not about the request
in flight — exactly like the review item and the digest. So it is healed on every
submission, including one that is about to be rejected. The conflict decision
comes last.

**Tested by:** `scripts/test_projectos_learning_behavior.mjs`
— audit insert failure fails closed, audit lookup failure fails closed, a retry
heals the audit row without duplicating the candidate, a **changed-content**
retry heals the audit row and only then conflicts, repeated changed retries heal
exactly once, and an audit failure on a changed retry still surfaces as
`audit_persistence_failed` rather than being masked behind a `409`. All three
ordering tests were verified to fail when the conflict is moved back ahead of
the audit write.

### 2. Completion-first / outbox-reconciled

**Rule:** the underlying action has already taken effect and cannot be safely
undone or replayed, so it is reported as completed, but the audit gap is
recorded durably and reconciled.

**Applies to:** currently **nothing in this repository.**

This class is defined here because it is the correct answer for a future
operation whose side effect is externally visible before the audit write — for
example, an outbound provider mutation. It is deliberately empty today rather
than being used as a euphemism for "we ignored the error". Adopting it requires
an actual durable outbox; until one exists, class 1 is the only permitted
treatment for a governed action.

### 3. Informational / best-effort

**Rule:** the record is operational telemetry, not part of any security or
governance claim. Losing it degrades observability and nothing else.

**Applies to:** nothing that participates in an authorization decision.

**Critically:** a record that a reviewer or auditor would rely on to reconstruct
who did what is **not** in this class, regardless of which table it lives in.

## Machine gateway: authorization outcomes

`pandora-machine-gateway` audits authorization decisions. The two directions are
not symmetric:

| Decision | Audit failure behavior | Reason |
| --- | --- | --- |
| `allow` | **Fail closed.** Return an error instead of the data. | The data has not left the boundary yet, so it can still be withheld. Returning it unaudited would be an unrecorded disclosure. |
| `deny` / `error` | **Deny anyway.** Record the audit degradation; never upgrade to allow. | The safe outcome is denial. An audit failure must never weaken a denial into an allow. |

Denial is never blocked on audit success — that would convert an audit outage
into an authorization outage in the *unsafe* direction only if inverted, and
into a denial-of-service if applied naively. Denying and recording the
degradation is the correct trade.

## Logging discipline

Audit failure handlers log a **classification string only** — for example
`projectos_learning_audit_failed`. They do not log:

- the audit row body, which carries operational metadata;
- Supabase error `message` text, which can echo row contents;
- arguments, results, errors, tokens, headers, or identifiers.

The previous implementation logged `error.message` on audit failure, which could
surface stored content in logs. That was removed.

## What is NOT proven

- **None of this is deployed.** `pandora-projectos-learning` remains at
  provider version 1, which does not contain these changes.
- The gateway's `allow`/`deny` audit asymmetry is specified here and implemented
  in the gateway boundary lane; this document does not by itself prove it.
- No production audit row was written, read, or mutated to produce this
  document.
