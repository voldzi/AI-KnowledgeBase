# STRATOS Shell QA

## Scope

This protocol verifies the AKB integration with `@voldzi/stratos-ui@0.3.29`.
The shared package owns shell layout, rail, workspace drawer, backdrop,
popover behavior, focus management and mobile bottom navigation. AKB owns
route selection, role filtering, labels and commands.

## Automated Contract

`apps/web/e2e/document-workbench.spec.ts` verifies:

- workspace navigation closes after a single link activation,
- mobile `AppRail` activates another module with one tap,
- drawer closes by its close button, backdrop and Escape,
- focus returns to the trigger after each close path,
- app switcher, breadcrumb and status group are present and keyboard operable,
- the shared app catalog keeps AI KnowledgeBase in the trigger but omits it
  from the destination menu,
- app-switcher Arrow Up/Down, Home/End and Escape behavior restores focus,
- the app switcher opens with one tap at 390 px,
- compact tablet rail opens the overlay sidebar,
- desktop rail routing does not duplicate the configured base path.

Role visibility remains covered by `apps/web/tests/authorization.test.ts`.
Server-side route guards remain authoritative; shell filtering is only a UI
projection of the same role policy.

## Viewport Matrix

| Width | Expected shell behavior |
| ---: | --- |
| 390 px | Single content column, topbar menu trigger, bottom module rail, overlay drawer and backdrop. |
| 768 px | Mobile shell contract remains active without horizontal page overflow. |
| 1024 px | Compact shell keeps the desktop rail and opens workspace navigation as an overlay. |
| 1440 px | Rail, workspace sidebar and content render as the standard three-column shell. |

For every viewport verify that text does not overlap, content remains reachable,
the active route is visible, and popovers are not clipped by the shell.

## Verification Record

Verified locally on 2026-07-12 against `@voldzi/stratos-ui@0.3.29`:

| Check | Result |
| --- | --- |
| TypeScript and production build | Passed |
| Web unit and authorization tests | 150/150 passed |
| Document registry contextual actions | No selection/create and one selection/version passed |
| Shared `FileDropzone` workflow | New document and new version passed |
| Shared `WorkflowParticipants` | One gestor plus distinct approver, controlled Registry assignments passed |
| Document workflow E2E `DW-01` to `DW-03` | 3/3 passed |
| Workflow horizontal overflow | 390 and 1440 px passed |
| Targeted `DW-15*` shell scenarios | 6/6 passed |
| Switcher viewports | 390 and 1440 px passed; compact shell also passed at 1024 px |
| Close button, backdrop and Escape | Passed |
| Focus return after drawer or app-switcher close | Passed |
| App switcher Arrow Up/Down, Home/End | Passed |
| Current app omitted from destination menu | Passed |

The 390 and 768 px layouts use the shared bottom module rail. The 1024 px
layout uses the compact rail with an overlay workspace sidebar. The 1440 px
layout keeps the rail and workspace sidebar visible next to the content.

## Current Production Deployment

The controlled document workflow was deployed to `docker.home.cz` on
2026-07-12:

- package: `@voldzi/stratos-ui@0.3.29`,
- web image: `sha256:87773c2b986f13d123c543a0f356705757edc341f44672760124faba382a0e3a`,
- rollback image: `akl/web:rollback-document-workflow-20260712-093154`,
- Docker health: healthy after recreation,
- public `/akb/api/ready`: HTTP 200 with Registry, ingestion, RAG,
  governance and evaluation ready,
- local web typecheck, 150 unit tests, production build and 26 document
  workflow E2E scenarios: passed.

The authenticated production browser smoke could not be completed because the
browser navigation path timed out during an intermittent network outage. No
authenticated production UI result is claimed; the equivalent workflow and
responsive interaction paths passed locally before deployment.

## Previous Production Deployments

Table column resizing was deployed to `docker.home.cz` earlier on 2026-07-12:

- web image: `sha256:130e5e65fd6542f1719c1f64e4f0b904149ad78db0ffe423c9677942f8600ed1`,
- rollback image: `akl/web:rollback-table-resize-20260712-064910`,
- source backup: `/srv/akl/backups/akb-table-resize-before-20260712-064910.tar.gz`,
- Docker health: healthy with zero restarts,
- public `/akb/api/health` and `/akb/api/ready`: HTTP 200 and all dependencies ready,
- local web typecheck, 145 unit tests and production build: passed.

The shared `DataTable` resize handle, keyboard resize and double-click auto-fit
are enabled through the AKB adapter. Column widths persist per table in browser
storage; fixed action columns remain non-resizable.

Deployed to `docker.home.cz` on 2026-07-11:

- package: `@voldzi/stratos-ui@0.3.27`,
- web image: `sha256:91ba3337a874c98746205521dad3de5dcabedf3ae719208365433a25b51e6a24`,
- rollback image: `akl/web:rollback-stratos-ui-20260711-063303`,
- source backup: `/srv/akl/backups/akb-stratos-ui-before-20260711-063303.tar.gz`,
- packaged and runtime base path: `/akb`,
- Docker health: healthy with zero restarts after deployment,
- public `/akb/api/health` and `/akb/api/ready`: HTTP 200 and ready.

The authenticated visual smoke could not be completed from the automated
in-app browser because its Keycloak navigation did not return. The equivalent
switcher interactions passed locally before deployment; production login and
shell interaction still require a browser-session smoke.

The previous `0.3.25` shell release was deployed to `docker.home.cz` on
2026-07-10:

- web image: `sha256:a555f45bcb87c52e8dc6a65b1915509615ca71d8f03ef8cc55532121aeed3cfd`,
- rollback image: `akl/web:rollback-stratos-ui-20260710-131310`,
- source backup: `/srv/akl/backups/akb-stratos-ui-before-20260710-131310.tar.gz`,
- Docker health: healthy with zero restarts after deployment,
- public `/akb/api/health` and `/akb/api/ready`: HTTP 200,
- authenticated OIDC smoke at 1440 and 390 px: passed,
- production browser console errors and warnings: none.

The production smoke covered breadcrumb, status group, app switcher contents,
app-switcher Escape handling and focus return, mobile bottom navigation, one-tap
drawer opening, the shared 300 px drawer, close-button handling and focus
return. Role filtering and route authorization remain covered by the automated
authorization suite.

## Release Gate

Run from `apps/web`:

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Production deployment additionally requires public `/akb/api/health` and
`/akb/api/ready` to return HTTP 200 and an authenticated shell smoke test.
