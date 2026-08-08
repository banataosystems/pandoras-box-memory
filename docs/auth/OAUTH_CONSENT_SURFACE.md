# Pandora Machine Gateway — OAuth Consent Surface

**Status:** required and not yet deployed

## Verified current state

- Supabase OAuth 2.1 Server has been enabled for Memory project `ivmvufhcsezyhczzondn`.
- OAuth authorization UI path is expected at the Memory application's configured Site URL plus `/oauth/consent`.
- The current Memory Site URL host `https://pandorasbox-memory.vercel.app` is reachable.
- `https://pandorasbox-memory.vercel.app/oauth/consent` currently returns HTTP 404.
- Therefore OAuth Server **enabled** is not yet equivalent to ChatGPT/MCP OAuth **usable**.

## Required consent behavior

The consent page must:

1. read `authorization_id` from the query string;
2. use the Memory project's publishable Supabase client only — never a secret/service key in browser code;
3. retrieve authorization details with `supabase.auth.oauth.getAuthorizationDetails(authorization_id)`;
4. require the owner to authenticate if no valid Memory session exists;
5. preserve the exact `authorization_id` through authentication;
6. display the requesting OAuth client name, exact redirect URI and requested scopes;
7. provide explicit Approve and Deny controls;
8. call `approveAuthorization` or `denyAuthorization` only after the human decision;
9. redirect only to the URL returned by Supabase Auth;
10. never display, log, persist or forward access/refresh tokens outside the OAuth client flow.

## Authentication UX

The existing Memory user is the canonical owner identity. Do not silently create a second owner account. If a fresh session is required, use an existing enabled Memory Auth method and ensure it resolves to that same user identity. Any fallback email/passwordless flow must use `shouldCreateUser: false` and must be tested for same-user resolution before production approval.

## Gateway boundary

OAuth consent authenticates the user/client relationship only. It does **not** grant broad gateway access.

After successful OAuth, the access token must contain a `client_id`. The gateway then independently requires a matching active `gateway_principals` record and a matching enabled `gateway_grants` capability.

Initial ChatGPT grant set must be limited to:

- `pandora_memory / health / production`
- `pandora_memory / search / production / namespace:real_life`

No GitHub, Vercel, Supabase admin, PostHog, Resend, ProjectOS mutation or FlutterFlow grant is implied.

## FlutterFlow boundary

FlutterFlow remains registered but disabled. OAuth authorization for ChatGPT must not activate FlutterFlow. FlutterFlow requires a separately proven adapter, server-side token resolution, project-specific grants and read/validate proof before any read capability is enabled. Write/export remain approval-gated and disabled.

## Deployment gate

Do not change the global Supabase Site URL merely to host consent on another origin unless all existing Auth redirects are revalidated. Preferred deployment is `/oauth/consent` on the existing Memory web origin.

The canonical Memory web source must first be recovered into `banataosystems/pandoras-box-memory` or an equivalent exact-source deployment path established. Route-only deployment must not replace or regress unrelated Memory functionality.

## Proof required

1. `/oauth/consent?authorization_id=<valid>` renders successfully;
2. invalid/missing authorization IDs fail safely;
3. logged-out state returns through authentication to the same authorization request;
4. consent shows exact client + scopes;
5. Deny path returns expected OAuth denial;
6. Approve path produces a token containing the expected `client_id`;
7. gateway principal/grants are provisioned only for Pandora health/search;
8. `memory_health` succeeds;
9. `memory_search` succeeds for approved canon;
10. wrong client, missing grant, wrong resource and disabled FlutterFlow actions fail closed;
11. gateway audit rows record decisions without bearer tokens;
12. exact source/deployment/rollback evidence is recorded.
