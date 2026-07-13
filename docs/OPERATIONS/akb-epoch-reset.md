# Guarded AKB Epoch Reset

## Purpose

`tools/reset_akb_epoch.py` is the AKB owner command for G5/G7. It clears AKB
Registry data including audit, document object storage, Qdrant, OpenSearch,
ingestion jobs, and evaluation datasets/reports, then proves zero state. It does
not reset other STRATOS applications, Keycloak, monitoring, networking, or host
configuration.

Do not run this command against production before G4, two successful G5
rehearsals, G6 isolated restore, and the coordinated G7 approval.

## Dry Run

Dry-run is the default and performs inventory only. Always point it explicitly
at the disposable integration compose/env files:

```bash
python3 tools/reset_akb_epoch.py \
  --compose-file <g4-compose-file> \
  --env-file <g4-env-file> \
  --object-storage-root <g4-object-storage-root> \
  --report reports/g5-reset-rehearsal-1-dry-run.json
```

The report records counts and a small set of technical ids; it never records
document metadata, bodies, prompts, answers, tokens, or credentials.

## Apply Guards

Apply requires all three independent controls:

1. `--apply`;
2. exact confirmation `--confirm RESET-AKB-EPOCH`;
3. a separately prepared backup verification manifest.

The manifest contract is:

```json
{
  "schema_version": "akb-backup-verification-1",
  "backup_id": "g5-rehearsal-1",
  "backup_sha256": "<64 lowercase hexadecimal characters>",
  "backup_verified": true,
  "isolated_restore_tested": true
}
```

The apply command for a disposable environment is:

```bash
python3 tools/reset_akb_epoch.py \
  --apply \
  --confirm RESET-AKB-EPOCH \
  --backup-manifest <verified-backup-manifest.json> \
  --compose-file <g4-compose-file> \
  --env-file <g4-env-file> \
  --object-storage-root <g4-object-storage-root> \
  --report reports/g5-reset-rehearsal-1.json
```

Use a distinct report for rehearsal 2. A failed component or unavailable
ingestion/evaluation store makes zero-state verification fail and returns a
non-zero exit status. Never bypass a failure by editing the resulting report.

## Acceptance Evidence

- before/after counts for every Registry table;
- object file and byte counts;
- Qdrant and OpenSearch counts;
- ingestion and evaluation file counts;
- no old document, version, audit, chunk, or source identifier retrievable;
- health/readiness and new-epoch upload/index/search/AI/citation smoke;
- separate G6 restore evidence.

The reset report and backup manifest are operational evidence and must be kept
outside source control if they contain environment identifiers.
