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
    },
  };
}
