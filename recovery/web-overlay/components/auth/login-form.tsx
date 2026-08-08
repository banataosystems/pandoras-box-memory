"use client";

import { useMemo, useState } from "react";
import { createSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase/client";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const githubEnabled = process.env.NEXT_PUBLIC_PANDORA_GITHUB_AUTH_ENABLED === "true";

type LoginState = "idle" | "submitting" | "sent" | "error";

function safeNextPath(value?: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function getRedirectUrl(nextPath?: string) {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  const origin = typeof window === "undefined" ? configuredUrl : window.location.origin;
  const baseUrl = configuredUrl || origin;
  const callbackUrl = new URL("/auth/confirm", baseUrl);
  callbackUrl.searchParams.set("next", safeNextPath(nextPath));
  return callbackUrl.toString();
}

function explainOtpError(error: { status?: number; code?: string; message?: string }) {
  if (error.status === 429 || error.code === "over_email_send_rate_limit") {
    return "A sign-in email was requested too recently. Wait for the current rate-limit window instead of requesting another link.";
  }
  return "The secure sign-in email could not be requested. The existing owner account was not changed.";
}

export function LoginForm({ nextPath = "/dashboard" }: Readonly<{ nextPath?: string }>) {
  const returnPath = safeNextPath(nextPath);
  const hasConfig = hasSupabaseBrowserConfig();
  const supabase = useMemo(() => (hasConfig ? createSupabaseBrowserClient() : null), [hasConfig]);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<LoginState>("idle");
  const [message, setMessage] = useState("");

  async function handleGithubLogin() {
    if (!githubEnabled) return;
    setState("submitting");
    setMessage("Redirecting to GitHub…");

    if (!supabase) {
      setState("error");
      setMessage("Supabase public authentication configuration is unavailable.");
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: getRedirectUrl(returnPath) },
    });

    if (error) {
      setState("error");
      setMessage("GitHub owner login is currently unavailable. Use the secure email path instead.");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!emailPattern.test(normalizedEmail)) {
      setState("error");
      setMessage("Enter a valid owner email address.");
      return;
    }

    setState("submitting");
    setMessage("");

    if (!supabase) {
      setState("error");
      setMessage("Supabase public authentication configuration is unavailable.");
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: getRedirectUrl(returnPath),
      },
    });

    if (error) {
      setState("error");
      setMessage(explainOtpError(error));
      return;
    }

    setState("sent");
    setMessage("One secure sign-in email was requested. Use that email; do not request another while this one is valid.");
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      {githubEnabled ? (
        <>
          <button
            className="button-link button-link--primary"
            disabled={state === "submitting" || !hasConfig}
            onClick={handleGithubLogin}
            type="button"
          >
            {state === "submitting" ? "Connecting…" : "Continue with GitHub"}
          </button>
          <p className="auth-note">GitHub login is shown only when the production provider has been explicitly re-enabled.</p>
        </>
      ) : null}

      <label htmlFor="email">Owner email address</label>
      <input
        autoComplete="email"
        id="email"
        inputMode="email"
        name="email"
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        required
        type="email"
        value={email}
      />
      <button className="button-link" disabled={state === "submitting" || !hasConfig} type="submit">
        {state === "submitting" ? "Sending…" : "Send secure sign-in email"}
      </button>
      <p className="auth-note">Anonymous login is intentionally not offered on this recovery surface.</p>
      {!hasConfig ? <p className="auth-form__message auth-form__message--error">Supabase public authentication variables are required.</p> : null}
      {message ? <p className={`auth-form__message auth-form__message--${state}`}>{message}</p> : null}
    </form>
  );
}
