# STRATOS Shared Libraries Standard For AKB

AKB is the shared Document AI backend for STRATOS applications. ProjectFlow,
Budget & Contract, and future STRATOS applications must use AKB through stable
API contracts and shared UI components instead of copying document handling or
RAG logic locally.

## Binding Boundary

STRATOS applications must not store or generate:

- binary document copies,
- extracted document text,
- chunks,
- embeddings,
- Qdrant payloads,
- source preview payloads,
- RAG prompts or direct LLM/RAG calls outside AKB.

STRATOS applications may store only AKB reference metadata returned by AKB:

```ts
type AkbReference = {
  tenantId: string;
  externalSystem: "STRATOS_PROJECTFLOW" | "STRATOS_BUDGET" | string;
  externalRef: string;
  externalDocumentId: string;
  documentId: string;
  documentVersionId?: string;
  ingestionStatus?: AkbIngestionStatus;
  canonicalOpenUrl: string;
};
```

The wire fields in AKB API payloads are snake_case. The mandatory identity
fields are:

```text
tenant_id
external_system
external_ref
```

Use `external_system`, never `source_system`, for STRATOS integration payloads.
`external_ref` must be stable and idempotent.

## Package Model

General STRATOS UI primitives for AKB, Budget, ProjectFlow and ArchFlow use
`@voldzi/stratos-ui@0.3.17` or newer compatible versions from the public npm
registry. Applications must not add a scoped `.npmrc` that redirects
`@voldzi/stratos-ui` to GitHub Packages.

AKB-specific shared UI exports belong in the STRATOS shared UI package under an
AKB module, for example:

```ts
import {
  AkbDocumentPicker,
  AkbDocumentViewer,
  AkbDocumentUpload,
  AkbDocumentStatusBadge,
  buildAkbDocumentUrl,
  buildAkbCitationUrl,
} from "@voldzi/stratos-ui/akb";
```

AKB may keep local STRATOS-compatible adapters while the shared package catches
up, but ProjectFlow and Budget must consume the published package API and must
not copy AKB source files.

General STRATOS UI primitives such as field help are consumed from the root
package:

```ts
import {
  DirectoryPersonPicker,
  FieldLabelWithHelp,
  GlobalTopbar,
  HelpHint,
  SelectField,
  StratosSettingsSurface,
  SurfaceModeMenu,
  createStratosProfileSettingsClient,
  createStratosProfileSettingsPayload,
  mergeStratosProfileSettings,
} from "@voldzi/stratos-ui";
import "@voldzi/stratos-ui/styles.css";
```

Applications use `HelpHint`, `FieldLabelWithHelp`, `SelectField.description`
and `SelectField.labelAccessory` instead of app-local help tooltip components.
Applications use the shared profile/settings helpers for `settings.core` and
store application-specific values under `settings.apps.<appId>`. Profile values
such as avatar, language, theme, accent, display name and e-mail are not local
component state and are not sourced from browser localStorage.

## Component Contracts

### AkbDocumentPicker

Purpose: select existing AKB documents according to the current user's AKB
permissions.

Required props:

```ts
type AkbDocumentPickerProps = {
  tenantId: string;
  externalSystem: string;
  contextTags?: string[];
  entityType?: string;
  entityId?: string;
  selectionMode?: "single" | "multi";
  filters?: {
    query?: string;
    classification?: AkbClassification;
    documentType?: AkbDocumentType;
    ingestionStatus?: AkbIngestionStatus;
  };
  onSelect(selection: AkbDocumentSelection[]): void;
};
```

Selection item:

```ts
type AkbDocumentSelection = {
  documentId: string;
  documentVersionId: string | null;
  externalDocumentId: string | null;
  title: string;
  classification: AkbClassification;
  documentType: AkbDocumentType;
  ingestionStatus: AkbIngestionStatus;
  canonicalOpenUrl: string;
};
```

### AkbDocumentViewer

