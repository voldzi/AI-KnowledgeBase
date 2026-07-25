# STRATOS Domain Tool Catalog v1

This contract describes source-owned read-only tools, metric semantics,
canonical entity identifiers and approved cross-application relationships for
the AKB Director Copilot.

The catalog is descriptive. It never grants access and it never replaces the
fresh STRATOS access projection, source-side authorization or Information
Policy enforcement.

AKB currently carries a reviewed local catalog snapshot. STRATOS is expected to
adopt ownership of the catalog and publish immutable versions after all source
applications accept their entries.

`connected` means that AKB may execute the tool when its endpoint is configured
and the actor is authorized. `contract_ready` means that AKB understands the
proposed contract but must not call the source until STRATOS changes the
published status and the source endpoint passes acceptance tests.
