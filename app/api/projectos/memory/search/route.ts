import { NextRequest, NextResponse } from "next/server";

import { declaredLengthExceeds, readBounded, unknownFields } from "@/lib/http/bounded";
import { proxyProjectOSMemoryRequest } from "@/lib/services/projectos-memory-bridge-client";

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

// Contract decision: this is a governed machine interface, so unknown top-level
// fields are REJECTED rather than silently dropped — matching the stricter
// evidence-candidate endpoint.
//
// The previous behavior filtered unknown keys out and proceeded. That is worse
// than it looks: a caller that misspells `max_items` gets a successful response
// computed with a different limit than it asked for, and never learns. Failing
// the request makes the mismatch visible at the boundary.
//
// There is no backward-compatibility requirement forcing permissiveness here:
// the only in-repo caller is the ProjectOS bridge client, which sends exactly
// these fields.
export async function POST(request: NextRequest) {
  if (declaredLengthExceeds(request.headers.get("content-length"), MAX_BODY_BYTES)) {
    return NextResponse.json({ ok: false, error: "body_too_large" }, { status: 413 });
  }

  const bounded = await readBounded(request, MAX_BODY_BYTES);
  if (!bounded.ok) {
    return bounded.reason === "read_failed"
      ? NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
      : NextResponse.json({ ok: false, error: "body_too_large" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const body = parsed as Record<string, unknown>;
  const unexpected = unknownFields(body, ALLOWED_KEYS);
  if (unexpected.length > 0) {
    // Name the offending keys — they are caller-supplied field names, not values,
    // so echoing them leaks nothing while making the error actionable.
    return NextResponse.json(
      { ok: false, error: "unexpected_field", fields: unexpected.sort() },
      { status: 400 },
    );
  }

  return proxyProjectOSMemoryRequest(request, { action: "search", ...body });
}