Purpose: show an AKB document through the unified AKB viewer.

Required behavior:

- modes: `modal`, `fullscreen`, `sidebar` through the shared
  `SurfaceModeMenu`,
- open by `documentId` and optional `documentVersionId`,
- support citation, chunk, and page jumps,
- open source/PDF preview through AKB authorized endpoints,
- request source/PDF content through
  `/akb/api/stratos/documents/{documentId}/source-open?version_id=...`, never
  the internal document workflow endpoint,
- do not pass binary content to ProjectFlow/Budget backends,
- show document title, version, ingestion status, classification, and owner,
- let AKB enforce permissions and audit source/citation opening.

Preferred implementation: a STRATOS surface wrapper around an AKB-hosted embed
URL:

```text
/akb/embed/documents/{documentId}?version_id=...&chunk_id=...&page=...
```

### AkbDocumentUpload

Purpose: upload a document into AKB without local storage in the host
application.

Host applications pass context only:

```ts
type AkbDocumentUploadContext = {
  tenantId: string;
  externalSystem: string;
  externalRef: string;
  entityType: string;
  entityId: string;
  contextTags: string[];
  classification: AkbClassification;
  documentType: AkbDocumentType;
  ownerActorId: string;
};
```

AKB owns:

- upload preflight/session,
- object storage write,
- document and version creation,
- ingestion job,
- ingestion status,
- audit.

Upload result:

```ts
type AkbDocumentUploadResult = {
  documentId: string;
  documentVersionId: string;
  externalDocumentId: string;
  fileId: string;
  ingestionJobId: string;
  ingestionStatus: AkbIngestionStatus;
  canonicalOpenUrl: string;
};
```

### AkbDocumentStatusBadge

Supported statuses:

```text
REGISTERED
VERSION_CREATED
UPLOADING
INGESTING
INDEXED
FAILED
PERMISSION_DENIED
STALE
```

Status semantics:

- `REGISTERED`: external reference exists, no usable version yet.
- `VERSION_CREATED`: version exists, upload or ingestion not complete.
- `UPLOADING`: upload session active.
- `INGESTING`: ingestion job queued or running.
- `INDEXED`: version is indexed and citation-ready.
- `FAILED`: upload or ingestion failed.
- `PERMISSION_DENIED`: AKB denied current user access.
- `STALE`: reference/version is older than indexed or expected state.

## Required AKB API Contract

Stable external STRATOS API capabilities:

- register/upsert external document,
- create document/version,
- upload preflight/session,
- confirm uploaded object,
- start ingestion,
- get ingestion status,
- retry ingestion,
- get canonical document open URL,
- get citation open URL,
- list/search documents for picker.

Server-side calls use service token or OIDC client credentials. Browser
components use only the AKB web/API bridge and AKB-hosted viewer/embed URLs.

Implemented browser bridge endpoints for the shared components:

```http
POST /akb/api/stratos/documents/search
POST /akb/api/stratos/upload/preflight
PUT  /akb/api/stratos/upload/sessions/{upload_session_id}/content
POST /akb/api/stratos/upload/sessions/{upload_session_id}/confirm
GET  /akb/api/stratos/documents/{document_id}/open-url
POST /akb/api/stratos/documents/{document_id}/source-open?version_id=...
GET  /akb/api/stratos/documents/{document_id}/ingestion-status
POST /akb/api/stratos/documents/{document_id}/retry-ingestion
GET  /akb/api/stratos/citations/{chunk_id}/open-url
GET  /akb/embed/documents/{document_id}
```

The bridge uses the active AKB web session/OIDC context, or the current bearer
token propagated by the STRATOS host application, never exposes internal storage
credentials, and returns only metadata plus short-lived AKB URLs/tokens.

## ProjectFlow Context

```ts
const projectFlowAkbContext = {
  externalSystem: "STRATOS_PROJECTFLOW",
  entityType: "project",
  entityId: projectId,
  contextTags: [`projectflow-project:${projectId}`],
};
```

