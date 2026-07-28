# Director Copilot V1 retirement

## Scope

This AKB-only cleanup retires the V1 Director Copilot runtime after STRATOS
accepted `director-copilot-2` revision `2.0.3` in production.

Removed from AKB:

- V1 query execution, domain-tool client and orchestration;
- V1 browser-response planning and V1 pending/unavailable fallbacks;
- V1 baseline and shadow comparison audit paths;
- V1 source-contract fixtures, schemas, OpenAPI fragment and V1-only tests;
- `AKL_DIRECTOR_COPILOT_V2_MODE` and its Compose propagation.

Retained:

- V2 manifests, contract pin, exact-audience service identity and audit events;
- V2 conversation persistence, reauthorization and independently authorized
  document citations;
- fail-closed behavior: a disabled, denied or unavailable live source never
  falls back to document RAG;
- all STRATOS read-only endpoints, which are owned and retired separately by
  STRATOS only after this AKB release is verified.

## Runtime configuration

`AKL_DIRECTOR_COPILOT_ENABLED=true` enables the sole V2 path. It requires all
four source URLs, the dedicated file-backed service credential in production,
and the pinned V2 manifest catalog. Setting it to `false` is the controlled
kill switch and returns a bounded unavailable response for recognized live-data
requests.

## Post-deployment verification

1. Confirm `/akb/api/health` returns `200` and `/akb/api/ready` returns `200`
   with `director_copilot_v2: ready`.
2. Submit one Budget, ProjectFlow, ArchFlow and AIIP live-data request using a
   test account. Confirm V2 audit event
   `assistant.director_copilot_v2_returned` and no document-RAG fallback.
3. Reopen the thread and confirm V2 reauthorization preserves data only while
   the current access projection and Information Policy still allow it.
4. Inspect AKB structured integration logs and Registry audit metadata for the
   release window. There must be no V1 tool identifier, V1 contract version or
   V1 baseline/shadow event.

Do not delete or disable the external STRATOS read-only endpoints until these
checks pass and STRATOS records the matching retirement change.
