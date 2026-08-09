import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!supabaseUrl) {
    return Response.json({ error: "supabase_public_config_missing" }, { status: 503 });
  }

  return Response.json({
    resource: `${request.nextUrl.origin}/api/mcp`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    bearer_methods_supported: ["header"],
  }, {
    headers: { "cache-control": "no-store" },
  });
}