Task document:

```ts
const taskAkbContext = {
  externalSystem: "STRATOS_PROJECTFLOW",
  entityType: "task",
  entityId: taskId,
  contextTags: [
    `projectflow-project:${projectId}`,
    `projectflow-task:${taskId}`,
  ],
};
```

Status report:

```ts
const statusReportAkbContext = {
  externalSystem: "STRATOS_PROJECTFLOW",
  entityType: "statusReport",
  entityId: statusReportId,
  contextTags: [
    `projectflow-project:${projectId}`,
    `projectflow-status-report:${statusReportId}`,
  ],
};
```

## Budget & Contract Context

```ts
const contractAkbContext = {
  externalSystem: "STRATOS_BUDGET",
  entityType: "contract",
  entityId: contractId,
  contextTags: [`budget-contract:${contractId}`],
};
```

Procurement action:

```ts
const procurementAkbContext = {
  externalSystem: "STRATOS_BUDGET",
  entityType: "procurementAction",
  entityId: actionId,
  contextTags: [
    `budget-contract:${contractId}`,
    `budget-vznen:${actionId}`,
  ],
};
```

Budget plan:

```ts
const budgetPlanAkbContext = {
  externalSystem: "STRATOS_BUDGET",
  entityType: "budgetPlan",
  entityId: planId,
  contextTags: [`budget-plan:${planId}`],
};
```

Payment rule:

```ts
const paymentRuleAkbContext = {
  externalSystem: "STRATOS_BUDGET",
  entityType: "paymentRule",
  entityId: paymentRuleId,
  contextTags: [
    `budget-contract:${contractId}`,
    `budget-payment-rule:${paymentRuleId}`,
  ],
};
```

## Minimal Integration Example

ProjectFlow:

```tsx
<AkbDocumentUpload
  tenantId={tenantId}
  externalSystem="STRATOS_PROJECTFLOW"
  externalRef={`project:${projectId}:document:${localDocumentId}`}
  entityType="project"
  entityId={projectId}
  contextTags={[`projectflow-project:${projectId}`]}
  classification="internal"
  documentType="project_documentation"
  ownerActorId={currentUser.id}
  onUploaded={(result) => saveAkbReference(result)}
/>

<AkbDocumentPicker
  tenantId={tenantId}
  externalSystem="STRATOS_PROJECTFLOW"
  entityType="project"
  entityId={projectId}
  contextTags={[`projectflow-project:${projectId}`]}
  selectionMode="multi"
  onSelect={(selection) => attachAkbDocuments(selection)}
/>
```

Budget:

```tsx
<AkbDocumentUpload
  tenantId={tenantId}
  externalSystem="STRATOS_BUDGET"
  externalRef={`contract:${contractNumber}:main`}
  entityType="contract"
  entityId={contractId}
  contextTags={[`budget-contract:${contractId}`]}
  classification="restricted"
  documentType="contract"
  ownerActorId={currentUser.id}
  onUploaded={(result) => saveAkbContractReference(result)}
/>
```

Citation opening:

```tsx
<AkbDocumentViewer
  documentId={citation.documentId}
  documentVersionId={citation.documentVersionId}
  chunkId={citation.chunkId}
  page={citation.pageNumber}
  mode="sidebar"
/>
```

## Acceptance Standard

The integration is ready when:

- ProjectFlow selects existing AKB documents through the shared picker.
- ProjectFlow uploads documents through AKB without storing files or extracted
  text locally.
- Budget uses the same components without forks.
- Clicking a document opens the unified AKB viewer, not an ordinary external
  link.
- RAG citations open the viewer on the specific chunk/page.
- Ingestion status is visible and refreshable.
- AKB controls authorization and audit.
- This standard and `docs/integration/STRATOS_EXTERNAL_DOCUMENTS_API.md` are
  referenced from each consuming STRATOS application.
