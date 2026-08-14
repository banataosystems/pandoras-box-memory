import { NextRequest, NextResponse } from "next/server";

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

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "body_too_large" }, { status: 413 });
  }

  const raw = await request.text();
  if (!raw || byteLength(raw) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: raw ? "body_too_large" : "invalid_json" },
      { status: raw ? 413 : 400 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const entries = Object.entries(body);
  if (entries.some(([key]) => !ALLOWED_KEYS.has(key))) {
    return NextResponse.json({ ok: false, error: "unexpected_field" }, { status: 400 });
  }

  return proxyProjectOSMemoryRequest(request, {
    action: "submit_evidence_candidate",
    ...Object.fromEntries(entries),
  });
}
