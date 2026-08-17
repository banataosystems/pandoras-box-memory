import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  MEMORY_APPROVED_CANON_STATUSES,
  normalizeProjectOSSearchResponse,
  projectOSCanonSelection,
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
