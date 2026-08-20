import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  MEMORY_APPROVED_CANON_STATUSES,
  normalizeProjectOSSearchResponse,
  projectOSCanonSelection,
  containsInternalCanonLabel,
} from "../../lib/services/projectos-memory-search-contract.ts";

function validBridgeResponse() {
  return {
    ok: true,
    namespace: "real_life",
    canonical_records: [
      { id: "one", canon_status: "hard_canon", approved: true },
      { id: "two", canon_status: "soft_canon", approved: true },
    ],
    approved_record_count: 2,
    requested_canon_statuses: [...MEMORY_APPROVED_CANON_STATUSES],
  };
}

test("ProjectOS accepts only the stable approved alias", () => {
  assert.deepEqual(projectOSCanonSelection(undefined), {
    requestedStatuses: ["approved"],
    bridgeStatuses: ["hard_canon", "soft_canon"],
  });
  assert.deepEqual(projectOSCanonSelection(["approved"]), {
    requestedStatuses: ["approved"],
    bridgeStatuses: ["hard_canon", "soft_canon"],
  });

  for (const value of [
    [],
    ["draft"],
    ["hard_canon"],
    ["soft_canon"],
    ["approved", "approved"],
    ["approved", "draft"],
    "approved",
    1,
  ]) {
    assert.equal(projectOSCanonSelection(value), null, `accepted ${JSON.stringify(value)}`);
  }
});

test("valid approved bridge records are returned under the stable alias", () => {
  const selection = projectOSCanonSelection(["approved"]);
  assert.ok(selection);
  const normalized = normalizeProjectOSSearchResponse(validBridgeResponse(), selection);
  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;
  assert.deepEqual(normalized.value.requested_canon_statuses, ["approved"]);
  assert.equal(normalized.value.approved_record_count, 2);
});

test("draft, unapproved, and unknown canon records fail closed", () => {
  const selection = projectOSCanonSelection(["approved"]);
  assert.ok(selection);

  for (const record of [
    { id: "draft", canon_status: "draft", approved: false },
    { id: "false", canon_status: "hard_canon", approved: false },
    { id: "unknown", canon_status: "archived", approved: true },
  ]) {
    const value = validBridgeResponse();
    value.canonical_records = [record];
    value.approved_record_count = 1;
    const normalized = normalizeProjectOSSearchResponse(value, selection);
    assert.deepEqual(normalized, {
      ok: false,
      error: "bridge_canonical_scope_violation",
    });
  }
});

test("count and resolved-status mismatches fail closed", () => {
  const selection = projectOSCanonSelection(["approved"]);
  assert.ok(selection);

  const wrongCount = validBridgeResponse();
  wrongCount.approved_record_count = 1;
  assert.deepEqual(normalizeProjectOSSearchResponse(wrongCount, selection), {
    ok: false,
    error: "bridge_approved_count_mismatch",
  });

  const wrongStatuses = validBridgeResponse();
  wrongStatuses.requested_canon_statuses = ["hard_canon"];
  assert.deepEqual(normalizeProjectOSSearchResponse(wrongStatuses, selection), {
    ok: false,
    error: "bridge_canon_scope_mismatch",
  });
});

test("the web route resolves the alias before forwarding and normalizes afterward", () => {
  const route = readFileSync(
    new URL("../../app/api/projectos/memory/search/route.ts", import.meta.url),
    "utf8",
  );
  const resolveAt = route.indexOf("projectOSCanonSelection(body.canon_statuses)");
  const forwardAt = route.indexOf("proxyProjectOSMemoryRequest(request");
  const normalizeAt = route.indexOf("normalizeProjectOSSearchResponse(bridgeBody, selection)");
  assert.ok(resolveAt >= 0 && forwardAt > resolveAt && normalizeAt > forwardAt);
  assert.match(route, /canon_statuses: \[\.\.\.selection\.bridgeStatuses\]/);
});

// --- internal canon labels must not reach the ProjectOS response ------------
//
// Independent review found the normalizer spreading `canonical_records` through
// unchanged, so individual records still exposed `hard_canon` / `soft_canon`
// even though the contract promises those stay internal.

test("record-level canon labels are replaced with the stable alias", () => {
  const selection = projectOSCanonSelection(["approved"]);
  const normalized = normalizeProjectOSSearchResponse(
    {
      ok: true,
      requested_canon_statuses: ["hard_canon", "soft_canon"],
      approved_record_count: 2,
      canonical_records: [
        { id: "a", approved: true, canon_status: "hard_canon", memory_type: "hard_canon" },
        { id: "b", approved: true, canon_status: "soft_canon", memory_type: "soft_canon" },
      ],
    },
    selection,
  );

  assert.equal(normalized.ok, true);
  for (const record of normalized.value.canonical_records) {
    assert.equal(record.canon_status, "approved");
    assert.equal(record.memory_type, "approved");
  }
});

test("no internal canon label survives anywhere in the response", () => {
  const selection = projectOSCanonSelection(["approved"]);
  const bridge = {
    ok: true,
    requested_canon_statuses: ["hard_canon", "soft_canon"],
    approved_record_count: 1,
    canonical_records: [
      {
        id: "a",
        approved: true,
        canon_status: "soft_canon",
        memory_type: "soft_canon",
        nested: { deep: [{ canon_status: "hard_canon" }] },
      },
    ],
  };

  assert.equal(
    containsInternalCanonLabel(bridge),
    true,
    "precondition: the bridge payload does contain internal labels",
  );

  const normalized = normalizeProjectOSSearchResponse(bridge, selection);
  assert.equal(normalized.ok, true);
  assert.equal(
    containsInternalCanonLabel(normalized.value),
    false,
    "internal canon labels leaked into the ProjectOS response",
  );
});

test("non-canon fields keep their values", () => {
  const selection = projectOSCanonSelection(["approved"]);
  const normalized = normalizeProjectOSSearchResponse(
    {
      ok: true,
      requested_canon_statuses: ["hard_canon", "soft_canon"],
      approved_record_count: 1,
      canonical_records: [
        {
          id: "a",
          approved: true,
          canon_status: "hard_canon",
          memory_type: "business_fact",
          title: "unchanged",
          strength: "high",
        },
      ],
    },
    selection,
  );

  const record = normalized.value.canonical_records[0];
  assert.equal(record.memory_type, "business_fact", "unrelated memory_type must survive");
  assert.equal(record.title, "unchanged");
  assert.equal(record.strength, "high");
  assert.equal(record.id, "a");
});

test("free text mentioning a canon status is never rewritten", () => {
  // Hiding a label must not become a licence to edit record content. Live
  // records legitimately discuss canon status in body, summary, and provenance.
  const selection = projectOSCanonSelection(["approved"]);
  const body = "This record was promoted to soft_canon after review.";
  const normalized = normalizeProjectOSSearchResponse(
    {
      ok: true,
      requested_canon_statuses: ["hard_canon", "soft_canon"],
      approved_record_count: 1,
      canonical_records: [
        {
          id: "a",
          approved: true,
          canon_status: "soft_canon",
          body,
          source_summary: "hard_canon promotion evidence",
          provenance: { note: "soft_canon" },
        },
      ],
    },
    selection,
  );

  const record = normalized.value.canonical_records[0];
  assert.equal(record.canon_status, "approved", "the label field is normalized");
  assert.equal(record.body, body, "prose must survive byte-for-byte");
  assert.equal(record.source_summary, "hard_canon promotion evidence");
  assert.equal(record.provenance.note, "soft_canon", "non-label field untouched");
});
