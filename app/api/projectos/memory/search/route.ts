import { NextRequest, NextResponse } from "next/server";

import { projectOSWorkloadToken } from "@/lib/http/auth-material";
import { declaredLengthExceeds, readBounded, unknownFields } from "@/lib/http/bounded";
import { proxyProjectOSMemoryRequest } from "@/lib/services/projectos-memory-bridge-client";
import {
  normalizeProjectOSSearchResponse,
  projectOSCanonSelection,
} from "@/lib/services/projectos-memory-search-contract";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

const ALLOWED_KEYS = new Set([
  "namespace",
  "query",
  "current_task",
  "max_items",
  "include_semantic",
  "include_profiles",
  "include_recent",
  "include_open_loops",
  "canon_statuses",
]);

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function contractError(error: string, status = 400) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

// Contract decision: this is a governed machine interface, so unknown top-level
// fields are REJECTED rather than silently dropped — matching the stricter
// evidence-candidate endpoint.
export async function POST(request: NextRequest) {
  // Reject missing or malformed workload authentication material before reading
  // any caller-controlled body. The Edge bridge performs cryptographic OIDC and
  // principal/scope verification after this syntactic early gate.
  if (!projectOSWorkloadToken(request.headers)) return unauthorized();

  if (declaredLengthExceeds(request.headers.get("content-length"), MAX_BODY_BYTES)) {
    return contractError("body_too_large", 413);
  }

  const bounded = await readBounded(request, MAX_BODY_BYTES);
  if (!bounded.ok) {
    return bounded.reason === "read_failed"
      ? contractError("invalid_json")
      : contractError("body_too_large", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bounded.text);
  } catch {
    return contractError("invalid_json");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return contractError("invalid_json");
  }

  const body = parsed as Record<string, unknown>;
  const unexpected = unknownFields(body, ALLOWED_KEYS);
  if (unexpected.length > 0) {
    return NextResponse.json(
      { ok: false, error: "unexpected_field", fields: unexpected.sort() },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const selection = projectOSCanonSelection(body.canon_statuses);
  if (!selection) return contractError("invalid_canon_statuses");

  const bridgeResponse = await proxyProjectOSMemoryRequest(request, {
    action: "search",
    ...body,
    canon_statuses: [...selection.bridgeStatuses],
  });
  if (!bridgeResponse.ok) return bridgeResponse;

  let bridgeBody: unknown;
  try {
    bridgeBody = await bridgeResponse.json();
  } catch {
    return contractError("invalid_bridge_response", 502);
  }

  const normalized = normalizeProjectOSSearchResponse(bridgeBody, selection);
  if (!normalized.ok) return contractError(normalized.error, 502);

  return NextResponse.json(normalized.value, {
    status: bridgeResponse.status,
    headers: { "cache-control": "no-store" },
  });
}
