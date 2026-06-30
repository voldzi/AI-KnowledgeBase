"use client";

import { useState } from "react";
import { CheckCircle2, FileClock, FilePlus2, Fingerprint, ListChecks, Play, RotateCcw, UploadCloud } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { StratosButton, StratosButtonLink, StratosSelect } from "@/components/stratos";
import { withAppBasePath } from "@/lib/app-url";
import { documentTypeLabel, formatNumber } from "@/lib/format";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type {
  AuthorizationHint,
  Document,
  DocumentVersion,
  IngestionJob,
  UploadContentResponse,
  UploadPreflightDecision
} from "@/lib/types";
import { readErrorMessage, sha256File, SUPPORTED_UPLOAD_ACCEPT } from "./upload-client-utils";

interface NewDocumentFormProps {
  authorization: AuthorizationHint;
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

const newDocumentCopy = {
  cs: {
    title: "Založit dokument a první verzi",
    titleLabel: "Název",
    titlePlaceholder: "Název dokumentu",
    type: "Typ dokumentu",
    classification: "Klasifikace",
    gestorUnit: "Gestorská jednotka",
    tags: "Štítky",
    file: "Originální soubor",
    chooseFile: "Vyberte originální soubor pro první verzi",
    fileReady: "Soubor připraven",
    hashing: "Počítám SHA-256",
    hashFailed: "Hash souboru se nepodařilo vypočítat.",
    size: "velikost",
    mime: "MIME",
    versionLabel: "První verze",
    versionHint: "První verze nového dokumentu je vždy 1.0. Další verze už AKB navyšuje podle zvolené změny.",
    validFrom: "Platná od",
    parserProfile: "Způsob čtení dokumentu",
    chunkingStrategy: "Dělení pro citace",
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
    createAnother: "Založit další dokument",
    validationPreview: "Průběh založení",
    stepMetadata: "Metadata dokumentu",
    stepMetadataDetail: "Název, typ, klasifikace a štítky vzniknou jako koncept dokumentu.",
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
    titleLabel: "Title",
    titlePlaceholder: "Document title",
    type: "Document type",
    classification: "Classification",
    gestorUnit: "Gestor unit",
    tags: "Tags",
    file: "Original file",
    chooseFile: "Choose the original file for the first version",
    fileReady: "File ready",
    hashing: "Computing SHA-256",
    hashFailed: "File hash could not be computed.",
    size: "size",
    mime: "MIME",
    versionLabel: "First version",
    versionHint: "The first version of a new document is always 1.0. Later versions are incremented from the selected change type.",
    validFrom: "Valid from",
    parserProfile: "How AKB reads the file",
    chunkingStrategy: "Citation segmentation",
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
    createAnother: "Create another document",
    validationPreview: "Creation progress",
    stepMetadata: "Document metadata",
    stepMetadataDetail: "Title, type, classification and tags are created as the document draft.",
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

export function NewDocumentForm({ authorization }: NewDocumentFormProps) {
  const { language } = useLanguage();
  const copy = newDocumentCopy[language];
  const [createdDocument, setCreatedDocument] = useState<Document | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreflight, setFilePreflight] = useState<FilePreflight | null>(null);
  const [submitted, setSubmitted] = useState<{ document: Document; version: DocumentVersion; job: IngestionJob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<FirstVersionPhase>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [formResetKey, setFormResetKey] = useState(0);

  function resetFlow() {
    setCreatedDocument(null);
    setSelectedFile(null);
    setFilePreflight(null);
    setSubmitted(null);
    setError(null);
    setPhase("idle");
    setSubmitting(false);
    setFormResetKey((current) => current + 1);
  }

  const allowed = authorization.can_update && authorization.can_ingest;
  const metadataLocked = Boolean(createdDocument && !submitted);
  const canSubmit = Boolean(allowed && selectedFile && filePreflight?.hash && !filePreflight.hashing && !submitting && !submitted);
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

  return (
    <section className="grid grid--two">
      <form
        key={formResetKey}
        className="panel"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!selectedFile || !filePreflight?.hash) {
            setError(copy.missingFile);
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
                body: JSON.stringify(Object.fromEntries(form.entries()))
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
          <FilePlus2 size={18} aria-hidden="true" />
        </div>
        <div className="panel__body form-grid">
          <div className="form-grid form-grid--two">
            <div className="field">
              <label htmlFor="title">{copy.titleLabel}</label>
              <input id="title" name="title" placeholder={copy.titlePlaceholder} required readOnly={metadataLocked || Boolean(submitted)} />
            </div>
            <StratosSelect id="type" name="document_type" label={copy.type} defaultValue="directive" disabled={metadataLocked || Boolean(submitted)}>
              {["directive", "methodology", "policy", "manual", "project_documentation"].map((value) => (
                <option key={value} value={value}>{documentTypeLabel(value, language)}</option>
              ))}
            </StratosSelect>
          </div>
          <div className="form-grid form-grid--two">
            <StratosSelect id="classification" name="classification" label={copy.classification} defaultValue="internal" disabled={metadataLocked || Boolean(submitted)}>
              <option value="public">{copy.public}</option>
              <option value="internal">{copy.internal}</option>
              <option value="restricted">{copy.restricted}</option>
              <option value="confidential">{copy.confidential}</option>
            </StratosSelect>
            <div className="field">
              <label htmlFor="gestor">{copy.gestorUnit}</label>
              <input id="gestor" name="gestor_unit" placeholder="IT" readOnly={metadataLocked || Boolean(submitted)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="tags">{copy.tags}</label>
            <input id="tags" name="tags" defaultValue="controlled-document,akb" readOnly={metadataLocked || Boolean(submitted)} />
          </div>
          <div className="form-grid form-grid--three">
            <div className="field">
              <label htmlFor="version-label">{copy.versionLabel}</label>
              <input id="version-label" name="version_label" value="1.0" readOnly />
              <small>{copy.versionHint}</small>
            </div>
            <div className="field">
              <label htmlFor="valid-from">{copy.validFrom}</label>
              <input id="valid-from" name="valid_from" type="date" defaultValue={new Date().toISOString().slice(0, 10)} disabled={Boolean(submitted)} />
            </div>
            <StratosSelect id="parser" name="parser_profile" label={copy.parserProfile} defaultValue="controlled_document" disabled={Boolean(submitted)}>
              <option value="controlled_document">{copy.parserControlled}</option>
              <option value="plain_text">{copy.parserPlain}</option>
              <option value="ocr_heavy">{copy.parserOcr}</option>
            </StratosSelect>
          </div>
          <StratosSelect id="chunking" name="chunking_strategy" label={copy.chunkingStrategy} defaultValue="legal_structured" disabled={Boolean(submitted)}>
            <option value="legal_structured">{copy.chunkLegal}</option>
            <option value="semantic">{copy.chunkSemantic}</option>
            <option value="fixed_window">{copy.chunkFixed}</option>
          </StratosSelect>
          <div className="field">
            <label htmlFor="source-file">{copy.file}</label>
            <div className="file-drop">
              <UploadCloud size={20} aria-hidden="true" />
              <input
                id="source-file"
                type="file"
                accept={SUPPORTED_UPLOAD_ACCEPT}
                disabled={Boolean(submitted)}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  setError(null);
                  setSubmitted(null);
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
                    error: null
                  });
                  try {
                    const hash = await sha256File(file);
                    setFilePreflight({
                      name: file.name,
                      size: file.size,
                      type: file.type || "application/octet-stream",
                      hash,
                      hashing: false,
                      error: null
                    });
                  } catch {
                    setFilePreflight({
                      name: file.name,
                      size: file.size,
                      type: file.type || "application/octet-stream",
                      hash: null,
                      hashing: false,
                      error: copy.hashFailed
                    });
                  }
                }}
              />
              <span>{copy.chooseFile}</span>
            </div>
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
