# ADR 0014: Server-side browser sessions

## Status

Accepted.

## Context

AKB uses OIDC Authorization Code Flow with PKCE, but browser persistence must
not expose OIDC access or refresh tokens to browser storage. A browser cookie
also cannot be the authoritative source of current capabilities, scopes or
Information Policy.

## Decision

After the OIDC callback, AKB creates a database-backed server session. The
browser receives only a random 256-bit selector. The database stores its
SHA-256 hash and an encrypted OIDC token payload. Encryption and internal store
authentication use separate operator-owned keys outside Git and Compose.

The cookie is `HttpOnly`, `Secure`, `SameSite=Lax` and limited to the AKB base
path. A normal login uses a browser-session cookie. An explicitly trusted
device uses a persistent cookie with a 90-day absolute limit. Every server
session has a 30-day inactivity limit. OIDC identity is refreshed or verified
at least every 15 minutes. Current STRATOS access projection and Information
Policy remain authoritative for every relevant request.

Logout revokes the local server session before attempting remote refresh-token
revocation. Users can revoke one device or all their sessions. Undecryptable,
expired, inactive or identity-invalid sessions fail closed.

## Consequences

- Browser storage never contains OIDC access or refresh tokens.
- Web instances require the same session encryption key and Registry store
  signing secret.
- Key rotation deliberately invalidates sessions that cannot be decrypted.
- The Registry database and migration must be available before web login.
- Session audit contains internal session identifiers and bounded event
  metadata, never selectors, tokens or document and chat content.
