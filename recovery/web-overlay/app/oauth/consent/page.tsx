"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type AuthorizationDetails = {
  authorization_id?: string;
  redirect_url?: string;
  redirect_uri?: string;
  scope?: string;
  client?: { id?: string; name?: string; uri?: string };
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export default function OAuthConsentPage() {
  const supabase = useMemo(() => {
    if (!supabaseUrl || !publishableKey) return null;
    return createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }, []);

  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("Loading authorization request…");
  const [busy, setBusy] = useState(false);

  const authorizationId = typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get("authorization_id") || "";

  useEffect(() => {
    if (!supabase) {
      setMessage("OAuth consent is not configured.");
      return;
    }
    if (!authorizationId) {
      setMessage("Missing authorization request.");
      return;
    }

    let active = true;
    (async () => {
      // Supabase recommends resolving the authorization request before checking user state.
      const { data: authDetails, error: detailsError } =
        await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (detailsError || !authDetails) {
        setMessage(detailsError?.message || "Invalid or expired authorization request.");
        return;
      }

      if (!("authorization_id" in authDetails) && "redirect_url" in authDetails) {
        window.location.assign(authDetails.redirect_url);
        return;
      }

      setDetails(authDetails as AuthorizationDetails);
      const { data: userData } = await supabase.auth.getUser();
      if (!active) return;
      setSignedIn(Boolean(userData.user));
      setMessage(userData.user ? "Review this access request." : "Sign in to review this access request.");
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setSignedIn(true);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase, authorizationId]);

  async function signInWithEmail(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !email.trim() || !authorizationId) return;
    setBusy(true);
    const returnUrl = `${window.location.origin}/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: returnUrl },
    });
    setBusy(false);
    setMessage(error ? error.message : "Check your email for the sign-in link, then return here.");
  }

  async function signInWithGitHub() {
    if (!supabase || !authorizationId) return;
    setBusy(true);
    const returnUrl = `${window.location.origin}/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: returnUrl },
    });
    if (error) {
      setBusy(false);
      setMessage(error.message);
    }
  }

  async function decide(decision: "approve" | "deny") {
    if (!supabase || !authorizationId || !signedIn) return;
    setBusy(true);
    const operation = decision === "approve"
      ? supabase.auth.oauth.approveAuthorization(authorizationId)
      : supabase.auth.oauth.denyAuthorization(authorizationId);
    const { data, error } = await operation;
    if (error || !data?.redirect_url) {
      setBusy(false);
      setMessage(error?.message || "Authorization decision could not be completed.");
      return;
    }
    window.location.assign(data.redirect_url);
  }

  const scopes = details?.scope?.split(/\s+/).filter(Boolean) || [];

  return (
    <main style={{ minHeight: "100svh", background: "#070707", color: "#f4f1e9", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <section style={{ width: "min(680px, 100%)", border: "1px solid #2a2a2a", background: "#0d0d0d", padding: "clamp(24px, 6vw, 48px)" }}>
        <p style={{ letterSpacing: ".18em", textTransform: "uppercase", fontSize: 11, color: "#9e9a90" }}>Pandora Machine Gateway</p>
        <h1 style={{ fontSize: "clamp(30px, 7vw, 52px)", lineHeight: 1.02, margin: "18px 0" }}>Authorize machine access</h1>
        <p style={{ color: "#b6b1a6", lineHeight: 1.65 }}>{message}</p>

        {details && (
          <div style={{ marginTop: 28, paddingTop: 24, borderTop: "1px solid #242424" }}>
            <p><strong>Client</strong><br />{details.client?.name || details.client?.id || "Unknown client"}</p>
            <p style={{ overflowWrap: "anywhere" }}><strong>Redirect</strong><br />{details.redirect_uri || "Not provided"}</p>
            <p><strong>Requested scopes</strong></p>
            <ul>{scopes.length ? scopes.map((scope) => <li key={scope}>{scope}</li>) : <li>Basic OAuth authorization</li>}</ul>
            <p style={{ fontSize: 13, color: "#8f8a80" }}>OAuth consent identifies this user/client relationship. It does not automatically grant GitHub, Vercel, Supabase admin, FlutterFlow, or other gateway capabilities.</p>
          </div>
        )}

        {details && !signedIn && (
          <div style={{ marginTop: 28, display: "grid", gap: 14 }}>
            <form onSubmit={signInWithEmail} style={{ display: "grid", gap: 10 }}>
              <label htmlFor="email">Owner email</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ minHeight: 48, padding: "0 14px", background: "#151515", border: "1px solid #343434", color: "white" }} />
              <button disabled={busy} type="submit" style={{ minHeight: 48 }}>Send secure sign-in link</button>
            </form>
            <button disabled={busy} onClick={signInWithGitHub} style={{ minHeight: 48 }}>Sign in with existing GitHub identity</button>
          </div>
        )}

        {details && signedIn && (
          <div style={{ marginTop: 30, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <button disabled={busy} onClick={() => decide("deny")} style={{ minHeight: 50 }}>Deny</button>
            <button disabled={busy} onClick={() => decide("approve")} style={{ minHeight: 50, background: "#f4f1e9", color: "#080808" }}>Approve</button>
          </div>
        )}
      </section>
    </main>
  );
}
