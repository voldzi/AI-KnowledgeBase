"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenCheck,
  Brain,
  CircleCheck,
  ClipboardCheck,
  Copy,
  Download,
  ExternalLink,
  FileClock,
  FileSearch,
  FileText,
  GitCompareArrows,
  Layers3,
  LockKeyhole,
  Network,
  Plus,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UploadCloud
} from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import {
  StratosButton,
  StratosButtonLink,
  StratosDataTable,
  StratosPdfViewer,
  StratosSelect,
  StratosViewTabs,
  type StratosDataTableColumn,
  type StratosViewTab
} from "@/components/stratos";
import { withAppBasePath } from "@/lib/app-url";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type {
  AssignmentSubjectType,
  AuditEvent,
  AuthorizationHint,
  Document,
  DocumentAssignment,
  DocumentAssignmentInput,
  DocumentAssignmentRole,
  DocumentSourceOpenDecision,
  DocumentGovernanceRunResponse,
  DocumentVersion,
  GovernanceActionKind,
  GovernanceCitation,
  GovernanceServiceResponse,
  IngestionJob,
  RegistryWorkflowTask,
  SourceContext
} from "@/lib/types";
import { documentTypeLabel, formatDate, formatDateTime } from "@/lib/format";

interface DocumentDetailProps {
  document: Document;
  versions: DocumentVersion[];
  jobs: IngestionJob[];
  authorization: AuthorizationHint;
  assignments?: DocumentAssignment[];
  workflowTasks?: RegistryWorkflowTask[];
  auditEvents?: AuditEvent[];
}

interface AssignmentFormRow {
  id: string;
  role: DocumentAssignmentRole;
  subject_type: AssignmentSubjectType;
  subject_id: string;
  display_label: string;
  is_primary: boolean;
  active: boolean;
  sla_days: string;
  escalation_subject_type: AssignmentSubjectType;
  escalation_subject_id: string;
  escalation_label: string;
}

interface AuditTrace {
  event: AuditEvent;
  scopes: string[];
}

interface ProposedDocumentInsight {
  insight_id: string;
  kind: "obligation" | "role" | "deadline" | "risk";
  title: string;
  summary: string;
  status: "proposed";
  confidence: "medium" | "low";
  citations: GovernanceCitation[];
  warnings: string[];
}

interface SourceContextSignal {
  chunkId: string;
  title: string;
  detail: string;
  createdAt: string;
}

type NativePreviewKind = "waiting" | "pdf" | "image" | "text" | "markdown" | "csv" | "docx" | "xlsx" | "presentation" | "unsupported";

interface MarkdownHeading {
  id: string;
  level: number;
  text: string;
}

interface RehypeElementNode {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children?: RehypeNode[];
}

interface RehypeTextNode {
  type: "text";
  value: string;
}

type RehypeNode = RehypeElementNode | RehypeTextNode | { type: string; children?: RehypeNode[] };

type NativeStructuredPreview =
  | {
      kind: "docx";
      filename: string;
      paragraphs: Array<{ index: number; text: string; style: string | null }>;
      truncated: boolean;
      warnings: string[];
    }
  | {
      kind: "xlsx";
      filename: string;
      sheets: Array<{ name: string; rows: string[][]; truncated: boolean }>;
      warnings: string[];
    }
  | {
      kind: "presentation";
      filename: string;
      slides: Array<{ slide_number: number; title: string | null; text: string[] }>;
      truncated: boolean;
      warnings: string[];
    }
  | {
      kind: "unsupported";
      filename: string;
      warnings: string[];
    };

