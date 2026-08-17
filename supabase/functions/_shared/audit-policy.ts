// Audit durability policy, expressed as data rather than as scattered ifs.
//
// See docs/architecture/AUDIT_DURABILITY_CONTRACT.md for the full rationale.
// The short version: an operation must never report success while claiming
// audit evidence that does not durably exist, but an audit outage must also
// never be able to turn a denial into an allow.

/** How an operation treats a failed audit write. */
export type AuditClass =
  /** Must not report success without durable audit evidence. */
  | "audit_required_fail_closed"
  /**
   * The side effect already happened and cannot be safely replayed, so the
   * operation completes and the audit gap is reconciled out of band. Requires a
   * real durable outbox; nothing in this repository uses it yet.
   */
  | "completion_first_outbox"
  /** Telemetry only. Never used for anything a reviewer would rely on. */
  | "informational";

export type AuditDecision = "allow" | "deny" | "error";

/**
 * Decide whether an operation must fail because its audit write did not persist.
 *
 * The asymmetry is the point:
 *
 *   - `allow` + audit failure  -> fail closed. The data has not left the
 *     boundary yet, so it can still be withheld. Returning it unaudited would
 *     be an unrecorded disclosure.
 *   - `deny`/`error` + audit failure -> proceed with the denial. Denial is
 *     already the safe outcome; blocking on audit success would let an audit
 *     outage weaken authorization, and there is nothing to withhold.
 */
export function mustFailClosed(
  auditClass: AuditClass,
  decision: AuditDecision,
  auditDurable: boolean,
): boolean {
  if (auditDurable) return false;
  if (auditClass !== "audit_required_fail_closed") return false;
  return decision === "allow";
}
