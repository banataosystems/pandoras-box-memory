import { NextRequest, NextResponse } from "next/server";

import { projectOSWorkloadToken } from "@/lib/http/auth-material";
import { declaredLengthExceeds, readBounded, unknownFields } from "@/lib/http/bounded";
import { proxyProjectOSMemoryRequest } from "@/lib/services/projectos-memory-bridge-client";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const ALLOWED_KEYS = new Set([
  "namespace",
  "project_id",
  "project_key",
  "title",
  "summary",
  "proof_stage",
  "claim",
  "evidence_refs",
  "provenance",
  "idempotency_key",
]);

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  // Do not buffer evidence payloads from callers that did not even present valid
  // workload authentication material. The Edge bridge performs full Vercel OIDC
  // and principal/scope authorization before accepting a candidate.
  if (!projectOSWorkloadToken(request.headers)) return unauthorized();

  if (declaredLengthExceeds(request.headers.get("content-length"), MAX_BODY_BYTES)) {
    return NextResponse.json({ ok: false, error: "body_too_large" }, { status: 413 });
  }

  // Meter the actual stream. `request.text()` is intentionally forbidden here:
  // an absent, chunked, or understated Content-Length must never remove the cap.
  const bounded = await readBounded(request, MAX_BODY_BYTES);
  if (!bounded.ok) {
    return bounded.reason === "read_failed"
      ? NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
      : NextResponse.json({ ok: false, error: "body_too_large" }, { status: 413 });
  }
  if (!bounded.text) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const unexpected = unknownFields(record, ALLOWED_KEYS);
  if (unexpected.length > 0) {
    return NextResponse.json(
      { ok: false, error: "unexpected_field", fields: unexpected.sort() },
      { status: 400 },
    );
  }

  return proxyProjectOSMemoryRequest(request, {
    action: "submit_evidence_candidate",
    ...record,
  });
}
