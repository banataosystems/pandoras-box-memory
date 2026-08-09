import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ALLOWED_TYPES = new Set(["email", "magiclink"]);

function safeDestination(value: string | null, origin: string) {
  if (!value) return "/";
  try {
    if (value.startsWith("/") && !value.startsWith("//")) return value;
    const parsed = new URL(value);
    if (parsed.origin === origin) return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {}
  return "/";
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") || "email";
  const destination = safeDestination(
    requestUrl.searchParams.get("redirect_to") || requestUrl.searchParams.get("next"),
    requestUrl.origin,
  );
  const failureUrl = new URL("/auth/login", requestUrl.origin);
  failureUrl.searchParams.set("next", destination);

  try {
    const supabase = await createSupabaseServerClient();

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        failureUrl.searchParams.set("error", "pkce_exchange_failed");
        return NextResponse.redirect(failureUrl);
      }
      return NextResponse.redirect(new URL(destination, requestUrl.origin));
    }

    if (tokenHash && ALLOWED_TYPES.has(type)) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
      if (error) {
        failureUrl.searchParams.set("error", "magic_link_verification_failed");
        return NextResponse.redirect(failureUrl);
      }
      return NextResponse.redirect(new URL(destination, requestUrl.origin));
    }

    failureUrl.searchParams.set("error", "invalid_auth_callback");
    return NextResponse.redirect(failureUrl);
  } catch {
    failureUrl.searchParams.set("error", "auth_unavailable");
    return NextResponse.redirect(failureUrl);
  }
}
