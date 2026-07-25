# Director Copilot V2 contract pin

AKB pins the additive wire contract `director-copilot-2`, revision `2.0.2`.
The files in this directory are byte-identical copies from STRATOS commit
`3190266e21c9f45b9733c62debb2763ee88b1eed`. The corresponding AIIP source
revision is `d6403cb1c5bbf87032683647e68e5f5a7d473752`.

`apps/web/scripts/check-director-copilot-v2-contracts.mjs` verifies all six
SHA-256 values and the byte identity of the five runtime schema copies. The
check is part of the production web build. Contract drift therefore fails the
build before AKB can call a source.

The V1 contract remains available and operational. V2 activation is controlled
by `AKL_DIRECTOR_COPILOT_V2_MODE=disabled|shadow|active` and defaults to
`disabled`.
