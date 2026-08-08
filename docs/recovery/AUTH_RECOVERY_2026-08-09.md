# Pandora Memory — Owner Auth Recovery (2026-08-09 PHT)

## Verified live failures

Fresh Supabase Auth evidence proves three separate owner-login surface problems:

1. GitHub social login reaches the configured external GitHub provider but the browser lands on a GitHub 404. Treat GitHub owner login as unavailable until its OAuth application/client is independently re-established.
2. A magic-link request succeeded and the email was sent. The subsequent verification succeeded, but the final PKCE token exchange failed with `bad_code_verifier` because the verifier context did not match the browser context that completed the link.
3. Repeated magic-link requests then hit `over_email_send_rate_limit` / HTTP 429. The production UI incorrectly rendered a generic configuration error instead of the actual rate-limit state.
4. Anonymous sign-in is disabled in Supabase, but the recovered UI exposed an anonymous-login control.

## Live control-plane repair already applied

The canonical existing owner identity remains unchanged. The owner's `auth.users.raw_app_meta_data` was augmented with:

- `role = env_admin`
- `adminCapabilities = ["env:admin"]`

Existing provider metadata was preserved. This change is recorded in the private recovery audit table `private.pandora_recovery_auth_changes` and is intended only to make the existing owner eligible for the Env Broker after successful authentication.

The live Env Broker project target was also corrected from stale pre-migration Vercel identifiers to:

- Vercel project: `prj_brg3BJDcHfSftHH84NhnFtDJAnDO`
- Vercel team: `team_IcdJUnzLi5wUN1GD8ALHyjF7`
- production hostname: `pandorasbox-memory.vercel.app`

No bearer token or provider secret was written to project tables.

## Mobile-safe login recovery overlay

Source-controlled recovery overlay now includes:

- `recovery/web-overlay/components/auth/login-form.tsx`
  - GitHub is hidden unless explicitly re-enabled by configuration;
  - anonymous login is removed;
  - owner email uses `shouldCreateUser: false`;
  - HTTP 429 / `over_email_send_rate_limit` receives an accurate message.
- `recovery/web-overlay/app/auth/confirm/route.ts`
  - verifies a Supabase token hash server-side with `verifyOtp`;
  - does not depend on the browser-local PKCE verifier created when the email was requested;
  - allows only safe same-origin/relative return destinations;
  - fails closed on missing/invalid token material.

## Required Supabase email template for this overlay

The hosted Magic Link template must use the token-hash confirmation endpoint rather than the default PKCE confirmation redirect. Target shape:

```html
<h2>Sign in to Pandora Memory</h2>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&redirect_to={{ .RedirectTo }}">Sign in</a></p>
```

The exact hosted template and URL allowlist must be changed only through an authorized Supabase control-plane path and then tested on the production hostname.

## OAuth DCR secret recovery

A new production MCP OAuth signing secret has been generated **inside Supabase Vault** without exposing the raw value to chat, GitHub, logs, screenshots, analytics, or semantic Memory.

Vault name:

`pandora_runtime:PANDORA_MCP_OAUTH_SIGNING_SECRET`

The Env Broker catalog records `PANDORA_MCP_OAUTH_SIGNING_SECRET` as a required generated production token. Its key version is currently `vault_staged`, not deployed to Vercel.

The secret is therefore **generated and durably staged**, but current Vercel production still cannot consume it. Production DCR remains blocked until either:

1. the Vercel environment receives the staged secret through an authorized secret-management path and the app is redeployed; or
2. exact production source is recovered and changed so the OAuth implementation resolves the signing key server-side from the approved secret store instead of requiring a Vercel environment value.

## Remaining blockers

- The connected Vercel control surface in this session exposes deployments/logs/fetch/deploy but no environment-variable mutation or production alias promotion operation.
- No Vercel management bearer token is present in Supabase Vault, so the live Env Broker cannot be driven server-to-server from Supabase without first establishing that provider credential.
- The preserved source archive is not proven byte-for-byte identical to the active production deployment. Do not blindly deploy it over production.
- The GitHub provider client must be re-established or remain disabled.
- The token-hash email template and recovery overlay are not yet deployed/production-verified.

## Exit proof

Do not mark owner auth or external MCP as repaired until all of the following are proven:

- owner email login succeeds on the production hostname without PKCE verifier mismatch;
- owner session is recognized as `env_admin` by `/admin/env`;
- GitHub login is either repaired and verified or absent from the production UI;
- anonymous login is absent while the provider is disabled;
- rate-limit failures display the real bounded error;
- production `/oauth/register` returns a valid DCR response;
- ChatGPT authorization completes and authenticated Pandora health/search succeeds;
- wrong/missing identity remains denied;
- rollback/source/deployment evidence is recorded.