const detailCopy = {
  cs: {
    back: "Zpět do registru",
    registryNotice: "Frontend zobrazuje platnost dokumentu a akce pouze z Registry API. Autoritativní oprávnění neodvozuje lokálně.",
    overview: "Přehled",
    viewer: "Viewer",
    workflow: "Workflow",
    insights: "Insighty",
    versionsTab: "Verze",
    ingestionTab: "Ingestion",
    auditTab: "Audit",
    owner: "Vlastník",
    type: "Typ",
    classification: "Klasifikace",
    gestor: "Gestor",
    updated: "Aktualizováno",
    currentVersion: "Aktuální verze",
    validFrom: "platná od",
    noVersion: "Žádná verze",
    source: "Zdroj",
    sourceUri: "URI zdrojového souboru",
    sourceHash: "Hash souboru",
    viewerMode: "Režim vieweru",
    viewerNotice: "Nativní preview dokumentu bude navázané na source-context a podepsané download URL. Aktuálně je dostupný citovatelný zdrojový kontext z RAG služby.",
    sourceOpenTitle: "Podepsané otevření zdroje",
    sourceOpenDetail: "Server připraví krátkodobou URL pouze pro aktuální dokument a verzi.",
    requestSourceOpen: "Připravit podepsaný zdroj",
    sourceOpening: "Připravuji",
    sourceOpenReady: "Podepsaný zdroj je připravený.",
    sourceOpenUnavailable: "Zdrojový objekt není v lokálním storage dostupný.",
    sourceOpenError: "Podepsané otevření zdroje se nepodařilo připravit.",
    openSignedSource: "Otevřít zdroj",
    downloadSignedSource: "Stáhnout zdroj",
    openCitationPage: "Otevřít stranu citace",
    citationPageUnavailable: "Otevření konkrétní strany citace bude dostupné po zpřístupnění podepsaného zdroje.",
    nativePreviewTitle: "Nativní preview",
    nativePreviewDetail: "Preview používá pouze podepsanou URL pro aktuální dokumentovou verzi.",
    nativePreviewWaiting: "Nejprve připravte podepsaný zdroj v panelu Zdroj.",
    nativePreviewUnavailable: "Nativní preview není dostupné, protože zdrojový objekt není ve storage.",
    nativePreviewLoading: "Načítám preview zdroje.",
    nativePreviewError: "Preview zdroje se nepodařilo načíst.",
    nativePreviewUnsupported: "Tento typ zdroje zatím nemá nativní renderer. Použijte podepsané otevření nebo stažení zdroje.",
    nativePreviewTruncated: "Preview je zkrácené pro rychlé zobrazení.",
    nativePreviewPdfFallback: "PDF preview nelze zobrazit ve vestavěném prohlížeči.",
    nativePreviewPdfRenderedTitle: "Vykreslená strana citace",
    nativePreviewPdfRenderedDetail: "PDF stránka je vykreslená přes pdf.js. Citace se zvýrazní textovou vrstvou a případně přes source-location bbox.",
    nativePreviewImageAlt: "Náhled zdrojového obrázku",
    nativePreviewOcrBbox: "OCR oblast citace",
    nativePreviewPdfBbox: "Metadata oblast citace v PDF",
    nativePreviewPdfTextHighlight: "Textová shoda citace v PDF",
    nativePreviewPdfLocatorTitle: "Lokace v PDF podle metadat",
    nativePreviewPdfLocatorDetail: "Mini mapa stránky používá source-location metadata jako fallback, pokud PDF textová vrstva nemá přesnou shodu.",
    nativePreviewCitationLocation: "Lokace citace",
    nativePreviewExactHighlight: "Zvýrazněný citovaný úsek",
    nativePreviewMarkdownToc: "Obsah dokumentu",
    nativePreviewMarkdownNoHeadings: "Markdown dokument neobsahuje nadpisy pro obsah.",
    nativePreviewStructuredEmpty: "Strukturovaný náhled neobsahuje žádný extrahovatelný text.",
    nativePreviewSheet: "List",
    nativePreviewSlide: "Slide",
    expiresAt: "Expirace",
    storageAvailability: "Dostupnost ve storage",
    available: "dostupné",
    unavailable: "nedostupné",
    sourceContextTitle: "Source-context",
    sourceContextDetail: "Citovatelný kontext načtený přes RAG bridge a ověřený proti aktuálnímu dokumentu.",
    sourceContextSignals: "Dostupné source-context signály",
    sourceContextEmpty: "V auditní stopě není pro tento dokument žádný otevřitelný chunk.",
    sourceContextPlaceholder: "Vyberte auditovaný chunk v panelu Zdroj a otevře se přesný citovatelný kontext.",
    openSourceContext: "Otevřít source-context",
    openingSourceContext: "Otevírám",
    sourceContextError: "Source-context se nepodařilo otevřít.",
    chunk: "Chunk",
    page: "Strana",
    section: "Sekce",
    paragraph: "Odstavec",
    row: "Řádek",
    noSection: "Sekce není uvedená",
    sourceUnavailable: "Zdroj není dostupný",
    copyChunk: "Kopírovat chunk",
    beforeContext: "Předchozí kontext",
    afterContext: "Následující kontext",
    workflowTitle: "Publikační workflow",
    workflowDraft: "Koncept",
    workflowDraftDetail: "Metadata a verze jsou založené v Registry API.",
    workflowIngestion: "Zpracování",
    workflowIngestionDetail: "Parser, chunker a indexace připraví citovatelný zdroj.",
    workflowReview: "Revize",
    workflowReviewDetail: "Vlastník nebo gestor kontroluje metadata, zdroje a governance zjištění.",
    workflowApproved: "Schválení",
    workflowApprovedDetail: "Schválený dokument je připravený na publikaci platné verze.",
    workflowPublish: "Publikace",
    workflowPublishDetail: "Platná verze nahrazuje předchozí publikovanou verzi.",
    workflowArchive: "Archivace",
    workflowArchiveDetail: "Nahrazené verze zůstávají dohledatelné pro audit.",
    workflowTasksTitle: "Workflow tasky",
    workflowTasksDetail: "Autoritativní stav, vlastník a poslední rozhodnutí z Registry API.",
    workflowTasksEmpty: "K dokumentu nejsou evidované workflow tasky.",
    assignmentsTitle: "Organizační odpovědnosti",
    assignmentsDetail: "Role, SLA a eskalace z Registry API pro tento dokument.",
    assignmentsEmpty: "K dokumentu nejsou evidované odpovědnosti.",
    assignmentRole: "Role",
    assignmentSubjectType: "Subjekt",
    assignmentSubjectId: "ID subjektu",
    assignmentLabel: "Zobrazený název",
    assignmentSla: "SLA dny",
    assignmentEscalation: "Eskalace",
    assignmentEscalationType: "Typ eskalace",
    assignmentEscalationId: "ID eskalace",
    assignmentPrimary: "primární",
    assignmentActive: "aktivní",
    assignmentAdd: "Přidat roli",
    assignmentSave: "Uložit odpovědnosti",
    assignmentSaving: "Ukládám",
    assignmentRemove: "Odebrat",
    assignmentNoPermission: "Úprava odpovědností není pro tuto relaci povolená.",
    assignmentSaved: "Odpovědnosti byly uložené.",
    assignmentFailed: "Odpovědnosti se nepodařilo uložit.",
    assignmentRequiresSubject: "Každá role musí mít vyplněné ID subjektu.",
    publishGateTitle: "Publish gate",
    publishGateReady: "Dokument je schválený. Aktuální verzi lze publikovat.",
    publishGatePublished: "Aktuální verze je publikovaná. Archivace je dostupná podle oprávnění.",
    publishGateArchived: "Aktuální verze je archivovaná. Publikace ani archivace nejsou pro tuto verzi dostupné.",
    publishGateLocked: "Publikace je zamčená, dokud review workflow nepřejde do stavu approved.",
    publishGateNoPermission: "Publikační akce nejsou pro tuto relaci povolené.",
    publishApproved: "Publikovat schválenou verzi",
    archiveCurrent: "Archivovat aktuální verzi",
    publishing: "Publikuji",
    archiving: "Archivuji",
    workflowActionSaved: "Akce byla provedena.",
    workflowActionFailed: "Akci se nepodařilo provést.",
    taskDue: "termín",
    resolved: "vyřešeno",
    lastAction: "poslední akce",
    currentSignal: "aktuální signál",
    requiredActions: "Prioritní kroky",
    actionIngestion: "Dokončit ingestion a zkontrolovat varování.",
    actionReview: "Spustit kontrolu compliance před publikací.",
    actionViewer: "Doplnit přesnou viewer lokaci pro PDF/DOCX zdroje.",
    actionAccess: "Ověřit přístupové politiky pro citlivou klasifikaci.",
    noActions: "Nejsou detekované prioritní kroky.",
    insightsTitle: "Navržené znalostní výstupy",
    insightsGenerate: "Navrhnout insighty",
    insightsGenerating: "Generuji",
    insightsGenerated: "Návrhy insightů byly vytvořené ze zdrojového textu.",
    insightsFailed: "Návrhy insightů se nepodařilo vytvořit.",
    insightsNotPersisted: "Návrhy jsou pracovní podklad pro revizi. Autoritativní uložení a schvalování v Registry bude další krok.",
    insightsEmpty: "Zatím nejsou vygenerované žádné návrhy.",
    insightCitation: "Citace",
    insightWarnings: "Omezení",
    insightObligation: "Povinnosti",
    insightObligationDetail: "Extrahovat normativní požadavky s citací na oddíl dokumentu.",
    insightRoles: "Role a odpovědnosti",
    insightRolesDetail: "Zachytit vlastníka, gestora, schvalovatele a provozní role.",
    insightDeadlines: "Lhůty",
    insightDeadlinesDetail: "Najít účinnost, platnost, revizní termíny a SLA.",
    insightRisk: "Rizika",
    insightRiskDetail: "Označit konflikty, neúplná metadata a citlivé části.",
    proposed: "návrh",
    governanceTitle: "Governance kontroly",
    governanceDetail: "Spustitelné kontroly volají Governance Service přes serverový bridge a vrací citace, confidence a auditovatelný result ID.",
    compareVersions: "Porovnat verze",
    compareVersionsDetail: "Diff posledních dvou verzí, materialita změn a citace zdrojových verzí.",
    complianceCheck: "Kontrola compliance",
    complianceCheckDetail: "Baseline pravidla pro vlastníka, gestora, platnost, výjimky a trasovatelnost.",
    conflictDetection: "Detekce konfliktů",
    conflictDetectionDetail: "Hledá překryv nebo rozpor s dalšími autorizovanými dokumenty v registru.",
    governanceRun: "Spustit",
    governanceRunning: "Spouštím",
    governanceResultTitle: "Výsledek governance kontroly",
    governanceRunComplete: "Governance kontrola byla dokončená.",
    governanceFailed: "Governance kontrolu se nepodařilo spustit.",
    governanceUnavailable: "Akce zatím nemá dostatečný vstup.",
    governanceConfidence: "Confidence",
    governanceResultId: "Result ID",
    governanceGenerated: "Vygenerováno",
    governanceSourceLimitations: "Zdrojová omezení",
    governanceWarnings: "Varování",
    governanceCounts: "Souhrn metrik",
    governanceFindings: "Nálezy",
    governanceCitations: "Citace",
    governanceMissing: "Chybějící informace",
    governanceNoItems: "Výsledek neobsahuje detailní položky.",
    versionHistory: "Historie verzí",
    upload: "Nahrát",
    version: "Verze",
    status: "Stav",
    validity: "Platnost",
    changeSummary: "Souhrn změny",
    ingestionStatus: "Stav zpracování",
    created: "vytvořeno",
    noJob: "K tomuto dokumentu není aktuálně připojena žádná ingestion úloha.",
    auditTitle: "Auditní stopa dokumentu",
    auditDetail: "Události navázané přes dokument, verzi, workflow task, odpovědnost, ingestion nebo source-context metadata.",
    auditHidden: "Auditní stopa je skrytá, protože Registry API neudělilo audit.read.",
    auditEmpty: "K tomuto dokumentu nejsou v načteném auditním okně evidované žádné události.",
    auditEvent: "Událost",
    auditSeverity: "Závažnost",
    auditActor: "Aktér",
    auditResource: "Zdroj",
    auditScope: "Vazba",
    auditCorrelation: "Korelace",
    auditMetadata: "Metadata",
    auditCreated: "Vytvořeno",
    auditScopeDocument: "dokument",
    auditScopeVersion: "verze",
    auditScopeWorkflow: "workflow",
    auditScopeAssignment: "odpovědnost",
    auditScopeIngestion: "ingestion",
    auditScopeSource: "source-context"
  },
  en: {
    back: "Back to registry",
    registryNotice: "Frontend displays document validity and actions from Registry API only. It does not infer authoritative authorization locally.",
    overview: "Overview",
    viewer: "Viewer",
    workflow: "Workflow",
    insights: "Insights",
    versionsTab: "Versions",
    ingestionTab: "Ingestion",
    auditTab: "Audit",
    owner: "Owner",
    type: "Type",
    classification: "Classification",
    gestor: "Gestor",
    updated: "Updated",
    currentVersion: "Current version",
    validFrom: "valid from",
    noVersion: "No version",
    source: "Source",
    sourceUri: "Source file URI",
    sourceHash: "File hash",
    viewerMode: "Viewer mode",
    viewerNotice: "Native document preview will be connected to source-context and signed download URLs. The citable source context from RAG is available now.",
    sourceOpenTitle: "Signed source opening",
    sourceOpenDetail: "The server prepares a short-lived URL only for the current document and version.",
    requestSourceOpen: "Prepare signed source",
    sourceOpening: "Preparing",
    sourceOpenReady: "Signed source is ready.",
    sourceOpenUnavailable: "Source object is not available in local storage.",
    sourceOpenError: "Signed source opening could not be prepared.",
    openSignedSource: "Open source",
    downloadSignedSource: "Download source",
    openCitationPage: "Open citation page",
    citationPageUnavailable: "Opening the exact citation page will be available after the signed source is available.",
    nativePreviewTitle: "Native preview",
    nativePreviewDetail: "Preview uses only the signed URL for the current document version.",
    nativePreviewWaiting: "Prepare the signed source in the Source panel first.",
    nativePreviewUnavailable: "Native preview is not available because the source object is not in storage.",
    nativePreviewLoading: "Loading source preview.",
    nativePreviewError: "Source preview could not be loaded.",
    nativePreviewUnsupported: "This source type does not have a native renderer yet. Use signed opening or source download.",
    nativePreviewTruncated: "Preview is truncated for fast rendering.",
    nativePreviewPdfFallback: "PDF preview cannot be displayed in the embedded viewer.",
    nativePreviewPdfRenderedTitle: "Rendered citation page",
    nativePreviewPdfRenderedDetail: "The PDF page is rendered through pdf.js. Citations are highlighted through the text layer and, when available, source-location bbox metadata.",
    nativePreviewImageAlt: "Source image preview",
    nativePreviewOcrBbox: "OCR citation area",
    nativePreviewPdfBbox: "PDF citation metadata area",
    nativePreviewPdfTextHighlight: "PDF citation text match",
    nativePreviewPdfLocatorTitle: "PDF metadata location",
    nativePreviewPdfLocatorDetail: "The page minimap uses source-location metadata as a fallback when the PDF text layer has no exact match.",
    nativePreviewCitationLocation: "Citation location",
    nativePreviewExactHighlight: "Highlighted cited segment",
    nativePreviewMarkdownToc: "Document contents",
    nativePreviewMarkdownNoHeadings: "The Markdown document has no headings for a table of contents.",
    nativePreviewStructuredEmpty: "Structured preview contains no extractable text.",
    nativePreviewSheet: "Sheet",
    nativePreviewSlide: "Slide",
    expiresAt: "Expires",
    storageAvailability: "Storage availability",
    available: "available",
    unavailable: "unavailable",
    sourceContextTitle: "Source context",
    sourceContextDetail: "Citable context loaded through the RAG bridge and validated against the current document.",
    sourceContextSignals: "Available source-context signals",
    sourceContextEmpty: "No openable chunk is present in the audit trail for this document.",
    sourceContextPlaceholder: "Select an audited chunk in the Source panel to open the exact citable context.",
    openSourceContext: "Open source context",
    openingSourceContext: "Opening",
    sourceContextError: "Source context could not be opened.",
    chunk: "Chunk",
    page: "Page",
    section: "Section",
    paragraph: "Paragraph",
    row: "Row",
    noSection: "Section is not available",
    sourceUnavailable: "Source unavailable",
    copyChunk: "Copy chunk",
    beforeContext: "Previous context",
    afterContext: "Next context",
    workflowTitle: "Publication workflow",
    workflowDraft: "Draft",
    workflowDraftDetail: "Metadata and version are registered in Registry API.",
    workflowIngestion: "Ingestion",
    workflowIngestionDetail: "Parser, chunker and indexing prepare citable source context.",
    workflowReview: "Review",
    workflowReviewDetail: "Owner or gestor checks metadata, sources and governance findings.",
    workflowApproved: "Approval",
    workflowApprovedDetail: "An approved document is ready for valid-version publication.",
    workflowPublish: "Publication",
    workflowPublishDetail: "The valid version supersedes the previous published version.",
    workflowArchive: "Archive",
    workflowArchiveDetail: "Superseded versions remain discoverable for audit.",
    workflowTasksTitle: "Workflow tasks",
    workflowTasksDetail: "Authoritative status, owner and last decision from Registry API.",
    workflowTasksEmpty: "No workflow tasks are recorded for this document.",
    assignmentsTitle: "Organizational responsibilities",
    assignmentsDetail: "Roles, SLA and escalation from Registry API for this document.",
    assignmentsEmpty: "No responsibilities are recorded for this document.",
    assignmentRole: "Role",
    assignmentSubjectType: "Subject",
    assignmentSubjectId: "Subject ID",
    assignmentLabel: "Display label",
    assignmentSla: "SLA days",
    assignmentEscalation: "Escalation",
    assignmentEscalationType: "Escalation type",
    assignmentEscalationId: "Escalation ID",
    assignmentPrimary: "primary",
    assignmentActive: "active",
    assignmentAdd: "Add role",
    assignmentSave: "Save responsibilities",
    assignmentSaving: "Saving",
    assignmentRemove: "Remove",
    assignmentNoPermission: "Responsibility editing is not allowed in this session.",
    assignmentSaved: "Responsibilities saved.",
    assignmentFailed: "Responsibilities could not be saved.",
    assignmentRequiresSubject: "Every role must have a subject ID.",
    publishGateTitle: "Publish gate",
    publishGateReady: "The document is approved. The current version can be published.",
    publishGatePublished: "The current version is published. Archive is available according to permissions.",
    publishGateArchived: "The current version is archived. Publication and archive actions are not available for this version.",
    publishGateLocked: "Publication is locked until the review workflow reaches approved state.",
    publishGateNoPermission: "Publication actions are not allowed in this session.",
    publishApproved: "Publish approved version",
    archiveCurrent: "Archive current version",
    publishing: "Publishing",
    archiving: "Archiving",
    workflowActionSaved: "Action completed.",
    workflowActionFailed: "The action could not be completed.",
    taskDue: "due",
    resolved: "resolved",
    lastAction: "last action",
    currentSignal: "current signal",
    requiredActions: "Priority actions",
    actionIngestion: "Finish ingestion and review warnings.",
    actionReview: "Run compliance check before publication.",
    actionViewer: "Add exact viewer location for PDF/DOCX sources.",
    actionAccess: "Review access policies for sensitive classification.",
    noActions: "No priority actions detected.",
    insightsTitle: "Proposed knowledge outputs",
    insightsGenerate: "Propose insights",
    insightsGenerating: "Generating",
    insightsGenerated: "Insight proposals were generated from source text.",
    insightsFailed: "Insight proposals could not be generated.",
    insightsNotPersisted: "Proposals are review working material. Authoritative Registry persistence and approval is the next step.",
    insightsEmpty: "No proposals have been generated yet.",
    insightCitation: "Citation",
    insightWarnings: "Limitations",
    insightObligation: "Obligations",
    insightObligationDetail: "Extract normative requirements with source-section citations.",
    insightRoles: "Roles and responsibilities",
    insightRolesDetail: "Capture owner, gestor, approver and operating roles.",
    insightDeadlines: "Deadlines",
    insightDeadlinesDetail: "Find effective dates, validity, review dates and SLA.",
    insightRisk: "Risks",
    insightRiskDetail: "Flag conflicts, incomplete metadata and sensitive sections.",
    proposed: "proposed",
    governanceTitle: "Governance checks",
    governanceDetail: "Executable checks call Governance Service through a server bridge and return citations, confidence and auditable result ID.",
    compareVersions: "Compare versions",
    compareVersionsDetail: "Diff of the latest two versions, change materiality and source-version citations.",
    complianceCheck: "Compliance check",
    complianceCheckDetail: "Baseline rules for owner, gestor, validity, exceptions and traceability.",
    conflictDetection: "Conflict detection",
    conflictDetectionDetail: "Finds overlap or conflict with other authorized registry documents.",
    governanceRun: "Run",
    governanceRunning: "Running",
    governanceResultTitle: "Governance check result",
    governanceRunComplete: "Governance check completed.",
    governanceFailed: "Governance check could not be executed.",
    governanceUnavailable: "The action does not have enough input yet.",
    governanceConfidence: "Confidence",
    governanceResultId: "Result ID",
    governanceGenerated: "Generated",
    governanceSourceLimitations: "Source limitations",
    governanceWarnings: "Warnings",
    governanceCounts: "Metric summary",
    governanceFindings: "Findings",
    governanceCitations: "Citations",
    governanceMissing: "Missing information",
    governanceNoItems: "The result has no detailed items.",
    versionHistory: "Version history",
    upload: "Upload",
    version: "Version",
    status: "Status",
    validity: "Validity",
    changeSummary: "Change summary",
    ingestionStatus: "Ingestion status",
    created: "created",
    noJob: "No ingestion job is currently linked to this document.",
    auditTitle: "Document audit trail",
    auditDetail: "Events linked through document, version, workflow task, responsibility, ingestion or source-context metadata.",
    auditHidden: "The audit trail is hidden because Registry API did not grant audit.read.",
    auditEmpty: "No events for this document are present in the loaded audit window.",
    auditEvent: "Event",
    auditSeverity: "Severity",
    auditActor: "Actor",
    auditResource: "Resource",
    auditScope: "Scope",
    auditCorrelation: "Correlation",
    auditMetadata: "Metadata",
    auditCreated: "Created",
    auditScopeDocument: "document",
    auditScopeVersion: "version",
    auditScopeWorkflow: "workflow",
    auditScopeAssignment: "responsibility",
    auditScopeIngestion: "ingestion",
    auditScopeSource: "source-context"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

type DetailTab = "overview" | "viewer" | "workflow" | "insights" | "versions" | "ingestion" | "audit";

const assignmentRoles: DocumentAssignmentRole[] = ["owner", "gestor", "reviewer", "approver", "auditor", "steward"];
const assignmentSubjectTypes: AssignmentSubjectType[] = ["user", "group", "unit", "service"];

export function DocumentDetail({
  document,
  versions,
  jobs,
  authorization,
  assignments = [],
  workflowTasks = [],
  auditEvents = []
}: DocumentDetailProps) {
  const { language } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const copy = detailCopy[language];
  const relatedJobs = jobs.filter((job) => job.document_id === document.document_id);
  const sortedWorkflowTasks = useMemo(
    () => [...workflowTasks].sort((left, right) => right.updated_at.localeCompare(left.updated_at)),
    [workflowTasks]
  );
  const documentAuditTraces = useMemo(
    () =>
      auditTracesForDocument({
        document,
        versions,
        relatedJobs,
        assignments: assignments.length > 0 ? assignments : document.assignments ?? [],
        workflowTasks,
        auditEvents,
        copy
      }),
    [assignments, auditEvents, copy, document, relatedJobs, versions, workflowTasks]
  );
  const sourceContextSignals = useMemo(
    () => sourceContextSignalsForDocument({ document, versions, auditEvents, copy }),
    [auditEvents, copy, document, versions]
  );
  const [assignmentRows, setAssignmentRows] = useState<AssignmentFormRow[]>(() =>
    assignmentRowsFrom(assignments.length > 0 ? assignments : document.assignments ?? [], document.document_id)
  );
  const currentVersion = versions.find((version) => version.status === "valid") ?? versions[0];
  const [activeTab, setActiveTab] = useState<DetailTab>(() => (searchParams.get("tab") === "viewer" ? "viewer" : "overview"));
  const loadedRequestedChunkRef = useRef<string | null>(null);
  const [workflowAction, setWorkflowAction] = useState<"publish" | "archive" | null>(null);
  const [workflowFeedback, setWorkflowFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [assignmentFeedback, setAssignmentFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [governanceAction, setGovernanceAction] = useState<GovernanceActionKind | null>(null);
  const [governanceResult, setGovernanceResult] = useState<DocumentGovernanceRunResponse | null>(null);
  const [governanceFeedback, setGovernanceFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [sourceContext, setSourceContext] = useState<SourceContext | null>(null);
  const [sourceContextFeedback, setSourceContextFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [openingSourceChunkId, setOpeningSourceChunkId] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState<DocumentSourceOpenDecision | null>(null);
  const [sourceOpenAction, setSourceOpenAction] = useState(false);
  const [sourceOpenFeedback, setSourceOpenFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [proposedInsights, setProposedInsights] = useState<ProposedDocumentInsight[] | null>(null);
  const [insightsAction, setInsightsAction] = useState(false);
  const [insightsFeedback, setInsightsFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const priorityActions = useMemo(
    () => priorityActionsFor(document, currentVersion, relatedJobs, copy),
    [copy, currentVersion, document, relatedJobs]
  );
  const viewerMode = currentVersion ? viewerModeFor(currentVersion.source_file_uri) : "binary";
  const citationPageUrl =
    sourceOpen?.available && sourceOpen.download_url && sourceContext?.location.page_number
      ? sourceUrlWithPageFragment(sourceOpen.download_url, sourceContext.location.page_number)
      : null;
  const canPublishCurrentVersion = Boolean(
    authorization.can_publish &&
      currentVersion &&
      document.status === "approved" &&
      !["valid", "superseded", "archived", "cancelled"].includes(currentVersion.status)
  );
  const canArchiveCurrentVersion = Boolean(authorization.can_publish && currentVersion?.status === "valid");

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    const requestedChunkId = searchParams.get("chunk_id")?.trim();
    if (requestedTab === "viewer") {
      setActiveTab("viewer");
    }
    if (!requestedChunkId || loadedRequestedChunkRef.current === requestedChunkId) {
      return;
    }
    loadedRequestedChunkRef.current = requestedChunkId;
    setActiveTab("viewer");
    void openDocumentChunkContext(requestedChunkId);
  }, [searchParams]);

  async function submitVersionAction(action: "publish" | "archive") {
    if (!currentVersion || workflowAction) {
      return;
    }
    setWorkflowAction(action);
    setWorkflowFeedback(null);
    try {
      const response = await fetch(
        withAppBasePath(`/api/documents/${encodeURIComponent(document.document_id)}/versions/${encodeURIComponent(currentVersion.document_version_id)}/${action}`),
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(await readDocumentWorkflowError(response));
      }
      setWorkflowFeedback({ tone: "success", message: copy.workflowActionSaved });
      router.refresh();
    } catch (error) {
      const suffix = error instanceof Error && error.message ? ` ${error.message}` : "";
      setWorkflowFeedback({ tone: "error", message: `${copy.workflowActionFailed}${suffix}` });
    } finally {
      setWorkflowAction(null);
    }
  }

  function updateAssignmentRow(rowId: string, patch: Partial<AssignmentFormRow>) {
    setAssignmentRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function addAssignmentRow() {
    setAssignmentRows((current) => [...current, newAssignmentRow(document.document_id)]);
  }

  function removeAssignmentRow(rowId: string) {
    setAssignmentRows((current) => {
      const nextRows = current.filter((row) => row.id !== rowId);
      return nextRows.length > 0 ? nextRows : [newAssignmentRow(document.document_id)];
    });
  }

  async function saveAssignments() {
    if (!authorization.can_update || savingAssignments) {
      return;
    }
    const payloadAssignments = assignmentRows.map((row) => assignmentPayloadFromRow(row));
    if (payloadAssignments.some((assignment) => !assignment.subject_id)) {
      setAssignmentFeedback({ tone: "error", message: copy.assignmentRequiresSubject });
      return;
    }

    setSavingAssignments(true);
    setAssignmentFeedback(null);
    try {
      const response = await fetch(withAppBasePath(`/api/documents/${encodeURIComponent(document.document_id)}/assignments`), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ assignments: payloadAssignments })
      });
      if (!response.ok) {
        throw new Error(await readDocumentWorkflowError(response));
      }
      const payload = (await response.json()) as { assignments: DocumentAssignment[] };
      setAssignmentRows(assignmentRowsFrom(payload.assignments, document.document_id));
      setAssignmentFeedback({ tone: "success", message: copy.assignmentSaved });
      router.refresh();
    } catch (error) {
      const suffix = error instanceof Error && error.message ? ` ${error.message}` : "";
      setAssignmentFeedback({ tone: "error", message: `${copy.assignmentFailed}${suffix}` });
    } finally {
      setSavingAssignments(false);
    }
  }

  async function runGovernanceAction(action: GovernanceActionKind) {
    if (governanceAction) {
      return;
    }
    setGovernanceAction(action);
    setGovernanceFeedback(null);
    try {
      const response = await fetch(withAppBasePath(`/api/documents/${encodeURIComponent(document.document_id)}/governance`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action })
      });
      if (!response.ok) {
        throw new Error(await readDocumentWorkflowError(response));
      }
      const payload = (await response.json()) as DocumentGovernanceRunResponse;
      setGovernanceResult(payload);
      setGovernanceFeedback({ tone: "success", message: copy.governanceRunComplete });
    } catch (error) {
      const suffix = error instanceof Error && error.message ? ` ${error.message}` : "";
      setGovernanceFeedback({ tone: "error", message: `${copy.governanceFailed}${suffix}` });
    } finally {
      setGovernanceAction(null);
    }
  }

  async function openDocumentChunkContext(chunkId: string) {
    if (openingSourceChunkId) {
      return;
    }

    setOpeningSourceChunkId(chunkId);
    setSourceContextFeedback(null);
    try {
      const response = await fetch(
        withAppBasePath(`/api/documents/${encodeURIComponent(document.document_id)}/source-context?chunk_id=${encodeURIComponent(chunkId)}`),
        { method: "GET" }
      );
      if (!response.ok) {
        throw new Error(await readDocumentWorkflowError(response));
      }
      const payload = (await response.json()) as { source_context: SourceContext };
      setSourceContext(payload.source_context);
    } catch (error) {
      const suffix = error instanceof Error && error.message ? ` ${error.message}` : "";
      setSourceContextFeedback({ tone: "error", message: `${copy.sourceContextError}${suffix}` });
    } finally {
      setOpeningSourceChunkId(null);
    }
  }

  async function openDocumentSourceContext(signal: SourceContextSignal) {
    await openDocumentChunkContext(signal.chunkId);
  }

  async function prepareSignedSourceOpen() {
    if (!currentVersion || sourceOpenAction) {
      return;
    }

    setSourceOpenAction(true);
    setSourceOpenFeedback(null);
    try {
      const response = await fetch(
        withAppBasePath(`/api/documents/${encodeURIComponent(document.document_id)}/versions/${encodeURIComponent(currentVersion.document_version_id)}/source/open`),
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(await readDocumentWorkflowError(response));
      }
      const payload = (await response.json()) as { source_open: DocumentSourceOpenDecision };
      setSourceOpen(payload.source_open);
      setSourceOpenFeedback({
        tone: payload.source_open.available ? "success" : "error",
        message: payload.source_open.available ? copy.sourceOpenReady : copy.sourceOpenUnavailable
      });
    } catch (error) {
      const suffix = error instanceof Error && error.message ? ` ${error.message}` : "";
      setSourceOpenFeedback({ tone: "error", message: `${copy.sourceOpenError}${suffix}` });
    } finally {
      setSourceOpenAction(false);
    }
  }

  async function proposeDocumentInsights() {
    if (insightsAction) {
      return;
    }

    setInsightsAction(true);
    setInsightsFeedback(null);
    try {
      const response = await fetch(withAppBasePath(`/api/documents/${encodeURIComponent(document.document_id)}/insights/propose`), {
        method: "POST"
      });
      if (!response.ok) {
        throw new Error(await readDocumentWorkflowError(response));
      }
      const payload = (await response.json()) as { insights: ProposedDocumentInsight[] };
      setProposedInsights(payload.insights);
      setInsightsFeedback({ tone: "success", message: copy.insightsGenerated });
    } catch (error) {
      const suffix = error instanceof Error && error.message ? ` ${error.message}` : "";
      setInsightsFeedback({ tone: "error", message: `${copy.insightsFailed}${suffix}` });
    } finally {
      setInsightsAction(false);
    }
  }

  return (
    <div className="stack">
      <StratosButtonLink href="/documents">
        <ArrowLeft size={16} aria-hidden="true" />
        {copy.back}
      </StratosButtonLink>

      <section className="panel">
        <div className="panel__body grid grid--two">
          <div className="stack">
            <div>
              <p className="eyebrow">{documentTypeLabel(document.document_type, language)}</p>
              <h2>{document.title}</h2>
              <p className="muted">{document.document_id} - {document.gestor_unit}</p>
            </div>
            <div className="tag-list">
              <StatusBadge value={document.status} />
              <span className="tag">{document.classification}</span>
              {document.tags.map((tag) => (
                <span className="tag" key={tag}>{tag}</span>
              ))}
            </div>
            <p className="notice">{copy.registryNotice}</p>
          </div>
          <div className="stack">
            <div className="timeline-item">
              <strong>{copy.owner}</strong>
              <span>{document.owner_id}</span>
            </div>
            <div className="timeline-item">
              <strong>{copy.updated}</strong>
              <span>{formatDateTime(document.updated_at, language)}</span>
            </div>
            <div className="timeline-item">
              <strong>{copy.currentVersion}</strong>
              <span>
                {currentVersion
                  ? `${currentVersion.version_label} ${copy.validFrom} ${formatDate(currentVersion.valid_from, language)}`
                  : copy.noVersion}
              </span>
            </div>
          </div>
        </div>
      </section>

      <StratosViewTabs
        ariaLabel={language === "cs" ? "Sekce dokumentu" : "Document sections"}
        value={activeTab}
        onValueChange={setActiveTab}
        items={
          [
            { value: "overview", label: copy.overview, icon: FileSearch },
            { value: "viewer", label: copy.viewer, icon: BookOpenCheck },
            { value: "workflow", label: copy.workflow, icon: ClipboardCheck },
            { value: "insights", label: copy.insights, icon: Brain },
            { value: "versions", label: copy.versionsTab, icon: Layers3 },
            { value: "ingestion", label: copy.ingestionTab, icon: FileClock },
            { value: "audit", label: copy.auditTab, icon: ShieldCheck }
          ] satisfies Array<StratosViewTab<DetailTab>>
        }
      />

      {activeTab === "overview" ? (
        <section className="grid grid--two">
          <div className="panel">
            <div className="panel__header">
              <h2>{copy.overview}</h2>
              <StatusBadge value={document.status} />
            </div>
            <div className="panel__body detail-kv-grid">
              <KeyValue label={copy.type} value={documentTypeLabel(document.document_type, language)} />
              <KeyValue label={copy.classification} value={document.classification} />
              <KeyValue label={copy.owner} value={document.owner_id} />
              <KeyValue label={copy.gestor} value={document.gestor_unit ?? "n/a"} />
              <KeyValue label={copy.updated} value={formatDateTime(document.updated_at, language)} />
              <KeyValue
                label={copy.currentVersion}
                value={
                  currentVersion
                    ? `${currentVersion.version_label} - ${formatDate(currentVersion.valid_from, language)}`
                    : copy.noVersion
                }
              />
            </div>
          </div>
          <div className="panel">
            <div className="panel__header">
              <h2>{copy.requiredActions}</h2>
              <AlertTriangle size={18} aria-hidden="true" />
            </div>
            <div className="panel__body timeline">
              {priorityActions.length > 0 ? (
                priorityActions.map((action) => (
                  <div className="timeline-item" key={action}>
                    <strong>{action}</strong>
                    <span>{copy.currentSignal}</span>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <CircleCheck size={22} aria-hidden="true" />
                  {copy.noActions}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "viewer" ? (
        <section className="grid grid--two">
          <div className="panel">
            <div className="panel__header">
              <div>
                <h2>{copy.sourceContextTitle}</h2>
                <p>{copy.sourceContextDetail}</p>
              </div>
              <StatusBadge value="online" label={sourceContext?.viewer_mode ?? viewerMode} />
            </div>
            <div className="panel__body">
              {sourceContext ? (
                <DocumentSourceContextViewer copy={copy} sourceContext={sourceContext} />
              ) : (
                <div className="source-viewer document-preview">
                  <div className="document-preview__page">
                    <div className="document-preview__ruler" />
                    <h3>{document.title}</h3>
                    <p>{copy.sourceContextPlaceholder}</p>
                    <p>{currentVersion?.change_summary ?? copy.noVersion}</p>
                    <div className="document-preview__highlight" />
                    <div className="document-preview__line" />
                    <div className="document-preview__line document-preview__line--short" />
                  </div>
                </div>
              )}
              {sourceContextFeedback ? (
                <p className={`notice ${sourceContextFeedback.tone === "error" ? "notice--danger" : ""}`} role="status">
                  {sourceContextFeedback.message}
                </p>
              ) : null}
              <DocumentNativePreview copy={copy} sourceContext={sourceContext} sourceOpen={sourceOpen} />
            </div>
          </div>
          <aside className="panel">
            <div className="panel__header">
              <div>
                <h2>{copy.source}</h2>
                <p>{copy.sourceContextSignals}</p>
              </div>
              <LockKeyhole size={18} aria-hidden="true" />
            </div>
            <div className="panel__body stack">
              <KeyValue label={copy.sourceUri} value={currentVersion?.source_file_uri ?? "n/a"} />
              <KeyValue label={copy.sourceHash} value={currentVersion?.file_hash ?? "n/a"} />
              <KeyValue label={copy.viewerMode} value={viewerMode} />
              <div className="source-open-card">
                <div className="source-open-card__header">
                  <FileText size={18} aria-hidden="true" />
                  <span className="cell-title">
                    <strong>{copy.sourceOpenTitle}</strong>
                    <span>{copy.sourceOpenDetail}</span>
                  </span>
                </div>
                <button
                  className="button button--primary"
                  disabled={!currentVersion || sourceOpenAction}
                  type="button"
                  onClick={() => {
                    void prepareSignedSourceOpen();
                  }}
                >
                  <Download size={16} aria-hidden="true" />
                  {sourceOpenAction ? copy.sourceOpening : copy.requestSourceOpen}
                </button>
                {sourceOpen ? (
                  <div className="detail-kv-grid detail-kv-grid--compact">
                    <KeyValue
                      label={copy.storageAvailability}
                      value={sourceOpen.available ? copy.available : copy.unavailable}
                    />
                    <KeyValue label={copy.expiresAt} value={formatDateTime(sourceOpen.expires_at, language)} />
                    <KeyValue label={copy.sourceUri} value={sourceOpen.source_file_uri} />
                    <KeyValue label={copy.viewerMode} value={sourceOpen.viewer_mode} />
                  </div>
                ) : null}
                {sourceOpen?.available && sourceOpen.download_url ? (
                  <div className="source-viewer__actions">
                    <a className="button button--primary" href={withAppBasePath(sourceOpen.download_url)} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} aria-hidden="true" />
                      {copy.openSignedSource}
                    </a>
                    {citationPageUrl ? (
                      <a className="button button--primary" href={citationPageUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={16} aria-hidden="true" />
                        {copy.openCitationPage}
                      </a>
                    ) : null}
                    <a className="button" href={withAppBasePath(sourceOpen.download_url)} download={sourceOpen.file.filename}>
                      <Download size={16} aria-hidden="true" />
                      {copy.downloadSignedSource}
                    </a>
                  </div>
                ) : null}
                {sourceContext?.location.page_number && !citationPageUrl ? (
                  <p className="notice">{copy.citationPageUnavailable}</p>
                ) : null}
                {sourceOpenFeedback ? (
                  <p className={`notice ${sourceOpenFeedback.tone === "error" ? "notice--danger" : ""}`} role="status">
                    {sourceOpenFeedback.message}
                  </p>
                ) : null}
              </div>
              {sourceContextSignals.length > 0 ? (
                <div className="source-context-list">
                  {sourceContextSignals.map((signal) => (
                    <div className="source-context-signal" key={signal.chunkId}>
                      <FileText size={18} aria-hidden="true" />
                      <span className="cell-title">
                        <strong>{signal.title}</strong>
                        <span>{signal.detail}</span>
                        <span>{formatDateTime(signal.createdAt, language)}</span>
                      </span>
                      <button
                        aria-label={`${copy.openSourceContext} ${signal.chunkId}`}
                        className="button"
                        disabled={openingSourceChunkId !== null}
                        type="button"
                        onClick={() => {
                          void openDocumentSourceContext(signal);
                        }}
                      >
                        <ExternalLink size={16} aria-hidden="true" />
                        {openingSourceChunkId === signal.chunkId ? copy.openingSourceContext : copy.openSourceContext}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <AlertTriangle size={22} aria-hidden="true" />
                  {copy.sourceContextEmpty}
                </div>
              )}
              <p className="notice">{copy.viewerNotice}</p>
            </div>
          </aside>
        </section>
      ) : null}

      {activeTab === "workflow" ? (
        <div className="stack">
          <section className="grid grid--two">
            <div className="panel">
              <div className="panel__header">
                <h2>{copy.workflowTitle}</h2>
                <ShieldCheck size={18} aria-hidden="true" />
              </div>
              <div className="panel__body workflow-rail">
                {[
                  { label: copy.workflowDraft, detail: copy.workflowDraftDetail, done: document.status !== "cancelled" },
                  { label: copy.workflowIngestion, detail: copy.workflowIngestionDetail, done: relatedJobs.length > 0 },
                  {
                    label: copy.workflowReview,
                    detail: copy.workflowReviewDetail,
                    done: ["review", "approved", "valid"].includes(document.status)
                  },
                  {
                    label: copy.workflowApproved,
                    detail: copy.workflowApprovedDetail,
                    done: ["approved", "valid"].includes(document.status)
                  },
                  { label: copy.workflowPublish, detail: copy.workflowPublishDetail, done: document.status === "valid" },
                  {
                    label: copy.workflowArchive,
                    detail: copy.workflowArchiveDetail,
                    done: versions.some((version) => ["superseded", "archived"].includes(version.status))
                  }
                ].map((step) => (
                  <div className={`workflow-step ${step.done ? "workflow-step--done" : ""}`} key={step.label}>
                    <span aria-hidden="true">{step.done ? <CircleCheck size={16} /> : <FileClock size={16} />}</span>
                    <div>
                      <strong>{step.label}</strong>
                      <p>{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel">
              <div className="panel__header">
                <h2>{copy.governanceTitle}</h2>
                <Network size={18} aria-hidden="true" />
              </div>
              <div className="panel__body stack">
                <p className="muted">{copy.governanceDetail}</p>
                <div className="governance-action-grid">
                  {[
                    {
                      action: "compare_versions" as const,
                      icon: GitCompareArrows,
                      label: copy.compareVersions,
                      detail: copy.compareVersionsDetail,
                      enabled: versions.length > 1
                    },
                    {
                      action: "check_compliance" as const,
                      icon: ClipboardCheck,
                      label: copy.complianceCheck,
                      detail: copy.complianceCheckDetail,
                      enabled: document.status !== "archived"
                    },
                    {
                      action: "detect_conflicts" as const,
                      icon: ShieldCheck,
                      label: copy.conflictDetection,
                      detail: copy.conflictDetectionDetail,
                      enabled: document.status === "review"
                    }
                  ].map((item) => (
                    <GovernanceAction
                      action={item.action}
                      detail={item.detail}
                      enabled={item.enabled}
                      icon={item.icon}
                      key={item.action}
                      label={item.label}
                      running={governanceAction === item.action}
                      runLabel={copy.governanceRun}
                      runningLabel={copy.governanceRunning}
                      unavailableLabel={copy.governanceUnavailable}
                      onRun={runGovernanceAction}
                    />
                  ))}
                </div>
                {governanceFeedback ? (
                  <div
                    className={`notice ${governanceFeedback.tone === "error" ? "notice--danger" : ""}`}
                    role={governanceFeedback.tone === "error" ? "alert" : "status"}
                  >
                    {governanceFeedback.message}
                  </div>
                ) : null}
                {governanceResult ? <GovernanceResultPanel run={governanceResult} copy={copy} language={language} /> : null}
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>{copy.assignmentsTitle}</h2>
                <p>{copy.assignmentsDetail}</p>
              </div>
              <StatusBadge value="info" label={String(assignmentRows.length)} />
            </div>
            <div className="panel__body stack">
              {assignmentRows.length > 0 ? (
                <div className="assignment-editor">
                  {assignmentRows.map((row, index) => (
                    <div className="assignment-row" key={row.id}>
                      <StratosSelect
                        id={`assignment-role-${row.id}`}
                        label={copy.assignmentRole}
                        aria-label={`${copy.assignmentRole} ${index + 1}`}
                        value={row.role}
                        onChange={(event) =>
                          updateAssignmentRow(row.id, { role: event.target.value as DocumentAssignmentRole })
                        }
                      >
                          {assignmentRoles.map((role) => (
                            <option key={role} value={role}>
                              {assignmentRoleLabel(role, language)}
                            </option>
                          ))}
                      </StratosSelect>
                      <StratosSelect
                        id={`assignment-subject-type-${row.id}`}
                        label={copy.assignmentSubjectType}
                        aria-label={`${copy.assignmentSubjectType} ${index + 1}`}
                        value={row.subject_type}
                        onChange={(event) =>
                          updateAssignmentRow(row.id, { subject_type: event.target.value as AssignmentSubjectType })
                        }
                      >
                          {assignmentSubjectTypes.map((subjectType) => (
                            <option key={subjectType} value={subjectType}>
                              {subjectType}
                            </option>
                          ))}
                      </StratosSelect>
                      <label className="field">
                        <span>{copy.assignmentSubjectId}</span>
                        <input
                          aria-label={`${copy.assignmentSubjectId} ${index + 1}`}
                          value={row.subject_id}
                          onChange={(event) => updateAssignmentRow(row.id, { subject_id: event.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>{copy.assignmentLabel}</span>
                        <input
                          aria-label={`${copy.assignmentLabel} ${index + 1}`}
                          value={row.display_label}
                          onChange={(event) => updateAssignmentRow(row.id, { display_label: event.target.value })}
                        />
                      </label>
                      <label className="field assignment-row__sla">
                        <span>{copy.assignmentSla}</span>
                        <input
                          aria-label={`${copy.assignmentSla} ${index + 1}`}
                          min="1"
                          max="365"
                          type="number"
                          value={row.sla_days}
                          onChange={(event) => updateAssignmentRow(row.id, { sla_days: event.target.value })}
                        />
                      </label>
                      <StratosSelect
                        id={`assignment-escalation-subject-type-${row.id}`}
                        label={copy.assignmentEscalationType}
                        aria-label={`${copy.assignmentEscalationType} ${index + 1}`}
                        value={row.escalation_subject_type}
                        onChange={(event) =>
                          updateAssignmentRow(row.id, {
                            escalation_subject_type: event.target.value as AssignmentSubjectType
                          })
                        }
                      >
                          {assignmentSubjectTypes.map((subjectType) => (
                            <option key={subjectType} value={subjectType}>
                              {subjectType}
                            </option>
                          ))}
                      </StratosSelect>
                      <label className="field">
                        <span>{copy.assignmentEscalationId}</span>
                        <input
                          aria-label={`${copy.assignmentEscalationId} ${index + 1}`}
                          value={row.escalation_subject_id}
                          onChange={(event) => updateAssignmentRow(row.id, { escalation_subject_id: event.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>{copy.assignmentEscalation}</span>
                        <input
                          aria-label={`${copy.assignmentEscalation} ${index + 1}`}
                          value={row.escalation_label}
                          onChange={(event) => updateAssignmentRow(row.id, { escalation_label: event.target.value })}
                        />
                      </label>
                      <label className="checkbox-field">
                        <input
                          checked={row.is_primary}
                          type="checkbox"
                          onChange={(event) => updateAssignmentRow(row.id, { is_primary: event.target.checked })}
                        />
                        <span>{copy.assignmentPrimary}</span>
                      </label>
                      <label className="checkbox-field">
                        <input
                          checked={row.active}
                          type="checkbox"
                          onChange={(event) => updateAssignmentRow(row.id, { active: event.target.checked })}
                        />
                        <span>{copy.assignmentActive}</span>
                      </label>
                      <button
                        aria-label={`${copy.assignmentRemove} ${index + 1}`}
                        className="button assignment-row__remove"
                        type="button"
                        onClick={() => removeAssignmentRow(row.id)}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        {copy.assignmentRemove}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <AlertTriangle size={22} aria-hidden="true" />
                  {copy.assignmentsEmpty}
                </div>
              )}
              <div className="task-actions">
                <button className="button" type="button" onClick={addAssignmentRow}>
                  <Plus size={16} aria-hidden="true" />
                  {copy.assignmentAdd}
                </button>
                <button
                  className="button button--primary"
                  disabled={!authorization.can_update || savingAssignments}
                  type="button"
                  onClick={() => {
                    void saveAssignments();
                  }}
                >
                  <Save size={16} aria-hidden="true" />
                  {savingAssignments ? copy.assignmentSaving : copy.assignmentSave}
                </button>
                {!authorization.can_update ? <span className="muted">{copy.assignmentNoPermission}</span> : null}
                {assignmentFeedback ? (
                  <div
                    className={`notice ${assignmentFeedback.tone === "error" ? "notice--danger" : ""}`}
                    role={assignmentFeedback.tone === "error" ? "alert" : "status"}
                  >
                    {assignmentFeedback.message}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>{copy.publishGateTitle}</h2>
                <p>
                  {authorization.can_publish
                    ? document.status === "valid"
                      ? copy.publishGatePublished
                      : document.status === "archived"
                      ? copy.publishGateArchived
                      : document.status === "approved"
                      ? copy.publishGateReady
                      : copy.publishGateLocked
                    : copy.publishGateNoPermission}
                </p>
              </div>
              <StatusBadge value={document.status} />
            </div>
            <div className="panel__body task-actions">
              {currentVersion ? (
                <>
                  <button
                    className="button button--primary"
                    disabled={!canPublishCurrentVersion || Boolean(workflowAction)}
                    type="button"
                    onClick={() => {
                      void submitVersionAction("publish");
                    }}
                  >
                    {workflowAction === "publish" ? copy.publishing : copy.publishApproved}
                  </button>
                  <button
                    className="button"
                    disabled={!canArchiveCurrentVersion || Boolean(workflowAction)}
                    type="button"
                    onClick={() => {
                      void submitVersionAction("archive");
                    }}
                  >
                    {workflowAction === "archive" ? copy.archiving : copy.archiveCurrent}
                  </button>
                </>
              ) : null}
              {workflowFeedback ? (
                <div className={`notice ${workflowFeedback.tone === "error" ? "notice--danger" : ""}`}>
                  {workflowFeedback.message}
                </div>
              ) : null}
            </div>
          </section>
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>{copy.workflowTasksTitle}</h2>
                <p>{copy.workflowTasksDetail}</p>
              </div>
              <StatusBadge value="info" label={String(sortedWorkflowTasks.length)} />
            </div>
            <div className="panel__body timeline workflow-task-history">
              {sortedWorkflowTasks.length > 0 ? (
                sortedWorkflowTasks.map((task) => (
                  <div className="timeline-item workflow-task-history__item" key={task.task_id}>
                    <div className="workflow-task-history__title">
                      <strong>{task.title}</strong>
                      <StatusBadge value={workflowTaskStatusTone(task.status)} label={workflowTaskStatusLabel(task.status, language)} />
                    </div>
                    <span>{task.owner_label} - {task.role}</span>
                    <span>{copy.source}: {task.source}</span>
                    <span>{copy.taskDue}: {formatDateTime(task.due_at, language)}</span>
                    {task.resolved_at ? <span>{copy.resolved}: {formatDateTime(task.resolved_at, language)}</span> : null}
                    {workflowLastAction(task.metadata.last_action) ? (
                      <span>{copy.lastAction}: {workflowLastAction(task.metadata.last_action)}</span>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <CircleCheck size={22} aria-hidden="true" />
                  {copy.workflowTasksEmpty}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "insights" ? (
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>{copy.insightsTitle}</h2>
              <p>{copy.insightsNotPersisted}</p>
            </div>
            <StratosButton type="button" onClick={() => void proposeDocumentInsights()} disabled={insightsAction}>
              <Brain size={18} aria-hidden="true" />
              {insightsAction ? copy.insightsGenerating : copy.insightsGenerate}
            </StratosButton>
          </div>
          <div className="panel__body stack">
            {insightsFeedback ? (
              <div className={`notice ${insightsFeedback.tone === "error" ? "notice--danger" : ""}`} role={insightsFeedback.tone === "error" ? "alert" : "status"}>
                {insightsFeedback.message}
              </div>
            ) : null}
            <div className="insight-grid">
              {(proposedInsights ?? defaultInsightPlaceholders(copy)).map((insight) => (
                <article className="insight-item" key={insight.insight_id}>
                  <StatusBadge value="draft" label={copy.proposed} />
                  <strong>{insight.title}</strong>
                  <p>{insight.summary}</p>
                  {"confidence" in insight ? <small>Confidence: {insight.confidence}</small> : null}
                  {"citations" in insight && insight.citations.length > 0 ? (
                    <small>{copy.insightCitation}: {insight.citations[0]?.section_path.join(" / ")}</small>
                  ) : null}
                  {"warnings" in insight && insight.warnings.length > 0 ? (
                    <small>{copy.insightWarnings}: {insight.warnings.join(", ")}</small>
                  ) : null}
                </article>
              ))}
            </div>
            {proposedInsights?.length === 0 ? <div className="empty-state">{copy.insightsEmpty}</div> : null}
          </div>
        </section>
      ) : null}

      {activeTab === "versions" ? (
        <section className="panel" id="versions">
          <div className="panel__header">
            <h2>{copy.versionHistory}</h2>
            {authorization.can_ingest ? (
              <StratosButtonLink href="/upload">
                <UploadCloud size={16} aria-hidden="true" />
                {copy.upload}
              </StratosButtonLink>
            ) : null}
          </div>
          <StratosDataTable
            aria-label={copy.versionHistory}
            rows={versions}
            getRowId={(version) => version.document_version_id}
            columns={[
              {
                id: "version",
                label: copy.version,
                sortable: true,
                sortAccessor: (version) => version.version_label,
                render: (version) => (
                  <span className="cell-title">
                    <strong>{version.version_label}</strong>
                    <span>{version.document_version_id}</span>
                  </span>
                )
              },
              {
                id: "status",
                label: copy.status,
                width: 130,
                sortable: true,
                sortAccessor: (version) => version.status,
                render: (version) => <StatusBadge value={version.status} />
              },
              {
                id: "validity",
                label: copy.validity,
                sortable: true,
                sortAccessor: (version) => version.valid_from,
                render: (version) => `${formatDate(version.valid_from, language)} - ${formatDate(version.valid_to, language)}`
              },
              {
                id: "changeSummary",
                label: copy.changeSummary,
                render: (version) => version.change_summary
              }
            ]}
          />
        </section>
      ) : null}

      {activeTab === "ingestion" ? (
        <section className="panel">
          <div className="panel__header">
            <h2>{copy.ingestionStatus}</h2>
            <FileClock size={18} aria-hidden="true" />
          </div>
          <div className="panel__body timeline">
            {relatedJobs.length > 0 ? (
              relatedJobs.map((job) => (
                <div className="timeline-item" key={job.job_id}>
                  <strong>
                    {job.job_id} <StatusBadge value={job.status} />
                  </strong>
                  <span>{job.chunking_strategy} - {copy.created} {formatDateTime(job.created_at, language)}</span>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <CircleCheck size={22} aria-hidden="true" />
                {copy.noJob}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "audit" ? (
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>{copy.auditTitle}</h2>
              <p>{copy.auditDetail}</p>
            </div>
            <StatusBadge value="info" label={String(documentAuditTraces.length)} />
          </div>
          {!authorization.can_read_audit ? (
            <div className="panel__body">
              <div className="empty-state">
                <ShieldCheck size={22} aria-hidden="true" />
                {copy.auditHidden}
              </div>
            </div>
          ) : documentAuditTraces.length === 0 ? (
            <div className="panel__body">
              <div className="empty-state">
                <CircleCheck size={22} aria-hidden="true" />
                {copy.auditEmpty}
              </div>
            </div>
          ) : (
            <StratosDataTable
              aria-label={copy.auditTitle}
              rows={documentAuditTraces}
              getRowId={(trace) => trace.event.audit_event_id}
              columns={auditTraceColumns(copy, language)}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}

function sourceContextSignalsForDocument({
  document,
  versions,
  auditEvents,
  copy
}: {
  document: Document;
  versions: DocumentVersion[];
  auditEvents: AuditEvent[];
  copy: Record<string, string>;
}): SourceContextSignal[] {
  const versionIds = new Set(versions.map((version) => version.document_version_id));
  const signals = new Map<string, SourceContextSignal>();

  for (const event of auditEvents) {
    const metadata = event.metadata;
    const metadataDocumentId = metadataString(metadata.document_id);
    const metadataVersionId = metadataString(metadata.document_version_id);
    const metadataChunkId = metadataString(metadata.chunk_id);
    const metadataPageNumber = metadataString(metadata.page_number);
    const metadataSourceUri = metadataString(metadata.source_file_uri);
    const isSourceEvent =
      event.event_type.includes("citation.") ||
      event.event_type.includes("chunk.") ||
      event.resource_type.includes("chunk");
    const linkedToDocument =
      metadataDocumentId === document.document_id ||
      (metadataVersionId !== null && versionIds.has(metadataVersionId)) ||
      metadataSourceUri?.includes(document.document_id);
    const chunkId = metadataChunkId ?? (event.resource_type.includes("chunk") ? event.resource_id : null);

    if (!isSourceEvent || !linkedToDocument || chunkId === null) {
      continue;
    }

    const detailParts = [
      metadataVersionId ? `${copy.version} ${metadataVersionId}` : null,
      metadataPageNumber ? `${copy.page} ${metadataPageNumber}` : null,
      metadataSourceUri
    ].filter((part): part is string => part !== null);
    const existing = signals.get(chunkId);
    if (existing && existing.createdAt >= event.created_at) {
      continue;
    }
    signals.set(chunkId, {
      chunkId,
      title: event.event_type,
      detail: detailParts.length > 0 ? detailParts.join(" / ") : event.resource_type,
      createdAt: event.created_at
    });
  }

  return Array.from(signals.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function auditTracesForDocument({
  document,
  versions,
  relatedJobs,
  assignments,
  workflowTasks,
  auditEvents,
  copy
}: {
  document: Document;
  versions: DocumentVersion[];
  relatedJobs: IngestionJob[];
  assignments: DocumentAssignment[];
  workflowTasks: RegistryWorkflowTask[];
  auditEvents: AuditEvent[];
  copy: Record<string, string>;
}): AuditTrace[] {
  const documentIds = new Set([document.document_id]);
  const versionIds = new Set(versions.map((version) => version.document_version_id));
  const workflowTaskIds = new Set(workflowTasks.map((task) => task.task_id));
  const assignmentIds = new Set(assignments.map((assignment) => assignment.assignment_id));
  const jobIds = new Set(relatedJobs.map((job) => job.job_id));

  return auditEvents
    .map((event) => {
      const scopes = new Set<string>();
      const metadata = event.metadata;
      const metadataDocumentId = metadataString(metadata.document_id);
      const metadataVersionId = metadataString(metadata.document_version_id);
      const metadataJobId = metadataString(metadata.job_id);
      const metadataSourceUri = metadataString(metadata.source_file_uri);

      if (documentIds.has(event.resource_id) || metadataDocumentId === document.document_id) {
        scopes.add(copy.auditScopeDocument);
      }
      if (versionIds.has(event.resource_id) || (metadataVersionId !== null && versionIds.has(metadataVersionId))) {
        scopes.add(copy.auditScopeVersion);
      }
      if (workflowTaskIds.has(event.resource_id)) {
        scopes.add(copy.auditScopeWorkflow);
      }
      if (assignmentIds.has(event.resource_id) || event.event_type.includes("assignment") || event.resource_type.includes("assignment")) {
        scopes.add(copy.auditScopeAssignment);
      }
      if (jobIds.has(event.resource_id) || (metadataJobId !== null && jobIds.has(metadataJobId))) {
        scopes.add(copy.auditScopeIngestion);
      }
      if (
        metadataSourceUri?.includes(document.document_id) ||
        event.event_type.includes("citation.") ||
        event.event_type.includes("chunk.") ||
        event.resource_type.includes("chunk")
      ) {
        if (metadataDocumentId === document.document_id || metadataSourceUri?.includes(document.document_id)) {
          scopes.add(copy.auditScopeSource);
        }
      }

      return scopes.size > 0 ? { event, scopes: Array.from(scopes) } : null;
    })
    .filter((trace): trace is AuditTrace => trace !== null)
    .sort((left, right) => right.event.created_at.localeCompare(left.event.created_at));
}

function metadataString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function auditMetadataSummary(metadata: AuditEvent["metadata"]): string {
  const entries = Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}=${String(value)}`);
  return entries.length > 0 ? entries.join(", ") : "n/a";
}

function auditTraceColumns(
  copy: (typeof detailCopy)[AklLanguage],
  language: AklLanguage
): Array<StratosDataTableColumn<AuditTrace>> {
  return [
    {
      id: "event",
      label: copy.auditEvent,
      sortable: true,
      sortAccessor: (trace) => trace.event.event_type,
      render: (trace) => (
        <span className="cell-title">
          <strong>{trace.event.event_type}</strong>
          <span>{trace.event.audit_event_id}</span>
          <span>{copy.auditMetadata}: {auditMetadataSummary(trace.event.metadata)}</span>
        </span>
      )
    },
    {
      id: "severity",
      label: copy.auditSeverity,
      width: 120,
      sortable: true,
      sortAccessor: (trace) => trace.event.severity,
      render: (trace) => <StatusBadge value={trace.event.severity} />
    },
    {
      id: "actor",
      label: copy.auditActor,
      sortable: true,
      sortAccessor: (trace) => trace.event.actor_id,
      render: (trace) => trace.event.actor_id
    },
    {
      id: "resource",
      label: copy.auditResource,
      render: (trace) => (
        <span className="cell-title">
          <strong>{trace.event.resource_type}</strong>
          <span>{trace.event.resource_id}</span>
        </span>
      )
    },
    {
      id: "scope",
      label: copy.auditScope,
      render: (trace) => (
        <div className="tag-list">
          {trace.scopes.map((scope) => (
            <span className="tag" key={`${trace.event.audit_event_id}-${scope}`}>{scope}</span>
          ))}
        </div>
      )
    },
    {
      id: "correlation",
      label: copy.auditCorrelation,
      render: (trace) => trace.event.correlation_id
    },
    {
      id: "created",
      label: copy.auditCreated,
      width: 170,
      sortable: true,
      sortAccessor: (trace) => trace.event.created_at,
      render: (trace) => formatDateTime(trace.event.created_at, language)
    }
  ];
}

function assignmentRowsFrom(assignments: DocumentAssignment[], documentId: string): AssignmentFormRow[] {
  if (assignments.length === 0) {
    return [newAssignmentRow(documentId)];
  }
  return assignments.map((assignment) => ({
    id: assignment.assignment_id,
    role: assignment.role,
    subject_type: assignment.subject_type,
    subject_id: assignment.subject_id,
    display_label: assignment.display_label ?? "",
    is_primary: assignment.is_primary,
    active: assignment.active,
    sla_days: assignment.sla_days === null ? "" : String(assignment.sla_days),
    escalation_subject_type: assignment.escalation_subject_type ?? "unit",
    escalation_subject_id: assignment.escalation_subject_id ?? "",
    escalation_label: assignment.escalation_label ?? ""
  }));
}

function newAssignmentRow(documentId: string): AssignmentFormRow {
  return {
    id: `new_${documentId}_${Date.now()}`,
    role: "reviewer",
    subject_type: "user",
    subject_id: "",
    display_label: "",
    is_primary: false,
    active: true,
    sla_days: "3",
    escalation_subject_type: "unit",
    escalation_subject_id: "",
    escalation_label: ""
  };
}

function assignmentPayloadFromRow(row: AssignmentFormRow): DocumentAssignmentInput {
  const slaDays = Number.parseInt(row.sla_days, 10);
  const escalationSubjectId = row.escalation_subject_id.trim();
  return {
    role: row.role,
    subject_type: row.subject_type,
    subject_id: row.subject_id.trim(),
    display_label: row.display_label.trim() || null,
    is_primary: row.is_primary,
    active: row.active,
    sla_days: Number.isFinite(slaDays) ? slaDays : null,
    escalation_subject_type: escalationSubjectId ? row.escalation_subject_type : null,
    escalation_subject_id: escalationSubjectId || null,
    escalation_label: row.escalation_label.trim() || null,
    metadata: {
      source: "web.document_detail"
    }
  };
}

function assignmentRoleLabel(role: DocumentAssignmentRole, language: AklLanguage): string {
  const labels = {
    cs: {
      owner: "vlastník",
      gestor: "gestor",
      reviewer: "revizor",
      approver: "schvalovatel",
      auditor: "auditor",
      steward: "správce znalosti"
    },
    en: {
      owner: "owner",
      gestor: "gestor",
      reviewer: "reviewer",
      approver: "approver",
      auditor: "auditor",
      steward: "steward"
    }
  } satisfies Record<AklLanguage, Record<DocumentAssignmentRole, string>>;
  return labels[language][role];
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-kv">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function defaultInsightPlaceholders(copy: Record<string, string>): ProposedDocumentInsight[] {
  return [
    {
      insight_id: "placeholder_obligation",
      kind: "obligation",
      title: copy.insightObligation,
      summary: copy.insightObligationDetail,
      status: "proposed",
      confidence: "low",
      citations: [],
      warnings: []
    },
    {
      insight_id: "placeholder_roles",
      kind: "role",
      title: copy.insightRoles,
      summary: copy.insightRolesDetail,
      status: "proposed",
      confidence: "low",
      citations: [],
      warnings: []
    },
    {
      insight_id: "placeholder_deadlines",
      kind: "deadline",
      title: copy.insightDeadlines,
      summary: copy.insightDeadlinesDetail,
      status: "proposed",
      confidence: "low",
      citations: [],
      warnings: []
    },
    {
      insight_id: "placeholder_risks",
      kind: "risk",
      title: copy.insightRisk,
      summary: copy.insightRiskDetail,
      status: "proposed",
      confidence: "low",
      citations: [],
      warnings: []
    }
  ];
}

function GovernanceAction({
  action,
  detail,
  enabled,
  icon: Icon,
  label,
  running,
  runLabel,
  runningLabel,
  unavailableLabel,
  onRun
}: {
  action: GovernanceActionKind;
  detail: string;
  enabled: boolean;
  icon: typeof GitCompareArrows;
  label: string;
  running: boolean;
  runLabel: string;
  runningLabel: string;
  unavailableLabel: string;
  onRun: (action: GovernanceActionKind) => Promise<void>;
}) {
  return (
    <div className={`governance-action ${enabled ? "governance-action--enabled" : ""}`}>
      <Icon size={18} aria-hidden="true" />
      <span className="cell-title">
        <strong>{label}</strong>
        <span>{detail}</span>
      </span>
      <StratosButton
        aria-label={`${runLabel} ${label}`}
        disabled={!enabled || running}
        type="button"
        onClick={() => {
          void onRun(action);
        }}
      >
        {running ? runningLabel : enabled ? runLabel : unavailableLabel}
      </StratosButton>
    </div>
  );
}

function GovernanceResultPanel({
  run,
  copy,
  language
}: {
  run: DocumentGovernanceRunResponse;
  copy: Record<string, string>;
  language: AklLanguage;
}) {
  const result = run.result;
  const metrics = governanceMetrics(result);
  const items = governanceResultItems(result);
  const citations = governanceCitations(result);

  return (
    <section className="governance-result" aria-label={copy.governanceResultTitle}>
      <div className="governance-result__header">
        <div>
          <h3>{copy.governanceResultTitle}</h3>
          <p>{result.summary}</p>
        </div>
        <StatusBadge value={result.confidence} label={`${copy.governanceConfidence}: ${result.confidence}`} />
      </div>
      <div className="detail-kv-grid detail-kv-grid--compact">
        <KeyValue label={copy.governanceResultId} value={result.result_id} />
        <KeyValue label={copy.governanceGenerated} value={formatDateTime(run.generated_at, language)} />
      </div>
      {metrics.length > 0 ? (
        <div className="stack">
          <strong>{copy.governanceCounts}</strong>
          <div className="tag-list">
            {metrics.map((metric) => (
              <span className="tag" key={metric}>{metric}</span>
            ))}
          </div>
        </div>
      ) : null}
      {items.length > 0 ? (
        <div className="timeline">
          <strong>{copy.governanceFindings}</strong>
          {items.map((item) => (
            <div className="timeline-item" key={item}>
              <span>{item}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <CircleCheck size={18} aria-hidden="true" />
          {copy.governanceNoItems}
        </div>
      )}
      {result.missing_information ? (
        <div className="notice notice--danger">
          <strong>{copy.governanceMissing}: </strong>
          {result.missing_information}
        </div>
      ) : null}
      <GovernanceList title={copy.governanceSourceLimitations} items={run.source_limitations} />
      <GovernanceList title={copy.governanceWarnings} items={result.warnings} />
      <GovernanceList title={copy.governanceCitations} items={citations.map(citationLabel)} />
    </section>
  );
}

function GovernanceList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="stack">
      <strong>{title}</strong>
      <div className="tag-list">
        {items.map((item) => (
          <span className="tag" key={item}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function DocumentNativePreview({
  copy,
  sourceContext,
  sourceOpen
}: {
  copy: Record<string, string>;
  sourceContext: SourceContext | null;
  sourceOpen: DocumentSourceOpenDecision | null;
}) {
  const [preview, setPreview] = useState<{ status: "idle" | "loading" | "ready" | "error"; text: string; truncated: boolean }>({
    status: "idle",
    text: "",
    truncated: false
  });
  const [structuredPreview, setStructuredPreview] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    preview: NativeStructuredPreview | null;
  }>({
    status: "idle",
    preview: null
  });
  const sourceUrl = sourceOpen?.download_url ?? null;
  const sourcePreviewUrl = sourceUrl ? sourcePreviewUrlForSourceUrl(sourceUrl) : null;
  const previewUrl =
    sourceUrl && sourceContext?.location.page_number ? sourceUrlWithPageFragment(sourceUrl, sourceContext.location.page_number) : sourceUrl;
  const previewKind = sourceOpen ? nativePreviewKind(sourceOpen) : "waiting";
  const locationParts = sourceContext ? sourceContextLocationParts(sourceContext, copy) : [];

  useEffect(() => {
    if (!sourceUrl || !sourceOpen?.available || !sourcePreviewNeedsFetch(previewKind)) {
      setPreview({ status: "idle", text: "", truncated: false });
      return;
    }

    let cancelled = false;
    setPreview({ status: "loading", text: "", truncated: false });

    fetch(withAppBasePath(sourceUrl), { headers: { Accept: "text/plain, text/markdown, text/csv, */*" } })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.text();
      })
      .then((text) => {
        if (cancelled) return;
        const maxPreviewLength = 18_000;
        setPreview({
          status: "ready",
          text: text.slice(0, maxPreviewLength),
          truncated: text.length > maxPreviewLength
        });
      })
      .catch(() => {
        if (cancelled) return;
        setPreview({ status: "error", text: "", truncated: false });
      });

    return () => {
      cancelled = true;
    };
  }, [previewKind, sourceOpen?.available, sourceUrl]);

  useEffect(() => {
    if (!sourcePreviewUrl || !sourceOpen?.available || !sourcePreviewNeedsStructuredFetch(previewKind)) {
      setStructuredPreview({ status: "idle", preview: null });
      return;
    }

    let cancelled = false;
    setStructuredPreview({ status: "loading", preview: null });

    fetch(withAppBasePath(sourcePreviewUrl), { headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<{ source_preview: NativeStructuredPreview }>;
      })
      .then((payload) => {
        if (cancelled) return;
        setStructuredPreview({ status: "ready", preview: payload.source_preview });
      })
      .catch(() => {
        if (cancelled) return;
        setStructuredPreview({ status: "error", preview: null });
      });

    return () => {
      cancelled = true;
    };
  }, [previewKind, sourceOpen?.available, sourcePreviewUrl]);

  return (
    <section className="native-preview" aria-label={copy.nativePreviewTitle}>
      <div className="native-preview__header">
        <div>
          <h3>{copy.nativePreviewTitle}</h3>
          <p>{copy.nativePreviewDetail}</p>
        </div>
        <StatusBadge value={sourceOpen?.available ? "online" : "queued"} label={sourceOpen?.viewer_mode ?? "pending"} />
      </div>
      {locationParts.length > 0 ? (
        <div className="source-viewer__meta" aria-label={copy.nativePreviewCitationLocation}>
          <strong>{copy.nativePreviewCitationLocation}</strong>
          {locationParts.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </div>
      ) : null}
      {!sourceOpen ? (
        <div className="empty-state empty-state--inline">
          <FileSearch size={22} aria-hidden="true" />
          {copy.nativePreviewWaiting}
        </div>
      ) : null}
      {sourceOpen && !sourceOpen.available ? (
        <div className="empty-state empty-state--inline">
          <AlertTriangle size={22} aria-hidden="true" />
          {copy.nativePreviewUnavailable}
        </div>
      ) : null}
      {sourceOpen?.available && previewKind === "pdf" && previewUrl ? (
        <>
          <StratosPdfViewer
            bbox={sourceContext?.location.bbox ?? undefined}
            highlightText={sourceContext?.chunk_text ?? ""}
            labels={{
              title: copy.nativePreviewPdfRenderedTitle,
              detail: copy.nativePreviewPdfRenderedDetail,
              loading: copy.nativePreviewLoading,
              error: copy.nativePreviewPdfFallback,
              page: copy.page,
              textHighlight: copy.nativePreviewPdfTextHighlight,
              bbox: copy.nativePreviewPdfBbox
            }}
            pageNumber={sourceContext?.location.page_number ?? 1}
            sourceUrl={withAppBasePath(previewUrl)}
          />
          <PdfCitationLocator copy={copy} sourceContext={sourceContext} />
        </>
      ) : null}
      {sourceOpen?.available && previewKind === "image" && previewUrl ? (
        <ImageNativePreview copy={copy} sourceContext={sourceContext} sourceUrl={previewUrl} />
      ) : null}
      {sourceOpen?.available && sourcePreviewNeedsFetch(previewKind) ? (
        <TextualNativePreview copy={copy} preview={preview} previewKind={previewKind} sourceContext={sourceContext} />
      ) : null}
      {sourceOpen?.available && sourcePreviewNeedsStructuredFetch(previewKind) ? (
        <StructuredNativePreview copy={copy} preview={structuredPreview} sourceContext={sourceContext} />
      ) : null}
      {sourceOpen?.available && previewKind === "unsupported" ? (
        <div className="empty-state empty-state--inline">
          <FileText size={22} aria-hidden="true" />
          {copy.nativePreviewUnsupported}
        </div>
      ) : null}
    </section>
  );
}

function ImageNativePreview({
  copy,
  sourceContext,
  sourceUrl
}: {
  copy: Record<string, string>;
  sourceContext: SourceContext | null;
  sourceUrl: string;
}) {
  const bbox = sourceContext?.location.bbox ? bboxToPercentStyle(sourceContext.location.bbox) : null;

  return (
    <div className="native-preview__image-frame">
      <img alt={copy.nativePreviewImageAlt} className="native-preview__image" src={sourceUrl} />
      {bbox ? (
        <span
          aria-label={copy.nativePreviewOcrBbox}
          className="native-preview__bbox"
          role="img"
          style={bbox}
          title={copy.nativePreviewOcrBbox}
        />
      ) : null}
    </div>
  );
}

function PdfCitationLocator({
  copy,
  sourceContext
}: {
  copy: Record<string, string>;
  sourceContext: SourceContext | null;
}) {
  if (!sourceContext?.location.page_number && !sourceContext?.location.bbox) {
    return null;
  }

  const bbox = sourceContext.location.bbox ? bboxToPercentStyle(sourceContext.location.bbox) : null;
  return (
    <div className="native-preview__pdf-locator">
      <div>
        <strong>{copy.nativePreviewPdfLocatorTitle}</strong>
        <p>{copy.nativePreviewPdfLocatorDetail}</p>
      </div>
      <div className="native-preview__page-map" aria-label={copy.nativePreviewPdfLocatorTitle}>
        <span>{sourceContext.location.page_number ? `${copy.page} ${sourceContext.location.page_number}` : copy.page}</span>
        {bbox ? <span className="native-preview__bbox native-preview__bbox--pdf" style={bbox} /> : null}
      </div>
    </div>
  );
}

function TextualNativePreview({
  copy,
  preview,
  previewKind,
  sourceContext
}: {
  copy: Record<string, string>;
  preview: { status: "idle" | "loading" | "ready" | "error"; text: string; truncated: boolean };
  previewKind: NativePreviewKind;
  sourceContext: SourceContext | null;
}) {
  if (preview.status === "loading") {
    return (
      <div className="empty-state empty-state--inline">
        <FileSearch size={22} aria-hidden="true" />
        {copy.nativePreviewLoading}
      </div>
    );
  }

  if (preview.status === "error") {
    return (
      <div className="notice notice--danger">
        <ShieldAlert size={16} aria-hidden="true" />
        {copy.nativePreviewError}
      </div>
    );
  }

  if (preview.status !== "ready") {
    return null;
  }

  if (previewKind === "csv") {
    return (
      <>
        <CsvPreview text={preview.text} activeRow={sourceContext?.location.row_number ?? null} />
        {preview.truncated ? <p className="notice">{copy.nativePreviewTruncated}</p> : null}
      </>
    );
  }

  if (previewKind === "markdown") {
    return (
      <>
        <MarkdownNativePreview copy={copy} text={preview.text} chunkText={sourceContext?.chunk_text ?? ""} />
        {preview.truncated ? <p className="notice">{copy.nativePreviewTruncated}</p> : null}
      </>
    );
  }

  return (
    <>
      <pre className="native-preview__text">
        <HighlightedPreviewText text={preview.text} chunkText={sourceContext?.chunk_text ?? ""} copy={copy} />
      </pre>
      {preview.truncated ? <p className="notice">{copy.nativePreviewTruncated}</p> : null}
    </>
  );
}

function MarkdownNativePreview({
  chunkText,
  copy,
  text
}: {
  chunkText: string;
  copy: Record<string, string>;
  text: string;
}) {
  const headings = useMemo(() => markdownHeadings(text), [text]);
  const highlightPlugin = useMemo(() => rehypeCitationHighlight(chunkText), [chunkText]);

  return (
    <div className="native-preview__markdown-shell">
      <aside className="native-preview__markdown-toc" aria-label={copy.nativePreviewMarkdownToc}>
        <strong>{copy.nativePreviewMarkdownToc}</strong>
        {headings.length > 0 ? (
          <nav>
            {headings.map((heading) => (
              <a className={`native-preview__markdown-toc-link native-preview__markdown-toc-link--h${heading.level}`} href={`#${heading.id}`} key={heading.id}>
                {heading.text}
              </a>
            ))}
          </nav>
        ) : (
          <p>{copy.nativePreviewMarkdownNoHeadings}</p>
        )}
      </aside>
      <article className="native-preview__markdown">
        <ReactMarkdown components={markdownComponents} rehypePlugins={[highlightPlugin]} remarkPlugins={[remarkGfm]}>
          {text}
        </ReactMarkdown>
      </article>
    </div>
  );
}

function StructuredNativePreview({
  copy,
  preview,
  sourceContext
}: {
  copy: Record<string, string>;
  preview: { status: "idle" | "loading" | "ready" | "error"; preview: NativeStructuredPreview | null };
  sourceContext: SourceContext | null;
}) {
  if (preview.status === "loading") {
    return (
      <div className="empty-state empty-state--inline">
        <FileSearch size={22} aria-hidden="true" />
        {copy.nativePreviewLoading}
      </div>
    );
  }
  if (preview.status === "error") {
    return (
      <div className="notice notice--danger">
        <ShieldAlert size={16} aria-hidden="true" />
        {copy.nativePreviewError}
      </div>
    );
  }
  if (preview.status !== "ready" || !preview.preview) {
    return null;
  }

  if (preview.preview.kind === "docx") {
    return <DocxNativePreview copy={copy} preview={preview.preview} sourceContext={sourceContext} />;
  }
  if (preview.preview.kind === "xlsx") {
    return <XlsxNativePreview copy={copy} preview={preview.preview} sourceContext={sourceContext} />;
  }
  if (preview.preview.kind === "presentation") {
    return <PresentationNativePreview copy={copy} preview={preview.preview} sourceContext={sourceContext} />;
  }
  return (
    <div className="empty-state empty-state--inline">
      <FileText size={22} aria-hidden="true" />
      {copy.nativePreviewUnsupported}
    </div>
  );
}

function DocxNativePreview({
  copy,
  preview,
  sourceContext
}: {
  copy: Record<string, string>;
  preview: Extract<NativeStructuredPreview, { kind: "docx" }>;
  sourceContext: SourceContext | null;
}) {
  const activeParagraph = sourceContext?.location.paragraph_number ? Number(sourceContext.location.paragraph_number) : null;
  if (preview.paragraphs.length === 0) {
    return <div className="empty-state empty-state--inline">{copy.nativePreviewStructuredEmpty}</div>;
  }
  return (
    <div className="native-preview__doc">
      {preview.paragraphs.map((paragraph) => (
        <p
          className={activeParagraph === paragraph.index ? "native-preview__paragraph native-preview__paragraph--active" : "native-preview__paragraph"}
          key={paragraph.index}
        >
          {paragraph.style ? <strong>{paragraph.style}: </strong> : null}
          {paragraph.text}
        </p>
      ))}
      {preview.truncated ? <p className="notice">{copy.nativePreviewTruncated}</p> : null}
      <GovernanceList title={copy.governanceWarnings} items={preview.warnings} />
    </div>
  );
}

function XlsxNativePreview({
  copy,
  preview,
  sourceContext
}: {
  copy: Record<string, string>;
  preview: Extract<NativeStructuredPreview, { kind: "xlsx" }>;
  sourceContext: SourceContext | null;
}) {
  if (preview.sheets.length === 0) {
    return <div className="empty-state empty-state--inline">{copy.nativePreviewStructuredEmpty}</div>;
  }
  return (
    <div className="stack">
      {preview.sheets.map((sheet) => (
        <div className="native-preview__sheet" key={sheet.name}>
          <strong>{copy.nativePreviewSheet}: {sheet.name}</strong>
          <CsvPreview text={sheet.rows.map((row) => row.join(",")).join("\n")} activeRow={sourceContext?.location.row_number ?? null} />
          {sheet.truncated ? <p className="notice">{copy.nativePreviewTruncated}</p> : null}
        </div>
      ))}
      <GovernanceList title={copy.governanceWarnings} items={preview.warnings} />
    </div>
  );
}

function PresentationNativePreview({
  copy,
  preview,
  sourceContext
}: {
  copy: Record<string, string>;
  preview: Extract<NativeStructuredPreview, { kind: "presentation" }>;
  sourceContext: SourceContext | null;
}) {
  const activeSlide = sourceContext?.location.slide_number ?? null;
  if (preview.slides.length === 0) {
    return <div className="empty-state empty-state--inline">{copy.nativePreviewStructuredEmpty}</div>;
  }
  return (
    <div className="native-preview__slides">
      {preview.slides.map((slide) => (
        <section
          className={activeSlide === slide.slide_number ? "native-preview__slide native-preview__slide--active" : "native-preview__slide"}
          key={slide.slide_number}
        >
          <strong>{copy.nativePreviewSlide} {slide.slide_number}</strong>
          {slide.title ? <h4>{slide.title}</h4> : null}
          {slide.text.slice(slide.title ? 1 : 0).map((text) => (
            <p key={text}>{text}</p>
          ))}
        </section>
      ))}
      {preview.truncated ? <p className="notice">{copy.nativePreviewTruncated}</p> : null}
      <GovernanceList title={copy.governanceWarnings} items={preview.warnings} />
    </div>
  );
}

function HighlightedPreviewText({
  chunkText,
  copy,
  text
}: {
  chunkText: string;
  copy: Record<string, string>;
  text: string;
}) {
  const normalizedChunk = chunkText.trim();
  if (!normalizedChunk) {
    return <>{text}</>;
  }

  const matchIndex = text.indexOf(normalizedChunk);
  if (matchIndex === -1) {
    return <>{text}</>;
  }

  const before = text.slice(0, matchIndex);
  const highlighted = text.slice(matchIndex, matchIndex + normalizedChunk.length);
  const after = text.slice(matchIndex + normalizedChunk.length);
  return (
    <>
      {before}
      <mark title={copy.nativePreviewExactHighlight}>{highlighted}</mark>
      {after}
    </>
  );
}

function CsvPreview({ activeRow, text }: { activeRow: number | null; text: string }) {
  const rows = parseCsvRows(text).slice(0, 25);
  const [header, ...bodyRows] = rows;
  if (!header || header.length === 0) {
    return <pre className="native-preview__text">{text}</pre>;
  }

  return (
    <div className="native-preview__table-scroll">
      <table className="native-preview__table">
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={`${cell}-${index}`}>{cell || `Column ${index + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rowIndex) => {
            const sourceRowNumber = rowIndex + 2;
            return (
              <tr className={activeRow === sourceRowNumber ? "native-preview__row--active" : ""} key={`${sourceRowNumber}-${row.join("|")}`}>
                {header.map((_, cellIndex) => (
                  <td key={`${sourceRowNumber}-${cellIndex}`}>{row[cellIndex] ?? ""}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DocumentSourceContextViewer({
  copy,
  sourceContext
}: {
  copy: Record<string, string>;
  sourceContext: SourceContext;
}) {
  const sourceLabel = sourceContext.source_file_name ?? sourceContext.source_file_uri ?? copy.sourceUnavailable;
  const locationParts = sourceContextLocationParts(sourceContext, copy);

  return (
    <div className="source-viewer source-viewer--document">
      <div className="source-viewer__header">
        <div>
          <h3>{sourceContext.document_title}</h3>
          <span>{sourceLabel}</span>
        </div>
        <StatusBadge value="online" label={sourceContext.viewer_mode} />
      </div>
      <div className="source-viewer__meta">
        <span>{copy.chunk} {sourceContext.chunk_id}</span>
        <span>{copy.version}: {sourceContext.document_version_id}</span>
        {locationParts.map((part) => (
          <span key={part}>{part}</span>
        ))}
      </div>
      <div className="source-uri">
        <FileText size={16} aria-hidden="true" />
        <span>{sourceContext.source_file_uri ?? copy.sourceUnavailable}</span>
      </div>
      {sourceContext.before_text ? (
        <div className="source-context-block">
          <strong>{copy.beforeContext}</strong>
          <DocumentSourceContextText sourceContext={sourceContext} text={sourceContext.before_text} contextual />
        </div>
      ) : null}
      <DocumentSourceContextText sourceContext={sourceContext} text={sourceContext.chunk_text} />
      {sourceContext.after_text ? (
        <div className="source-context-block">
          <strong>{copy.afterContext}</strong>
          <DocumentSourceContextText sourceContext={sourceContext} text={sourceContext.after_text} contextual />
        </div>
      ) : null}
      <div className="source-viewer__actions">
        <button
          className="button"
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(sourceContext.chunk_text);
          }}
        >
          <Copy size={16} aria-hidden="true" />
          {copy.copyChunk}
        </button>
      </div>
      {sourceContext.warnings.length > 0 ? (
        <div className="notice notice--danger">
          <ShieldAlert size={16} aria-hidden="true" />
          {sourceContext.warnings.join(", ")}
        </div>
      ) : null}
    </div>
  );
}

function DocumentSourceContextText({
  contextual = false,
  sourceContext,
  text
}: {
  contextual?: boolean;
  sourceContext: SourceContext;
  text: string;
}) {
  if (sourceContext.viewer_mode === "markdown") {
    return (
      <article className={`native-preview__markdown native-preview__markdown--citation ${contextual ? "native-preview__markdown--context" : ""}`.trim()}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </article>
    );
  }

  return <pre className={`chunk-text ${contextual ? "chunk-text--context" : ""}`.trim()}>{text}</pre>;
}

function sourceContextLocationParts(sourceContext: SourceContext, copy: Record<string, string>): string[] {
  const location = sourceContext.location;
  const parts: string[] = [];
  if (location.page_number !== null) {
    parts.push(`${copy.page} ${location.page_number}`);
  }
  if (location.section_path.length > 0) {
    parts.push(`${copy.section}: ${location.section_path.join(" / ")}`);
  } else {
    parts.push(copy.noSection);
  }
  if (location.paragraph_number !== null) {
    parts.push(`${copy.paragraph} ${location.paragraph_number}`);
  }
  if (location.sheet_name !== null) {
    parts.push(location.sheet_name);
  }
  if (location.row_number !== null) {
    parts.push(`${copy.row} ${location.row_number}`);
  }
  return parts;
}

function sourceUrlWithPageFragment(sourceUrl: string, pageNumber: number): string {
  const page = Math.max(1, Math.trunc(pageNumber));
  const [baseUrl] = sourceUrl.split("#");
  return `${baseUrl}#page=${page}`;
}

function sourcePreviewUrlForSourceUrl(sourceUrl: string): string {
  const [baseUrl, fragment] = sourceUrl.split("#");
  const previewUrl = baseUrl.replace("/api/documents/source/content", "/api/documents/source/preview");
  return fragment ? `${previewUrl}#${fragment}` : previewUrl;
}

function bboxToPercentStyle(bbox: Record<string, number>): CSSProperties {
  const left = normalizeBboxPercent(bbox.x ?? bbox.left ?? 0);
  const top = normalizeBboxPercent(bbox.y ?? bbox.top ?? 0);
  const width = normalizeBboxPercent(bbox.width ?? bbox.w ?? 0);
  const height = normalizeBboxPercent(bbox.height ?? bbox.h ?? 0);
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${Math.max(width, 1)}%`,
    height: `${Math.max(height, 1)}%`
  };
}

function normalizeBboxPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const percent = value > 0 && value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, percent));
}

function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const markdownComponents: Components = {
  a: ({ children, href, node: _node, ...props }) => {
    const safeHref = safeMarkdownHref(href);
    if (!safeHref) {
      return <span>{children}</span>;
    }
    const isExternal = /^https?:\/\//i.test(safeHref);
    return (
      <a {...props} href={safeHref} rel={isExternal ? "noopener noreferrer" : undefined} target={isExternal ? "_blank" : undefined}>
        {children}
      </a>
    );
  },
  h1: ({ children, node: _node, ...props }) => (
    <h1 {...props} id={slugifyMarkdownHeading(textFromReactChildren(children))}>
      {children}
    </h1>
  ),
  h2: ({ children, node: _node, ...props }) => (
    <h2 {...props} id={slugifyMarkdownHeading(textFromReactChildren(children))}>
      {children}
    </h2>
  ),
  h3: ({ children, node: _node, ...props }) => (
    <h3 {...props} id={slugifyMarkdownHeading(textFromReactChildren(children))}>
      {children}
    </h3>
  ),
  h4: ({ children, node: _node, ...props }) => (
    <h4 {...props} id={slugifyMarkdownHeading(textFromReactChildren(children))}>
      {children}
    </h4>
  ),
  h5: ({ children, node: _node, ...props }) => (
    <h5 {...props} id={slugifyMarkdownHeading(textFromReactChildren(children))}>
      {children}
    </h5>
  ),
  h6: ({ children, node: _node, ...props }) => (
    <h6 {...props} id={slugifyMarkdownHeading(textFromReactChildren(children))}>
      {children}
    </h6>
  )
};

function markdownHeadings(text: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const slugCounts = new Map<string, number>();
  let inFence = false;

  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const level = match[1].length;
    const headingText = match[2].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`~]/g, "").trim();
    const baseSlug = slugifyMarkdownHeading(headingText);
    const count = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, count + 1);
    headings.push({
      id: count === 0 ? baseSlug : `${baseSlug}-${count + 1}`,
      level,
      text: headingText
    });
  }

  return headings.slice(0, 24);
}

function slugifyMarkdownHeading(value: string): string {
  const slug = normalizeSearchText(value).replace(/\s+/g, "-");
  return slug || "section";
}

function safeMarkdownHref(href: string | undefined): string | null {
  if (!href) {
    return null;
  }
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed) || trimmed.startsWith("#") || trimmed.startsWith("/")) {
    return trimmed;
  }
  return null;
}

function textFromReactChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(textFromReactChildren).join("");
  }
  return "";
}

function rehypeCitationHighlight(chunkText: string) {
  const normalizedChunk = chunkText.trim();
  return function citationHighlightPlugin() {
    return function transform(tree: RehypeNode): void {
      if (!normalizedChunk) {
        return;
      }
      visitRehypeNode(tree, normalizedChunk);
    };
  };
}

function visitRehypeNode(node: RehypeNode, chunkText: string): void {
  if (!node || !("children" in node) || !node.children) {
    return;
  }

  node.children = node.children.flatMap((child) => {
    if (isRehypeTextNode(child)) {
      return highlightMarkdownTextNode(child, chunkText);
    }
    visitRehypeNode(child, chunkText);
    return [child];
  });
}

function isRehypeTextNode(node: RehypeNode): node is RehypeTextNode {
  return node.type === "text" && "value" in node && typeof node.value === "string";
}

function highlightMarkdownTextNode(node: RehypeTextNode, chunkText: string): RehypeNode[] {
  const exactIndex = node.value.toLowerCase().indexOf(chunkText.toLowerCase());
  if (exactIndex !== -1) {
    const before = node.value.slice(0, exactIndex);
    const highlighted = node.value.slice(exactIndex, exactIndex + chunkText.length);
    const after = node.value.slice(exactIndex + chunkText.length);
    return [
      ...(before ? [{ type: "text" as const, value: before }] : []),
      markdownMarkNode(highlighted),
      ...(after ? [{ type: "text" as const, value: after }] : [])
    ];
  }

  if (markdownTextMatchesChunk(node.value, chunkText)) {
    return [markdownMarkNode(node.value)];
  }

  return [node];
}

function markdownMarkNode(value: string): RehypeElementNode {
  return {
    type: "element",
    tagName: "mark",
    properties: { className: ["native-preview__markdown-citation"] },
    children: [{ type: "text", value }]
  };
}

function markdownTextMatchesChunk(text: string, chunkText: string): boolean {
  const normalizedText = normalizeSearchText(text);
  const normalizedChunk = normalizeSearchText(chunkText);
  if (!normalizedText || !normalizedChunk) {
    return false;
  }
  if (normalizedText.includes(normalizedChunk) || normalizedChunk.includes(normalizedText)) {
    return true;
  }

  const chunkTokens = new Set(normalizedChunk.split(" ").filter((token) => token.length >= 4));
  const textTokens = normalizedText.split(" ").filter((token) => token.length >= 4);
  if (chunkTokens.size === 0 || textTokens.length === 0) {
    return false;
  }
  const matches = textTokens.filter((token) => chunkTokens.has(token)).length;
  return matches >= Math.min(4, Math.ceil(Math.min(chunkTokens.size, textTokens.length) * 0.6));
}

function nativePreviewKind(sourceOpen: DocumentSourceOpenDecision): NativePreviewKind {
  const mimeType = sourceOpen.file.mime_type.toLowerCase();
  const filename = sourceOpen.file.filename.toLowerCase();
  if (sourceOpen.viewer_mode === "pdf" || mimeType === "application/pdf" || filename.endsWith(".pdf")) {
    return "pdf";
  }
  if (sourceOpen.viewer_mode === "image" || sourceOpen.viewer_mode === "ocr" || mimeType.startsWith("image/")) {
    return "image";
  }
  if (filename.endsWith(".docx") || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return "docx";
  }
  if (filename.endsWith(".xlsx") || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return "xlsx";
  }
  if (filename.endsWith(".pptx") || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return "presentation";
  }
  if (mimeType === "text/csv" || filename.endsWith(".csv")) {
    return "csv";
  }
  if (sourceOpen.viewer_mode === "markdown" || mimeType === "text/markdown" || filename.endsWith(".md") || filename.endsWith(".markdown")) {
    return "markdown";
  }
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    filename.endsWith(".txt")
  ) {
    return "text";
  }
  return "unsupported";
}

function sourcePreviewNeedsFetch(kind: NativePreviewKind): boolean {
  return kind === "text" || kind === "markdown" || kind === "csv";
}

function sourcePreviewNeedsStructuredFetch(kind: NativePreviewKind): boolean {
  return kind === "docx" || kind === "xlsx" || kind === "presentation";
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (character === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.trim())) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }

  row.push(cell);
  if (row.some((value) => value.trim())) {
    rows.push(row);
  }
  return rows;
}

function governanceMetrics(result: GovernanceServiceResponse): string[] {
  if ("change_counts" in result) {
    return Object.entries(result.change_counts).map(([key, value]) => `${key}: ${value}`);
  }
  if ("findings" in result) {
    return [`status: ${result.status}`, `findings: ${result.findings.length}`];
  }
  if ("conflicts" in result) {
    return [`conflicts: ${result.conflicts.length}`];
  }
  return [];
}

function governanceResultItems(result: GovernanceServiceResponse): string[] {
  if ("changes" in result) {
    return result.changes.map((change) => `${change.impact} ${change.change_type}: ${change.rationale}`);
  }
  if ("findings" in result) {
    return result.findings.map((finding) => `${finding.severity} ${finding.rule_id}: ${finding.message}`);
  }
  if ("conflicts" in result) {
    return result.conflicts.map((conflict) => `${conflict.severity} ${conflict.conflict_type}: ${conflict.summary}`);
  }
  return [];
}

function governanceCitations(result: GovernanceServiceResponse): GovernanceCitation[] {
  return result.citations.slice(0, 6);
}

function citationLabel(citation: GovernanceCitation): string {
  return `${citation.document_title} ${citation.version_label} / ${citation.chunk_id}`;
}

function workflowTaskStatusTone(status: RegistryWorkflowTask["status"]) {
  if (status === "resolved") {
    return "completed";
  }
  if (status === "blocked") {
    return "error";
  }
  if (status === "waiting") {
    return "queued";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "info";
}

function workflowTaskStatusLabel(status: RegistryWorkflowTask["status"], language: AklLanguage): string {
  const labels = {
    cs: {
      open: "otevřeno",
      waiting: "čeká",
      blocked: "blokuje",
      resolved: "vyřešeno",
      cancelled: "zrušeno"
    },
    en: {
      open: "open",
      waiting: "waiting",
      blocked: "blocked",
      resolved: "resolved",
      cancelled: "cancelled"
    }
  } satisfies Record<AklLanguage, Record<RegistryWorkflowTask["status"], string>>;
  return labels[language][status];
}

function workflowLastAction(value: unknown): string | null {
  return typeof value === "string" ? value.replaceAll("_", " ") : null;
}

async function readDocumentWorkflowError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return payload?.error?.message ?? `HTTP ${response.status}`;
}

function viewerModeFor(uri: string): string {
  const value = uri.toLowerCase();
  if (value.endsWith(".pdf")) {
    return "pdf";
  }
  if (value.match(/\.(png|jpe?g|gif|webp|svg)$/)) {
    return "image";
  }
  if (value.endsWith(".md") || value.endsWith(".markdown")) {
    return "markdown";
  }
  if (value.endsWith(".docx") || value.endsWith(".doc") || value.endsWith(".odt")) {
    return "text";
  }
  if (value.endsWith(".pptx")) {
    return "presentation";
  }
  if (value.endsWith(".xlsx") || value.endsWith(".csv")) {
    return "table";
  }
  return "binary";
}

function priorityActionsFor(
  document: Document,
  currentVersion: DocumentVersion | undefined,
  relatedJobs: IngestionJob[],
  copy: Record<string, string>
): string[] {
  const actions: string[] = [];
  const currentJob = currentVersion
    ? relatedJobs.find((job) => job.document_version_id === currentVersion.document_version_id)
    : relatedJobs[0];
  if (!currentJob || ["queued", "running", "failed", "completed_with_warnings"].includes(currentJob.status)) {
    actions.push(copy.actionIngestion);
  }
  if (document.status === "review" || document.status === "draft") {
    actions.push(copy.actionReview);
  }
  if (currentVersion?.source_file_uri.toLowerCase().match(/\.(pdf|docx|doc|odt)$/)) {
    actions.push(copy.actionViewer);
  }
  if (document.classification === "restricted" || document.classification === "confidential") {
    actions.push(copy.actionAccess);
  }
  return actions;
}
