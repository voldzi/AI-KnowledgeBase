# Director Copilot V2 contract pin

AKB pins the additive wire contract `director-copilot-2`, revision `2.0.4`.
This revision contains only the active Budget, ProjectFlow and ArchFlow tools.

`apps/web/scripts/check-director-copilot-v2-contracts.mjs` verifies all six
SHA-256 values and the byte identity of the five runtime schema copies. The
check is part of the production web build. Contract drift therefore fails the
build before AKB can call a source.

V2 activation is controlled by `AKL_DIRECTOR_COPILOT_ENABLED=true`. After the
production acceptance, V2 is the sole runtime path. It does not use a V1
fallback, shadow mode, or baseline comparison. Setting the flag to `false`
keeps recognized live-data requests fail-closed.
