"use client";

import { FormEvent, useMemo, useState } from "react";
import { createSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = useMemo(() => hasSupabaseBrowserConfig() ? createSupabaseBrowserClient() : null, []);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("Use the existing Pandora owner account. New account creation is disabled.");
  const [busy, setBusy] = useState(false);
  const error = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("error") || "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !email.trim()) return;
    setBusy(true);
    const next = typeof window === "undefined" ? "/" : new URLSearchParams(window.location.search).get("next") || "/";
    const callback = new URL("/auth/confirm", window.location.origin);
    callback.searchParams.set("next", next.startsWith("/") && !next.startsWith("//") ? next : "/");
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: callback.toString() },
    });
    setBusy(false);
    if (authError) {
      setMessage(authError.status === 429 ? "A sign-in email was requested too recently. Wait for the current rate-limit window." : "The secure sign-in email could not be requested.");
      return;
    }
    setMessage("A secure sign-in email was requested. Use that email once; do not request duplicates while it is valid.");
  }

  return <main className="page-shell"><section className="panel">
    <p className="eyebrow">Pandora Memory</p><h1>Owner sign in</h1>
    <p className="muted">{error ? `Authentication state: ${error}` : message}</p>
    <form className="stack" onSubmit={submit}><label htmlFor="email">Existing owner email</label><input id="email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /><button className="primary" disabled={busy || !supabase}>{busy ? "Sending…" : "Send secure sign-in email"}</button></form>
    <p className="fine">GitHub and anonymous login are intentionally absent from this recovery surface until independently re-verified.</p>
  </section></main>;
}
