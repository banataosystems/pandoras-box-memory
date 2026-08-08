# Pandora OAuth Surfaces

**Status:** discovery and OAuth routes are live, but current production dynamic client registration is blocked; new Supabase-gateway consent UI remains future work

## Immediate ChatGPT reconnection path

The production Memory application exposes an OAuth-protected MCP resource at:

`https://pandorasbox-memory.vercel.app/api/mcp`

Its live OAuth discovery points to the same Memory application as authorization server and exposes:

- `/oauth/authorize`
- `/oauth/token`
- `/oauth/register`
- `/auth/login`
- `/auth/callback`

The route set is application-level reachable and not intercepted by Vercel SSO. Discovery advertises MCP OAuth, PKCE S256, dynamic registration, refresh tokens/offline access, and `pandora.memory.read` / `pandora.memory.write` scopes.

However, current production is **not yet a working ChatGPT OAuth path**. On 2026-08-09 PHT, ChatGPT dynamic client registration reached `/oauth/register` and received HTTP 500. Vercel runtime evidence for the production deployment shows the exact error `mcp_oauth_signing_secret_missing` on six registration attempts.

Historical evidence shows `/oauth/register` returned HTTP 201 twice on an earlier production deployment, so DCR has previously worked on this Vercel project. The immediate repair is to restore the required production signing-secret configuration securely, then repeat the full ChatGPT OAuth flow.

Do not block that repair on the separate Supabase OAuth consent overlay, and do not call direct Memory OAuth production-verified until DCR, authorization, refresh access, authenticated health/search, and negative identity tests all pass.

## Separate long-term gateway OAuth path

Supabase OAuth 2.1 Server has also been enabled for Memory project `ivmvufhcsezyhczzondn` to support the reusable `pandora-machine-gateway`.

That new OAuth server requires a custom authorization UI at the configured Site URL + Authorization Path. A source-controlled recovery overlay exists at:

`recovery/web-overlay/app/oauth/consent/page.tsx`

The corresponding `/oauth/consent` route is **not deployed** in the current Memory web application and currently returns 404.

That route is separate from the current direct Memory `/oauth/authorize` implementation.

## New consent-overlay requirements

When the Supabase-gateway OAuth path is activated, its consent page must:

1. read `authorization_id` from the query string;
2. use only the Memory project's publishable Supabase client in browser code;
3. retrieve authorization details through Supabase OAuth APIs;
4. preserve the exact authorization request through owner authentication;
5. display exact requesting client, redirect URI, and scopes;
6. require explicit Approve or Deny;
7. redirect only to the URL returned by Supabase Auth;
8. never expose service keys, bearer tokens, refresh tokens, or provider credentials.

The existing Memory user remains the canonical owner identity. Any email fallback must use `shouldCreateUser: false` and be verified to resolve to the same owner before production activation.

## Gateway authorization boundary

OAuth consent authenticates a user/client relationship only. It never creates broad machine privileges.

The shared gateway separately requires:

- active principal;
- enabled service/action capability;
- matching environment;
- matching resource grant where required;
- downstream provider authorization/RLS.

Initial gateway OAuth grants must remain limited to Pandora health/search until separately verified.

## FlutterFlow boundary

FlutterFlow is registered in the shared gateway but every FlutterFlow action remains disabled. `yaml.update` and `code.export` are independently approval-required.

ChatGPT authorization to Pandora must not activate FlutterFlow, GitHub, Vercel, Supabase admin, PostHog, Resend, or other provider capabilities.

## Proof required for direct Memory reconnection

- production signing-secret configuration is restored without secret disclosure;
- ChatGPT discovers the live Memory OAuth server;
- `/oauth/register` returns a valid DCR success response;
- dynamic registration/authorization completes;
- owner login resolves to the expected Memory identity;
- refresh/offline access is issued as expected;
- authenticated Pandora health/search succeeds;
- wrong/missing client identity remains denied;
- exact production endpoint/deployment and rollback evidence are recorded.

## Proof required before new gateway OAuth activation

- `/oauth/consent?authorization_id=<valid>` is deployed and renders;
- invalid/missing IDs fail safely;
- logged-out state returns to the same authorization request;
- exact client/scopes are displayed;
- approve/deny behavior is verified;
- token includes expected `client_id`;
- gateway grants only intended capabilities;
- wrong client/resource and disabled FlutterFlow actions fail closed;
- audit events contain no token value;
- source/deployment/rollback evidence is recorded.
