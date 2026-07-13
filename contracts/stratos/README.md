# STRATOS Contract Snapshot

This directory is the immutable AKB-owned snapshot accepted for G2/G3:

- access: `stratos-access-1`
- information policy: `information-policy-2.0.0`
- integration envelope: `stratos-integration-envelope-1`
- conformance fixtures: `conformance-1.0.0`

The source is the sibling STRATOS repository `contracts/` tree as accepted on
2026-07-12. AKB does not edit the copied schemas or fixture expectations.
Changes require a new version, an impact review, and a synchronized snapshot.

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

The expected SHA-256 values are held in the verifier. The snapshot contains no
credentials, tenant data, prompts, answers, or document content.
