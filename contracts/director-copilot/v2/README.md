# Director Copilot V2 contract pin

AKB pins the additive wire contract `director-copilot-2`, revision `2.0.3`.
The files in this directory are byte-identical copies from STRATOS commit
`663e71820b93c5801a27f393eae63a24ba118745`. The corresponding AIIP source
revision is `32ee68228a9ac29c945f4a876c67dbec878a86ad`.

`apps/web/scripts/check-director-copilot-v2-contracts.mjs` verifies all six
SHA-256 values and the byte identity of the five runtime schema copies. The
check is part of the production web build. Contract drift therefore fails the
build before AKB can call a source.

The V1 contract remains available and operational. V2 activation is controlled
by `AKL_DIRECTOR_COPILOT_V2_MODE=disabled|shadow|active` and defaults to
`disabled`.
