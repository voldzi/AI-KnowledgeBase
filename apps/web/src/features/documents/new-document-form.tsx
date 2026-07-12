"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, FileClock, FilePlus2, Fingerprint, ListChecks, Play, RotateCcw } from "lucide-react";
import {
  FieldLabelWithHelp,
  FileDropzone,
  HelpHint,
  validateWorkflowParticipants,
  WorkflowParticipants,
  type WorkflowParticipantAssignment,
  type WorkflowParticipantValidationError,
} from "@voldzi/stratos-ui";

import { StatusBadge } from "@/components/status-badge";
import { StratosButton, StratosButtonLink, StratosSelect } from "@/components/stratos";
import { withAppBasePath } from "@/lib/app-url";
import { formatNumber } from "@/lib/format";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import {
  catalogEntry,
  directoryUsersToWorkflowSubjects,
  DOCUMENT_TYPE_CATALOG,
  documentWorkflowRoles,
  initialWorkflowAssignments,
  validateDocumentWorkflowAssignments,
  workflowAssignmentsToDocumentAssignments,
} from "@/lib/documents/document-workflow";
import type {
  AuthorizationHint,
  Classification,
  DirectoryUser,
  Document,
  DocumentType,
  DocumentVersion,
  IngestionJob,
  UploadContentResponse,
  UploadPreflightDecision
} from "@/lib/types";
import { MAX_UPLOAD_SIZE_BYTES, readErrorMessage, sha256File, SUPPORTED_UPLOAD_ACCEPT } from "./upload-client-utils";

interface NewDocumentFormProps {
  authorization: AuthorizationHint;
  currentSubjectId: string;
  directoryUsers: DirectoryUser[];
}

interface FilePreflight {
  name: string;
  size: number;
  type: string;
  hash: string | null;
  hashing: boolean;
  error: string | null;
}

type FirstVersionPhase = "idle" | "ready" | "creating" | "preflight" | "uploading" | "queued";
type ParserProfile = "controlled_document" | "plain_text" | "ocr_heavy";
type ChunkingStrategy = "legal_structured" | "semantic" | "fixed_window";

interface DocumentTemplate {
  key: string;
  labelKey: "templateDirective" | "templateMethodology" | "templatePolicy" | "templateContract" | "templateProject";
  documentType: DocumentType;
}

const documentTypeOptions = DOCUMENT_TYPE_CATALOG.filter((item) => item.active);

const documentTemplates: DocumentTemplate[] = [
  {
    key: "directive",
    labelKey: "templateDirective",
    documentType: "directive"
  },
  {
    key: "methodology",
    labelKey: "templateMethodology",
    documentType: "methodology"
  },
  {
    key: "policy",
    labelKey: "templatePolicy",
    documentType: "policy"
  },
  {
    key: "contract",
    labelKey: "templateContract",
    documentType: "contract"
  },
  {
    key: "project",
    labelKey: "templateProject",
    documentType: "project_documentation"
  }
];

