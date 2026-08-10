import { NextRequest, NextResponse } from "next/server";
import { proxyProjectOSMemoryRequest } from "@/lib/services/projectos-memory-bridge-client";

export const dynamic = "force-dynamic";

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

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const payload = Object.fromEntries(
    Object.entries(body).filter(([key]) => ALLOWED_KEYS.has(key)),
  );

  return proxyProjectOSMemoryRequest(request, {
    action: "search",
    ...payload,
  });
}
