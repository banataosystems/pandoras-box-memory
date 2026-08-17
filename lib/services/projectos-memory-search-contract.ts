export const PROJECTOS_APPROVED_CANON_ALIAS = "approved";
export const MEMORY_APPROVED_CANON_STATUSES = [
  "hard_canon",
  "soft_canon",
] as const;

type JsonRecord = Record<string, unknown>;

export type ProjectOSCanonSelection = {
  requestedStatuses: [typeof PROJECTOS_APPROVED_CANON_ALIAS];
  bridgeStatuses: [
    (typeof MEMORY_APPROVED_CANON_STATUSES)[0],
    (typeof MEMORY_APPROVED_CANON_STATUSES)[1],
  ];
};

export type ProjectOSSearchNormalization =
  | { ok: true; value: JsonRecord }
  | { ok: false; error: string };

const APPROVED_STATUS_SET = new Set<string>(MEMORY_APPROVED_CANON_STATUSES);

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * ProjectOS deliberately exposes one stable governance alias, `approved`.
 * Internal Memory canon labels remain an implementation detail and draft
 * records are never selectable through this full-capacity contract surface.
 */
export function projectOSCanonSelection(
  value: unknown,
): ProjectOSCanonSelection | null {
  if (value !== undefined && value !== null) {
    if (
      !Array.isArray(value) ||
      value.length !== 1 ||
      value[0] !== PROJECTOS_APPROVED_CANON_ALIAS
    ) {
      return null;
    }
  }

  return {
    requestedStatuses: [PROJECTOS_APPROVED_CANON_ALIAS],
    bridgeStatuses: [...MEMORY_APPROVED_CANON_STATUSES],
  };
}

function exactApprovedBridgeStatuses(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== MEMORY_APPROVED_CANON_STATUSES.length) {
    return false;
  }
  if (!value.every((entry) => typeof entry === "string")) return false;
  const unique = new Set(value);
  return (
    unique.size === MEMORY_APPROVED_CANON_STATUSES.length &&
    MEMORY_APPROVED_CANON_STATUSES.every((status) => unique.has(status))
  );
}

/**
 * Fields on an individual record that can carry an internal Memory canon label.
 *
 * `canon_status` is the obvious one. `memory_type` is not: it is a separate
 * field that nonetheless holds values like `soft_canon` in live data, so
 * leaving it alone would leak exactly the vocabulary this contract promises to
 * keep internal. Both are normalized.
 */
const RECORD_CANON_LABEL_FIELDS = ["canon_status", "memory_type"] as const;

const CANON_LABEL_FIELD_SET = new Set<string>(RECORD_CANON_LABEL_FIELDS);

/**
 * Rewrite canon-label *fields* at any depth, and only those fields.
 *
 * Spreading the bridge record through unchanged — as an earlier revision did —
 * satisfied the top-level contract while still exposing `hard_canon` /
 * `soft_canon` per record, so the promise that internal labels stay internal
 * was false in practice. Validation still happens against the internal values;
 * only what is handed back is rewritten.
 *
 * Deliberately keyed on field name rather than on the string value. A blanket
 * search-and-replace for `hard_canon` / `soft_canon` anywhere in the payload
 * would also rewrite free text — record bodies, summaries, and provenance notes
 * legitimately discuss canon status — silently corrupting content in the name of
 * hiding a label. Nesting still has to be handled, because a shallow pass over
 * the record's own keys misses a label carried inside a nested structure.
 */
function withPublicCanonLabels(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withPublicCanonLabels);
  if (!isRecord(value)) return value;

  const normalized: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      CANON_LABEL_FIELD_SET.has(key) &&
      typeof entry === "string" &&
      APPROVED_STATUS_SET.has(entry)
    ) {
      normalized[key] = PROJECTOS_APPROVED_CANON_ALIAS;
      continue;
    }
    normalized[key] = withPublicCanonLabels(entry);
  }
  return normalized;
}

/**
 * Convert the internal bridge response back to the stable ProjectOS contract.
 * The route fails closed if the bridge returns a draft, an unapproved record,
 * a mismatched count, or an unexpected internal canon selection.
 */
export function normalizeProjectOSSearchResponse(
  input: unknown,
  selection: ProjectOSCanonSelection,
): ProjectOSSearchNormalization {
  if (!isRecord(input) || input.ok !== true) {
    return { ok: false, error: "invalid_bridge_response" };
  }

  if (!exactApprovedBridgeStatuses(input.requested_canon_statuses)) {
    return { ok: false, error: "bridge_canon_scope_mismatch" };
  }

  const canonicalRecords = input.canonical_records;
  if (!Array.isArray(canonicalRecords)) {
    return { ok: false, error: "bridge_canonical_records_missing" };
  }

  for (const item of canonicalRecords) {
    if (!isRecord(item)) {
      return { ok: false, error: "bridge_canonical_record_invalid" };
    }
    if (
      item.approved !== true ||
      typeof item.canon_status !== "string" ||
      !APPROVED_STATUS_SET.has(item.canon_status)
    ) {
      return { ok: false, error: "bridge_canonical_scope_violation" };
    }
  }

  if (
    !Number.isInteger(input.approved_record_count) ||
    (input.approved_record_count as number) < 0 ||
    input.approved_record_count !== canonicalRecords.length
  ) {
    return { ok: false, error: "bridge_approved_count_mismatch" };
  }

  return {
    ok: true,
    value: {
      ...input,
      requested_canon_statuses: [...selection.requestedStatuses],
      // Records are rebuilt, not spread through, so no internal canon label
      // survives into the ProjectOS response.
      canonical_records: canonicalRecords.map(withPublicCanonLabels),
    },
  };
}

/**
 * True when no internal canon label appears anywhere in a normalized response.
 *
 * Exported so tests can assert the contract over the whole payload rather than
 * over the handful of fields a test happens to remember to check. Scoped to
 * canon-label fields, so prose that merely mentions a canon status is not a
 * false positive.
 */
export function containsInternalCanonLabel(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsInternalCanonLabel);
  if (!isRecord(value)) return false;

  return Object.entries(value).some(([key, entry]) => {
    if (
      CANON_LABEL_FIELD_SET.has(key) &&
      typeof entry === "string" &&
      APPROVED_STATUS_SET.has(entry)
    ) {
      return true;
    }
    return containsInternalCanonLabel(entry);
  });
}
