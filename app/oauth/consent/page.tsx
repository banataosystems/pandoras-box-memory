"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase/client";

type AuthorizationDetails = {
  authorization_id?: string;
  redirect_url?: string;
  redirect_uri?: string;
  scope?: string;
  client?: { id?: string; name?: string; uri?: string };
};

export default function OAuthConsentPage() {
  const supabase = useMemo(() => hasSupabaseBrowserConfig() ? createSupabaseBrowserClient() : null, []);
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("Loading authorization request…");
  const [busy, setBusy] = useState(false);
  const authorizationId = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("authorization_id") || "";

  useEffect(() => {
    if (!supabase) { setMessage("OAuth consent is not configured."); return; }
    if (!authorizationId) { setMessage("Missing authorization request."); return; }
    let active = true;
    (async () => {
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error || !data) { setMessage(error?.message || "Invalid or expired authorization request."); return; }
      if (!("authorization_id" in data) && "redirect_url" in data) { window.location.assign(data.redirect_url); return; }
      setDetails(data as AuthorizationDetails);
      const { data: userData } = await supabase.auth.getUser();
      if (!active) return;
      setSignedIn(Boolean(userData.user));
      setMessage(userData.user ? "Review this access request." : "Sign in to review this access request.");
    })();
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session?.user)));
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, [supabase, authorizationId]);

  async function signInWithEmail(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !email.trim() || !authorizationId) return;
    setBusy(true);
    const returnUrl = `${window.location.origin}/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: returnUrl } });
    setBusy(false);
    setMessage(error ? error.message : "A secure sign-in email was requested. Use that email once; do not request duplicates while it is valid.");
  }

  async function decide(decision: "approve" | "deny") {
    if (!supabase || !authorizationId || !signedIn) return;
    setBusy(true);
    const operation = decision === "approve" ? supabase.auth.oauth.approveAuthorization(authorizationId) : supabase.auth.oauth.denyAuthorization(authorizationId);
    const { data, error } = await operation;
    if (error || !data?.redirect_url) { setBusy(false); setMessage(error?.message || "Authorization decision could not be completed."); return; }
    window.location.assign(data.redirect_url);
  }

  const scopes = details?.scope?.split(/\s+/).filter(Boolean) || [];
  return <main className="page-shell"><section className="panel">
    <p className="eyebrow">Pandora Machine Gateway</p>
    <h1>Authorize machine access</h1>
    <p className="muted">{message}</p>
    {details && <div className="details">
      <p><strong>Client</strong><br />{details.client?.name || details.client?.id || "Unknown client"}</p>
      <p className="wrap"><strong>Redirect</strong><br />{details.redirect_uri || "Not provided"}</p>
      <p><strong>Requested scopes</strong></p><ul>{scopes.length ? scopes.map(scope => <li key={scope}>{scope}</li>) : <li>Basic OAuth authorization</li>}</ul>
      <p className="fine">Consent does not grant GitHub, Vercel, Supabase admin, FlutterFlow, or any other provider capability.</p>
    </div>}
    {details && !signedIn && <form className="stack" onSubmit={signInWithEmail}>
      <label htmlFor="email">Existing owner email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
      <button disabled={busy} type="submit">{busy ? "Sending…" : "Send secure sign-in email"}</button>
      <p className="fine">New account creation and anonymous login are disabled on this recovery surface.</p>
    </form>}
    {details && signedIn && <div className="actions"><button disabled={busy} onClick={() => decide("deny")}>Deny</button><button className="primary" disabled={busy} onClick={() => decide("approve")}>Approve</button></div>}
  </section></main>;
}
