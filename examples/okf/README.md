# STRATOS OKF Examples

This folder contains reference Open Knowledge Format bundles for AKB.

Validate the STRATOS example bundle:

```bash
python3 tools/okf_profile.py validate \
  --source examples/okf/stratos \
  --report reports/okf_example_validate_report.json
```

Create an AKB import plan:

```bash
python3 tools/okf_profile.py plan-import \
  --source examples/okf/stratos \
  --report reports/okf_example_import_plan.json
```

Dry-run import through the existing AKB Markdown importer:

```bash
python3 tools/import_docs_folder.py \
  --source examples/okf/stratos \
  --manifest docs/import-manifest.yaml \
  --mode reindex \
  --okf-profile \
  --dry-run \
  --report reports/okf_example_docs_import_report.json
```

The examples are intentionally small. They show how STRATOS applications can
publish portable concepts while AKB remains responsible for source files,
authorization, ingestion, citations, audit, and employee chat retrieval.
