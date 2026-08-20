// Syntactic authentication-material gates for public web ingress.
//
// These helpers deliberately do not claim cryptographic verification. Their job
// is narrower: reject missing, malformed, whitespace-bearing, or unreasonably
// large credentials before a route reads a request body or starts an upstream
// request. The canonical Edge boundaries still perform full issuer, audience,
// subject, signature, principal, scope, and resource authorization.

export type HeaderReader = {
  get(name: string): string | null;
};

export const MAX_AUTH_TOKEN_LENGTH = 16 * 1024;

// RFC 6750 b64token syntax. JWTs are a strict subset of this alphabet.
const BEARER_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;

function boundedToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const token = value.trim();
  if (!token || token.length > MAX_AUTH_TOKEN_LENGTH) return null;
  return BEARER_TOKEN.test(token) ? token : null;
}

/** Return a normalized bearer token, or null for every malformed header. */
export function bearerToken(headers: HeaderReader): string | null {
  const authorization = headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer[ \t]+(.+)$/i.exec(authorization.trim());
  if (!match) return null;
  return boundedToken(match[1]);
}

/**
 * Accept the dedicated ProjectOS workload header first, then a syntactically
 * valid Bearer fallback. Full Vercel OIDC verification remains at the Edge
 * bridge and is never replaced by this early material gate.
 */
export function projectOSWorkloadToken(headers: HeaderReader): string | null {
  const dedicatedHeader = headers.get("x-pandora-vercel-oidc");
  // Conflicting credential channels are not silently repaired. When the
  // dedicated header is present, it is authoritative and malformed material
  // fails closed instead of falling back to Authorization.
  if (dedicatedHeader !== null) return boundedToken(dedicatedHeader);
  return bearerToken(headers);
}

/** Normalize a valid Authorization header for forwarding. */
export function normalizedBearerAuthorization(
  headers: HeaderReader,
): string | null {
  const token = bearerToken(headers);
  return token ? `Bearer ${token}` : null;
}