const newDocumentCopy = {
  cs: {
    title: "Založit dokument a první verzi",
    documentTemplate: "Rychlá volba",
    templateHint: "Vyberte typický scénář. AKB předvyplní typ, klasifikaci, štítky a způsob čtení; odpovědnosti vybíráte z adresáře.",
    templateHelpLabel: "Nápověda k rychlé volbě",
    templateHelp: "Použijte ji, pokud zakládáte běžnou směrnici, metodiku, politiku, smlouvu nebo projektový dokument. Volbu můžete před odesláním upravit.",
    templateDirective: "Směrnice",
    templateMethodology: "Metodika",
    templatePolicy: "Politika",
    templateContract: "Smlouva",
    templateProject: "Projekt",
    titleLabel: "Název",
    titlePlaceholder: "Název dokumentu",
    titleHelpLabel: "Nápověda k názvu dokumentu",
    titleHelp: "Použijte oficiální název tak, jak má být dohledatelný v registru a citacích.",
    type: "Typ dokumentu",
    typeHelpLabel: "Nápověda k typu dokumentu",
    typeHelp: "Typ pomáhá filtrování, reportům a AI odpovědím. Směrnice je závazné interní pravidlo, metodika je doporučený postup.",
    classification: "Klasifikace",
    classificationHelpLabel: "Nápověda ke klasifikaci",
    classificationHelp: "Vyberte nejnižší klasifikaci, která odpovídá obsahu. Omezené a důvěrné dokumenty uvidí jen oprávnění uživatelé.",
    gestorUnit: "Gestorská jednotka",
    gestorHelpLabel: "Nápověda ke gestorské jednotce",
    gestorHelp: "Uveďte útvar, který odpovídá za věcnou správnost a další verze dokumentu.",
    tags: "Štítky",
    tagsHelpLabel: "Nápověda ke štítkům",
    tagsHelp: "Štítky pomáhají najít dokument podle agendy. Oddělujte je čárkou, například smernice,it,bezpecnost.",
    file: "Originální soubor",
    fileHelpLabel: "Nápověda k originálnímu souboru",
    fileHelp: "Nahrajte skutečný zdroj, ideálně PDF nebo kancelářský dokument. AKB uloží originál a z něj připraví citace.",
    chooseFile: "Vyberte originální soubor pro první verzi",
    fileReady: "Soubor připraven",
    hashing: "Počítám SHA-256",
    hashFailed: "Hash souboru se nepodařilo vypočítat.",
    size: "velikost",
    mime: "MIME",
    versionLabel: "První verze",
    versionHelpLabel: "Nápověda k první verzi",
    versionHint: "První verze nového dokumentu je vždy 1.0. Další verze už AKB navyšuje podle zvolené změny.",
    validFrom: "Platná od",
    validFromHelpLabel: "Nápověda k platnosti",
    validFromHelp: "Zadejte den, od kterého má být dokument používán jako platný zdroj.",
    parserProfile: "Způsob čtení dokumentu",
    parserHelpLabel: "Nápověda ke způsobu čtení",
    parserHelp: "Pro směrnice a metodiky ponechte řízený dokument. OCR zvolte hlavně u skenovaných souborů.",
    chunkingStrategy: "Dělení pro citace",
    chunkingHelpLabel: "Nápověda k dělení pro citace",
    chunkingHelp: "Podle kapitol a odstavců je nejvhodnější pro předpisy, směrnice a metodiky. Významové části jsou lepší pro volnější text.",
    parserControlled: "Řízený dokument",
    parserPlain: "Jednoduchý text",
    parserOcr: "Sken nebo OCR náročný dokument",
    chunkLegal: "Podle kapitol a odstavců",
    chunkSemantic: "Podle významových částí",
    chunkFixed: "Po stejně velkých úsecích",
    saving: "Zpracovávám",
    creatingDocument: "Zakládám dokument",
    uploadingFile: "Nahrávám soubor",
    save: "Založit dokument a spustit zpracování",
    registryError: "Založení dokumentu se nepodařilo",
    preflightError: "Kontrola souboru se nepodařila",
    uploadError: "Uložení souboru se nepodařilo",
    workflowError: "Založení první verze se nepodařilo",
    checkingFile: "Kontroluji soubor",
    requestFailed: "Proces se nepodařilo dokončit.",
    missingFile: "Vyberte soubor a počkejte na dokončení kontroly.",
    disabled: "Založení dokumentu s první verzí není pro tuto relaci povolené.",
    draftRetained: "Koncept dokumentu už je založený. Opakované odeslání zkusí znovu nahrát první verzi do stejného dokumentu.",
    created: "Dokument založen",
    queued: "První verze založena a zpracování spuštěno",
    queuedDetail: "Verze 1.0 je připravená ke zpracování a AKB ji promítne do citací.",
    doneTitle: "Dokument je založený",
    doneDetail: "Originální soubor je uložený v AKB a zpracování citací běží na pozadí.",
    processingQueued: "Zpracování běží",
    fingerprintReady: "Kontrola souboru hotová",
    openDocument: "Otevřít dokument",
    openProcessing: "Sledovat zpracování",
    uploadNextVersion: "Nahrát další verzi",
    createAnother: "Založit další dokument",
    validationPreview: "Průběh založení",
    stepMetadata: "Metadata dokumentu",
    stepMetadataDetail: "Název, typ, klasifikace, gestor a schvalovatel vzniknou jako auditovaný koncept dokumentu.",
    stepFile: "Originální soubor",
    stepFileDetail: "AKB spočítá otisk souboru a při odeslání ověří typ a velikost.",
    stepWorkflow: "První verze a zpracování",
    stepWorkflowDetail: "Po uložení souboru AKB založí verzi 1.0 a spustí ingestion pro citace.",
    done: "Hotovo",
    current: "Probíhá",
    waiting: "Čeká",
    boundaryCheck: "Bezpečný proces",
    boundaryDetail: "Aplikace ukládá binární soubor pouze přes AKB upload session. Metadata, verze, zpracování a audit vznikají v AKB.",
    authorization: "Oprávnění",
    authorizationDetail: "Tento průchod vyžaduje oprávnění založit dokument a nahrát verzi.",
    public: "veřejné",
    internal: "interní",
    restricted: "omezené",
    confidential: "důvěrné",
    summaryPrefix: "První verze",
    sourceAdded: "Doplněn originální zdroj a spuštěno zpracování pro citace."
  },
  en: {
    title: "Create document and first version",
    documentTemplate: "Quick choice",
    templateHint: "Choose a common scenario. AKB pre-fills type, classification, tags and reading mode; responsibilities come from the directory.",
    templateHelpLabel: "Quick choice help",
    templateHelp: "Use it when creating a common directive, methodology, policy, contract or project document. You can adjust the values before submitting.",
    templateDirective: "Directive",
    templateMethodology: "Methodology",
    templatePolicy: "Policy",
    templateContract: "Contract",
    templateProject: "Project",
    titleLabel: "Title",
    titlePlaceholder: "Document title",
    titleHelpLabel: "Document title help",
    titleHelp: "Use the official title as it should appear in registry search and citations.",
    type: "Document type",
    typeHelpLabel: "Document type help",
    typeHelp: "The type supports filtering, reports and AI answers. Directive means binding internal rule, methodology means recommended procedure.",
    classification: "Classification",
    classificationHelpLabel: "Classification help",
    classificationHelp: "Choose the lowest classification that fits the content. Restricted and confidential documents are visible only to authorized users.",
    gestorUnit: "Gestor unit",
    gestorHelpLabel: "Gestor unit help",
    gestorHelp: "Enter the unit responsible for factual correctness and future document versions.",
    tags: "Tags",
    tagsHelpLabel: "Tags help",
    tagsHelp: "Tags help users find the document by agenda. Separate them with commas, for example directive,it,security.",
    file: "Original file",
    fileHelpLabel: "Original file help",
    fileHelp: "Upload the real source, preferably PDF or an office document. AKB stores the original and prepares citations from it.",
    chooseFile: "Choose the original file for the first version",
    fileReady: "File ready",
    hashing: "Computing SHA-256",
    hashFailed: "File hash could not be computed.",
    size: "size",
    mime: "MIME",
    versionLabel: "First version",
    versionHelpLabel: "First version help",
    versionHint: "The first version of a new document is always 1.0. Later versions are incremented from the selected change type.",
    validFrom: "Valid from",
    validFromHelpLabel: "Validity help",
    validFromHelp: "Enter the day from which the document should be used as a valid source.",
    parserProfile: "How AKB reads the file",
    parserHelpLabel: "Reading mode help",
    parserHelp: "Keep controlled document for directives and methodologies. Use OCR mainly for scanned files.",
    chunkingStrategy: "Citation segmentation",
    chunkingHelpLabel: "Citation segmentation help",
    chunkingHelp: "Chapters and paragraphs are best for regulations, directives and methodologies. Semantic sections fit freer text better.",
    parserControlled: "Controlled document",
    parserPlain: "Simple text",
    parserOcr: "Scanned or OCR-heavy document",
    chunkLegal: "By chapters and paragraphs",
    chunkSemantic: "By semantic sections",
    chunkFixed: "By fixed-size segments",
    saving: "Processing",
    creatingDocument: "Creating document",
    uploadingFile: "Uploading file",
    save: "Create document and start processing",
    registryError: "Document creation failed",
    preflightError: "File check failed",
    uploadError: "File storage failed",
    workflowError: "First version creation failed",
    checkingFile: "Checking file",
    requestFailed: "Process could not be completed.",
    missingFile: "Choose a file and wait for the check to finish.",
    disabled: "Creating a document with first version is not allowed for this session.",
    draftRetained: "The document draft has already been created. Submitting again retries the first-version upload for the same document.",
    created: "Document created",
    queued: "First version created and processing started",
    queuedDetail: "Version 1.0 is ready for processing and AKB will make it available for citations.",
    doneTitle: "Document is created",
    doneDetail: "The original file is stored in AKB and citation processing continues in the background.",
    processingQueued: "Processing running",
    fingerprintReady: "File check complete",
    openDocument: "Open document",
    openProcessing: "Track processing",
    uploadNextVersion: "Upload next version",
    createAnother: "Create another document",
    validationPreview: "Creation progress",
    stepMetadata: "Document metadata",
    stepMetadataDetail: "Title, type, classification, owner and approver create an audited document draft.",
    stepFile: "Original file",
    stepFileDetail: "AKB computes the file fingerprint and checks type and size on submit.",
    stepWorkflow: "First version and processing",
    stepWorkflowDetail: "After storing the file, AKB creates version 1.0 and starts citation ingestion.",
    done: "Done",
    current: "Current",
    waiting: "Waiting",
    boundaryCheck: "Secure process",
    boundaryDetail: "The binary file is stored only through an AKB upload session. Metadata, version, processing and audit are created in AKB.",
    authorization: "Authorization",
    authorizationDetail: "This flow requires permission to create documents and upload versions.",
    public: "public",
    internal: "internal",
    restricted: "restricted",
    confidential: "confidential",
    summaryPrefix: "First version",
    sourceAdded: "Original source added and citation processing started."
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function NewDocumentForm({ authorization, currentSubjectId, directoryUsers }: NewDocumentFormProps) {
  const { language } = useLanguage();
  const copy = newDocumentCopy[language];
  const workflowRoles = useMemo(() => documentWorkflowRoles(language), [language]);
  const workflowSubjects = useMemo(
    () => directoryUsersToWorkflowSubjects(directoryUsers, currentSubjectId, language),
    [currentSubjectId, directoryUsers, language],
  );
  const [createdDocument, setCreatedDocument] = useState<Document | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreflight, setFilePreflight] = useState<FilePreflight | null>(null);
  const [submitted, setSubmitted] = useState<{ document: Document; version: DocumentVersion; job: IngestionJob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<FirstVersionPhase>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [formResetKey, setFormResetKey] = useState(0);
  const [documentType, setDocumentType] = useState<DocumentType>("directive");
  const [classification, setClassification] = useState<Classification>("internal");
  const [tags, setTags] = useState("controlled-document,akb,smernice");
  const [parserProfile, setParserProfile] = useState<ParserProfile>("controlled_document");
  const [chunkingStrategy, setChunkingStrategy] = useState<ChunkingStrategy>("legal_structured");
  const [participantAssignments, setParticipantAssignments] = useState<WorkflowParticipantAssignment[]>(
    () => initialWorkflowAssignments(currentSubjectId),
  );
  const [participantErrors, setParticipantErrors] = useState<WorkflowParticipantValidationError[]>([]);
  const [dirty, setDirty] = useState(false);

  function resetFlow() {
    setCreatedDocument(null);
    setSelectedFile(null);
    setFilePreflight(null);
    setSubmitted(null);
    setError(null);
    setPhase("idle");
    setSubmitting(false);
    setDocumentType("directive");
    setClassification("internal");
    setTags("controlled-document,akb,smernice");
    setParserProfile("controlled_document");
    setChunkingStrategy("legal_structured");
    setParticipantAssignments(initialWorkflowAssignments(currentSubjectId));
    setParticipantErrors([]);
    setDirty(false);
    setFormResetKey((current) => current + 1);
  }

  function applyTemplate(template: DocumentTemplate) {
    if (metadataLocked || submitted) {
      return;
    }
    const selectedType = catalogEntry(template.documentType);
    setDocumentType(selectedType.code);
    setClassification(selectedType.defaultClassification);
    setTags(selectedType.defaultTags.join(","));
    setParserProfile(selectedType.parserProfile);
    setChunkingStrategy(selectedType.chunkingStrategy);
    setDirty(true);
  }

  const allowed = authorization.can_update && authorization.can_ingest;
  const metadataLocked = Boolean(createdDocument && !submitted);
  const hasRequiredParticipants = workflowRoles.every((role) =>
    participantAssignments.filter((assignment) => assignment.roleId === role.id).length >= (role.minAssignments ?? 0)
  ) && validateDocumentWorkflowAssignments(participantAssignments, language).length === 0;
  const canSubmit = Boolean(
    allowed && hasRequiredParticipants && selectedFile && filePreflight?.hash && !filePreflight.hashing && !submitting && !submitted
  );
  const statusLabel =
    phase === "queued"
      ? copy.queued
      : phase === "uploading"
        ? copy.uploadingFile
        : phase === "preflight"
          ? copy.checkingFile
          : phase === "creating"
            ? copy.creatingDocument
            : filePreflight?.hashing
              ? copy.hashing
              : filePreflight?.hash
                ? copy.fileReady
                : copy.waiting;
  const guidedSteps = [
    {
      label: copy.stepMetadata,
      detail: copy.stepMetadataDetail,
      done: Boolean(createdDocument || submitted),
      active: phase === "creating"
    },
    {
      label: copy.stepFile,
      detail: copy.stepFileDetail,
      done: Boolean(filePreflight?.hash && !filePreflight.hashing),
      active: filePreflight?.hashing || phase === "preflight" || phase === "uploading"
    },
    {
      label: copy.stepWorkflow,
      detail: copy.stepWorkflowDetail,
      done: Boolean(submitted),
      active: phase === "creating" || phase === "preflight" || phase === "uploading" || phase === "queued"
    }
  ];

  async function selectSourceFile(file: File | null) {
    setError(null);
    setSubmitted(null);
    setDirty(true);
    if (!file) {
      setSelectedFile(null);
      setFilePreflight(null);
      setPhase("idle");
      return;
    }
    setSelectedFile(file);
    setPhase("ready");
    setFilePreflight({
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      hash: null,
      hashing: true,
      error: null,
    });
    try {
      const hash = await sha256File(file);
      setFilePreflight({
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        hash,
        hashing: false,
        error: null,
      });
    } catch {
      setFilePreflight({
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        hash: null,
        hashing: false,
        error: copy.hashFailed,
      });
    }
  }

  return (
    <section className="grid grid--two">
      <form
        key={formResetKey}
        className="panel"
        onChange={() => setDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!selectedFile || !filePreflight?.hash) {
            setError(copy.missingFile);
            return;
          }
          const customParticipantValidation = validateDocumentWorkflowAssignments(participantAssignments, language);
          const workflowValidation = [
            ...validateWorkflowParticipants(workflowRoles, participantAssignments),
            ...customParticipantValidation,
          ];
          setParticipantErrors(customParticipantValidation);
          if (workflowValidation.length > 0) {
            setError(language === "cs" ? "Doplňte gestora a schvalovatele dokumentu." : "Assign the document owner and approver.");
            return;
          }

          setSubmitting(true);
          setError(null);
          const form = new FormData(event.currentTarget);

          try {
            let document = createdDocument;
            if (!document) {
              setPhase("creating");
              const documentResponse = await fetch(withAppBasePath("/api/controlled-document/documents"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...Object.fromEntries(form.entries()),
                  assignments: workflowAssignmentsToDocumentAssignments(participantAssignments, workflowSubjects),
                })
              });
              if (!documentResponse.ok) {
                setError(buildWorkflowError(copy.registryError, await readErrorMessage(documentResponse)));
                setPhase("ready");
                return;
              }
              const payload = (await documentResponse.json()) as { document: Document };
              document = payload.document;
              setCreatedDocument(document);
            }

            setPhase("preflight");
            const preflightResponse = await fetch(withAppBasePath("/api/controlled-document/upload/preflight"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                document_id: document.document_id,
                file_name: selectedFile.name,
                file_size: selectedFile.size,
                file_type: selectedFile.type || "application/octet-stream",
                sha256: filePreflight.hash
              })
            });
            if (!preflightResponse.ok) {
              setError(buildWorkflowError(copy.preflightError, await readErrorMessage(preflightResponse)));
              setPhase("ready");
              return;
            }
            const preflightBody = (await preflightResponse.json()) as { preflight: UploadPreflightDecision };

            setPhase("uploading");
            const uploadResponse = await fetch(preflightBody.preflight.upload_url, {
              method: preflightBody.preflight.upload_method,
              headers: preflightBody.preflight.required_headers,
              body: selectedFile
            });
            if (!uploadResponse.ok) {
              setError(buildWorkflowError(copy.uploadError, await readErrorMessage(uploadResponse)));
              setPhase("ready");
              return;
            }
            const uploaded = (await uploadResponse.json()) as UploadContentResponse;

            const workflowResponse = await fetch(withAppBasePath("/api/controlled-document/ingestion"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                document_id: document.document_id,
                version_label: "1.0",
                valid_from: String(form.get("valid_from") ?? new Date().toISOString().slice(0, 10)),
                change_summary: buildFirstVersionSummary({
                  copy,
                  title: document.title
                }),
                parser_profile: String(form.get("parser_profile") ?? "controlled_document"),
                chunking_strategy: String(form.get("chunking_strategy") ?? "legal_structured"),
                embedding_profile: "default",
                upload_session_id: preflightBody.preflight.upload_session_id,
                upload_token: preflightBody.preflight.required_headers["X-AKL-Upload-Token"],
                source_file_uri: uploaded.source_file_uri,
                file_hash: uploaded.file.sha256,
                file_name: uploaded.file.filename,
                file_size: uploaded.file.size_bytes,
                file_type: uploaded.file.mime_type
              })
            });
            if (!workflowResponse.ok) {
              setError(buildWorkflowError(copy.workflowError, await readErrorMessage(workflowResponse)));
              setPhase("ready");
              return;
            }
            const workflow = (await workflowResponse.json()) as { version: DocumentVersion; job: IngestionJob };
            setSubmitted({ document, version: workflow.version, job: workflow.job });
            setPhase("queued");
            setDirty(false);
          } catch (reason: unknown) {
            setError(reason instanceof Error ? reason.message : copy.requestFailed);
            setPhase("ready");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <div className="panel__header">
          <h2>{copy.title}</h2>
          <div className="inline-actions">
            <StratosButton
              type="button"
              onClick={() => {
                const confirmed = !dirty || window.confirm(
                  language === "cs"
                    ? "Opustit rozpracovaný dokument? Neuložené změny budou ztraceny."
                    : "Leave this document draft? Unsaved changes will be lost."
                );
                if (confirmed) window.location.assign(withAppBasePath("/documents"));
              }}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              {language === "cs" ? "Zpět" : "Back"}
            </StratosButton>
            <FilePlus2 size={18} aria-hidden="true" />
          </div>
        </div>
        <div className="panel__body form-grid">
          <div className="guided-change">
            <div>
              <div className="stratos-field-label-row">
                <strong>{copy.documentTemplate}</strong>
                <HelpHint label={copy.templateHelpLabel} text={copy.templateHelp} />
              </div>
              <p>{copy.templateHint}</p>
            </div>
            <div className="task-actions">
              {documentTemplates.map((template) => (
                <StratosButton
                  key={template.key}
                  type="button"
                  disabled={metadataLocked || Boolean(submitted)}
                  onClick={() => applyTemplate(template)}
                >
                  {copy[template.labelKey]}
                </StratosButton>
              ))}
            </div>
          </div>
          <div className="form-grid form-grid--two">
            <div className="field">
              <FieldLabelWithHelp htmlFor="title" label={copy.titleLabel} helpLabel={copy.titleHelpLabel} helpText={copy.titleHelp} />
              <input id="title" name="title" placeholder={copy.titlePlaceholder} required readOnly={metadataLocked || Boolean(submitted)} />
            </div>
            <StratosSelect
              id="type"
              name="document_type"
              label={copy.type}
              labelAccessory={<HelpHint label={copy.typeHelpLabel} text={copy.typeHelp} />}
              value={documentType}
              disabled={metadataLocked || Boolean(submitted)}
              onChange={(event) => setDocumentType(event.target.value as DocumentType)}
            >
              {documentTypeOptions.map((item) => (
                <option key={item.code} value={item.code}>{item.label[language]}</option>
              ))}
            </StratosSelect>
          </div>
          <StratosSelect
            id="classification"
            name="classification"
            label={copy.classification}
            labelAccessory={<HelpHint label={copy.classificationHelpLabel} text={copy.classificationHelp} />}
            value={classification}
            disabled={metadataLocked || Boolean(submitted)}
            onChange={(event) => setClassification(event.target.value as Classification)}
          >
            <option value="public">{copy.public}</option>
            <option value="internal">{copy.internal}</option>
            <option value="restricted">{copy.restricted}</option>
            <option value="confidential">{copy.confidential}</option>
          </StratosSelect>
          <div className="field">
            <FieldLabelWithHelp htmlFor="tags" label={copy.tags} helpLabel={copy.tagsHelpLabel} helpText={copy.tagsHelp} />
            <input
              id="tags"
              name="tags"
              value={tags}
              readOnly={metadataLocked || Boolean(submitted)}
              onChange={(event) => setTags(event.target.value)}
            />
          </div>
          <div className="workflow-participants-field">
            <div>
              <strong>{language === "cs" ? "Odpovědnosti dokumentu" : "Document responsibilities"}</strong>
              <p className="muted">
                {language === "cs"
                  ? "Vyberte jednoho gestora a jednoho schvalovatele z adresáře organizace."
                  : "Select one owner and one approver from the organization directory."}
              </p>
            </div>
            <WorkflowParticipants
              mode="edit"
              roles={workflowRoles}
              subjects={workflowSubjects}
              assignments={participantAssignments}
              disabled={metadataLocked || Boolean(submitted)}
              validationErrors={participantErrors}
              labels={{
                add: language === "cs" ? "Přidat" : "Add",
                remove: language === "cs" ? "Odebrat" : "Remove",
                required: language === "cs" ? "Povinné" : "Required",
                optional: language === "cs" ? "Volitelné" : "Optional",
                selectSubject: language === "cs" ? "Vybrat z adresáře" : "Select from directory",
                empty: language === "cs" ? "Role zatím není přiřazena." : "No assignment yet.",
                directory: {
                  title: language === "cs" ? "Adresář organizace" : "Organization directory",
                  search: language === "cs" ? "Hledat osobu nebo jednotku" : "Search person or unit",
                  placeholder: language === "cs" ? "Jméno nebo jednotka" : "Name or unit",
                  empty: language === "cs" ? "Nebyl nalezen žádný subjekt." : "No subject found.",
                  close: language === "cs" ? "Zavřít" : "Close",
                },
              }}
              onAssignmentsChange={(assignments) => {
                setParticipantAssignments(assignments);
                setParticipantErrors([]);
                setError(null);
                setDirty(true);
              }}
            />
          </div>
          <div className="form-grid form-grid--three">
            <div className="field">
              <FieldLabelWithHelp htmlFor="version-label" label={copy.versionLabel} helpLabel={copy.versionHelpLabel} helpText={copy.versionHint} />
              <input id="version-label" name="version_label" value="1.0" readOnly />
              <small>{copy.versionHint}</small>
            </div>
            <div className="field">
              <FieldLabelWithHelp htmlFor="valid-from" label={copy.validFrom} helpLabel={copy.validFromHelpLabel} helpText={copy.validFromHelp} />
              <input id="valid-from" name="valid_from" type="date" defaultValue={new Date().toISOString().slice(0, 10)} disabled={Boolean(submitted)} />
            </div>
            <StratosSelect
              id="parser"
              name="parser_profile"
              label={copy.parserProfile}
              labelAccessory={<HelpHint label={copy.parserHelpLabel} text={copy.parserHelp} />}
              value={parserProfile}
              disabled={Boolean(submitted)}
              onChange={(event) => setParserProfile(event.target.value as ParserProfile)}
            >
              <option value="controlled_document">{copy.parserControlled}</option>
              <option value="plain_text">{copy.parserPlain}</option>
              <option value="ocr_heavy">{copy.parserOcr}</option>
            </StratosSelect>
          </div>
          <StratosSelect
            id="chunking"
            name="chunking_strategy"
            label={copy.chunkingStrategy}
            labelAccessory={<HelpHint label={copy.chunkingHelpLabel} text={copy.chunkingHelp} />}
            value={chunkingStrategy}
            disabled={Boolean(submitted)}
            onChange={(event) => setChunkingStrategy(event.target.value as ChunkingStrategy)}
          >
            <option value="legal_structured">{copy.chunkLegal}</option>
            <option value="semantic">{copy.chunkSemantic}</option>
            <option value="fixed_window">{copy.chunkFixed}</option>
          </StratosSelect>
          <div className="field">
            <div className="stratos-field-label-row">
              <strong>{copy.file}</strong>
              <HelpHint label={copy.fileHelpLabel} text={copy.fileHelp} />
            </div>
            <FileDropzone
              accept={SUPPORTED_UPLOAD_ACCEPT}
              files={selectedFile ? [selectedFile] : []}
              maxFiles={1}
              maxSize={MAX_UPLOAD_SIZE_BYTES}
              multiple={false}
              disabled={Boolean(submitted)}
              state={
                submitted ? "success"
                  : filePreflight?.error ? "error"
                    : filePreflight?.hashing ? "uploading"
                      : selectedFile ? "selected"
                        : "idle"
              }
              labels={{
                browse: language === "cs" ? "Vybrat soubor" : "Browse file",
                drop: language === "cs" ? "Přetáhněte soubor sem" : "Drop file here",
                hint: copy.chooseFile,
                replace: language === "cs" ? "Nahradit" : "Replace",
                selected: copy.fileReady,
                uploading: copy.hashing,
                success: copy.queued,
              }}
              onFilesSelected={(files) => void selectSourceFile(files[0] ?? null)}
              onRemoveFile={() => void selectSourceFile(null)}
              onValidationError={(validationErrors) => setError(validationErrors[0]?.message ?? copy.missingFile)}
            />
          </div>
          {filePreflight ? (
            <div className="preflight-card">
              <div>
                <strong>{filePreflight.name}</strong>
                <span>
                  {copy.size} {formatNumber(filePreflight.size, language)} B - {copy.mime} {filePreflight.type}
                </span>
              </div>
              <StatusBadge
                value={filePreflight.hash && !filePreflight.hashing ? "valid" : filePreflight.hashing ? "running" : "completed_with_warnings"}
                label={filePreflight.hashing ? copy.hashing : filePreflight.hash ? copy.fileReady : filePreflight.error ?? copy.waiting}
              />
              <div className="preflight-hash">
                <Fingerprint size={15} aria-hidden="true" />
                <span>{filePreflight.hash ? copy.fingerprintReady : filePreflight.error ?? copy.hashing}</span>
              </div>
            </div>
          ) : null}
          <StratosButton tone="primary" type="submit" disabled={!canSubmit}>
            <Play size={16} aria-hidden="true" />
            {submitting ? copy.saving : copy.save}
          </StratosButton>
          {!allowed ? (
            <p className="notice">{copy.disabled}</p>
          ) : null}
          {createdDocument && !submitted ? <p className="notice">{copy.draftRetained}</p> : null}
          {error ? <p className="notice notice--danger">{error}</p> : null}
        </div>
      </form>

      <aside className="panel">
        <div className="panel__header">
          <h2>{copy.validationPreview}</h2>
          <StatusBadge value={phase === "queued" ? "valid" : submitting ? "running" : "draft"} label={statusLabel} />
        </div>
        <div className="panel__body stack">
          <div className="guided-steps">
            {guidedSteps.map((step) => (
              <div className={`guided-step ${step.done ? "guided-step--done" : ""} ${step.active && !step.done ? "guided-step--active" : ""}`} key={step.label}>
                <span aria-hidden="true">{step.done ? <CheckCircle2 size={16} /> : <FileClock size={16} />}</span>
                <div>
                  <strong>{step.label}</strong>
                  <p>{step.detail}</p>
                  <small>{step.done ? copy.done : step.active ? copy.current : copy.waiting}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="timeline-item">
            <strong>{copy.boundaryCheck}</strong>
            <span>{copy.boundaryDetail}</span>
          </div>
          <div className="timeline-item">
            <strong>{copy.authorization}</strong>
            <span>{copy.authorizationDetail}</span>
          </div>
          {createdDocument ? (
            <div className="timeline-item timeline-item--active">
              <strong>{copy.created}</strong>
              <span>{createdDocument.title}</span>
            </div>
          ) : null}
          {submitted ? (
            <div className="notice">
              <CheckCircle2 size={16} aria-hidden="true" /> {copy.queuedDetail}
            </div>
          ) : null}
          {submitted ? (
            <div className="task-action-panel">
              <div className="task-action-panel__header">
                <div>
                  <strong>{copy.doneTitle}</strong>
                  <p>{copy.doneDetail}</p>
                </div>
                <StatusBadge value="running" label={copy.processingQueued} />
              </div>
              <div className="task-actions">
                <StratosButtonLink tone="primary" href={`/documents/${submitted.document.document_id}`}>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  {copy.openDocument}
                </StratosButtonLink>
                <StratosButtonLink href="/ingestion">
                  <ListChecks size={16} aria-hidden="true" />
                  {copy.openProcessing}
                </StratosButtonLink>
                <StratosButtonLink href={`/upload?document_id=${encodeURIComponent(submitted.document.document_id)}`}>
                  <FilePlus2 size={16} aria-hidden="true" />
                  {copy.uploadNextVersion}
                </StratosButtonLink>
                <StratosButton type="button" onClick={resetFlow}>
                  <RotateCcw size={16} aria-hidden="true" />
                  {copy.createAnother}
                </StratosButton>
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    </section>
  );
}

function buildFirstVersionSummary({ copy, title }: { copy: Record<string, string>; title: string }): string {
  return `${copy.summaryPrefix}: ${title}. ${copy.sourceAdded}`;
}

function buildWorkflowError(prefix: string, detail: string): string {
  const cleanDetail = detail.trim();
  return cleanDetail ? `${prefix}: ${cleanDetail}` : `${prefix}.`;
}
