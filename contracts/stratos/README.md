# STRATOS Contract Snapshot

This directory is the immutable AKB-owned snapshot accepted for G2/G3:

- legacy access catalog: `stratos-access-1`
- active interactive projection: `stratos-access-projection-2`, revision `2.1.0`
- information policy: `information-policy-2.0.0`
- integration envelope: `stratos-integration-envelope-1`
- conformance fixtures: `conformance-1.0.0`

The source is the sibling STRATOS repository `contracts/` tree as accepted on
2026-07-12. AKB does not edit the copied schemas or fixture expectations.
Changes require a new version, an impact review, and a synchronized snapshot.

The V2 projection schema and metadata synchronized on 2026-09-16 are stored
under `access-governance/v2/`. They are byte-identical to the active STRATOS
contract. AKB pins schema, revision, status, schema digest, capability catalog,
organization and the maximum 15-minute validity window. Authorization must be
satisfied by one entitlement; AKB never unions a capability from one
entitlement with a scope from another.

Verify JSON validity and the accepted byte-level digests with:

```bash
python3 scripts/verify_stratos_contract_snapshot.py
```

When the STRATOS repository is available locally, also prove that the snapshot
is identical to its source:

```bash
python3 scripts/verify_stratos_contract_snapshot.py \
  --source-root "/Users/voldzi/Documents/Development/18 2026/STRATOS/contracts"
```

For the independently versioned official-source contract, verify only its
manifests and authority OpenAPI against the current sibling checkout with:

```bash
python3 scripts/verify_stratos_contract_snapshot.py \
  --official-source-only \
  --source-root "/Users/voldzi/Developer/18 2026/STRATOS/contracts"
```

The expected SHA-256 values are held in the verifier. The snapshot contains no
credentials, tenant data, prompts, answers, or document content.

The governed official-source integration synchronized on 2026-09-13 is stored
separately under `official-sources/`:

- `stratos-authority.openapi.json` — STRATOS authority contract for Czech-law
  revision 2 (the supplied OpenAPI retains `info.version` 1.1.0), SHA-256
  `905782427a95f3186e0cfe1e28d0c8bb4a654534741639863f84efb897ac0634`;
- `czech-law-pilot.v1.json` — exact ten-law pilot manifest, SHA-256
  `c37e92765053744fa35025eede613672e1ab556cebb9c5d72d0c2c1cd552cae6`;
- `czech-law-pilot.v2.json` — exact 100-root rollout manifest, SHA-256
  `3cc9926fe59b3aa67d8bdbe9b64dea75cc4df68cc54e6353dae4a2f7ecc22503`.

These files are byte-identical to STRATOS commit
`96da8fc8bb7a2a01b605c7e74ecfb0f674114e34`. Revision 1 remains immutable;
revision 2 is the current jointly verified contract and requires explicit
STRATOS activation before AKB synchronization is enabled.
