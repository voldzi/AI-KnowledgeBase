# 0023: Consume the STRATOS 0.5.1 release artifact

Accepted 2026-09-06 by the product owner's explicit STRATOS handoff.

STRATOS delivered 0.5.1 as an immutable tarball rather than an npm publication.
AKB consumes the exact artifact under `apps/web/vendor/stratos-ui/` using a
file dependency and pnpm lockfile integrity. The tarball, manifest, package
declaration and lockfile belong to the same consumer change. Docker copies
the artifact before its frozen dependency install. Builds must not depend on
the sibling STRATOS checkout or rebuild/fork the package sources.

Artifact SHA-256:
`9b8d05857f2f61013419c449391cd39a7a3c7976040c6a5ae1cec5c795edc7ee`.
The release manifest records the size and npm SHA-512 integrity. Both were
verified before installation. STRATOS implementation commit:
`2e15bba7b2b13559dec431393a69de65c41ae21f`.

This is an approved distribution exception to the general public npm standard,
not a second UI implementation. A future registry release requires an explicit
dependency update and normal validation; there is no automatic fallback.
No package publication or production deployment is part of this change.
