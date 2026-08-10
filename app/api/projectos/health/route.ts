import { NextRequest } from "next/server";
import { proxyProjectOSMemoryRequest } from "@/lib/services/projectos-memory-bridge-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return proxyProjectOSMemoryRequest(request, { action: "health" });
}
