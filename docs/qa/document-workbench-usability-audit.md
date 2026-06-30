# Document Workbench Usability Audit

Date: 2026-06-30

## Audience

The officer-facing workflow is intended for ordinary office staff responsible for
one or a small number of controlled documents such as directives, methodologies
or policies. The UI must explain the next step without exposing registry,
storage, ingestion or audit internals unless the user is in an operational or
admin context.

## Current State

- The main shell, rail, topbar, settings, tables, buttons, selects, metric cards
  and PDF viewer follow the STRATOS/Budget-compatible `@voldzi/stratos-ui`
  adapter.
- Document creation now works as one guided flow: choose a common scenario,
  confirm metadata, upload the original source, create version `1.0` and start
  processing.
- Version upload uses predictable version increments instead of free-form version
  text.
- Inline question-mark help is available on the officer-facing fields where
  users most often need guidance: classification, gestor unit, tags, original
  file, validity, reading mode, citation segmentation, version increment and
  change summary.
- The `document_gestor` role exists for officers who can create and maintain
  their assigned documents without receiving admin, delete, archive or publish
  rights.

## Budget / Stratos UI Alignment

AKB should continue using the local `apps/web/src/components/stratos` adapter as
the single boundary to `@voldzi/stratos-ui`. Remaining local UI should be kept
only when the shared library does not yet expose the needed component.

Already shared through `@voldzi/stratos-ui`:

- `HelpHint` / `FieldLabelWithHelp` for consistent field-level question-mark
  help across AKB, Budget and ProjectFlow.
- `SelectField` support for `description` or `labelAccessory`, so help can be
  rendered next to select labels without app-local positioning.

Remaining candidates to upstream into `@voldzi/stratos-ui`:

- `StratosAnchorButton` for external/download links that still use local
  `.button` aliases.
- Shared role/permission hint components for explaining why an action is hidden
  or disabled.

## Next Usability Step

Move technical upload/session/source URI details behind an operator/admin split:
ordinary gestors should see "Soubor je ověřený" and the next action, while
operations/admin users can expand technical identifiers for diagnostics.
