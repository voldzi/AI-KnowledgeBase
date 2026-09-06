# 0022: Separate AKB and Chat browser session namespaces

Accepted 2026-09-06 for the clean target environment.

AKB at `/akb` and standalone Chat at `/` can run on the same host with different
ports. Ports do not isolate cookies and the old shared names caused ambiguous
session selection. Both applications now own a complete namespace:
`akb_platform_*` and `akb_chat_*`, selected by the configured web profile.
This includes the opaque session selector, central synchronization marker,
automatic-login attempt, explicit logout marker, OIDC state and PKCE verifier.
Path, HttpOnly, SameSite and TLS requirements remain unchanged. Old names are
not accepted as fallback authority. Existing browser sessions require a new
central SSO entry; no document/data migration is involved.

A session read for the wrong OIDC client returns no authority without revoking
the other client's session. Issuer, subject, client and central session binding
remain mandatory. Revocation of a selected device/session remains an explicit
authorized operation.

The shared STRATOS monitor rechecks visible AKB and Chat every 60 seconds and
on focus/return. Failure unmounts the protected shell and children. A changed
subject, capability or application/scope projection reloads the server context.
An initial server page still owns its OIDC redirect. Lifecycle cancellation
does not create a persistent logout marker. That marker belongs to explicit
logout only. Monitor requests bypass projection caches, forward the session
probe header and do not extend the AKB BFF idle deadline or last activity.

The monitor is not backend authorization or back-channel logout. Other BFFs
detect a central logout during token refresh/identity validation; normal maximum
identity freshness remains 15 minutes plus UI observation and request time.
Suspended tabs recheck upon return. Measured local results must be reported
separately from the configured bound.
