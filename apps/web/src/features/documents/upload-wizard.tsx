"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, FileUp, Fingerprint, Play, ShieldCheck, UploadCloud } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type {
  AuthorizationHint,
  Document,
  DocumentVersion,
  IngestionJob,
  UploadContentResponse,
  UploadPreflightDecision
} from "@/lib/types";

interface UploadWizardProps {
  documents: Document[];
  authorization: AuthorizationHint;
}

const uploadCopy = {
  cs: {
    hidden: "Akce nahrání jsou skryté, protože Registry API neudělilo document.ingest.",
    workflowError: "Workflow API vrátilo HTTP",
    requestFailed: "Workflow požadavek selhal.",
    uploadError: "Upload endpoint vrátil HTTP",
    preflightError: "Preflight endpoint vrátil HTTP",
    missingFile: "Nejprve vyberte soubor a nechte proběhnout preflight.",
    title: "Průvodce nahráním",
    file: "Soubor",
    chooseFile: "Vyberte soubor pro preflight",
    fileReady: "Soubor připraven",
    hashing: "Počítám SHA-256",
    hashFailed: "Hash souboru se nepodařilo vypočítat.",
    preflighting: "Ověřuji preflight",
    preflightReady: "Preflight schválen",
    uploadReady: "Upload připraven",
    uploading: "Nahrávám soubor",
    uploadStored: "Soubor uložen",
    size: "velikost",
    mime: "MIME",
    sha256: "SHA-256",
    document: "Dokument",
    versionLabel: "Označení verze",
    validFrom: "Platná od",
    sourceFileUri: "URI zdrojového souboru",
    sourceFileUriHint: "URI je vytvořené preflight endpointem a nelze ho ručně přepsat.",
    parserProfile: "Parser profil",
    chunkingStrategy: "Strategie chunkingu",
    changeSummary: "Souhrn změny",
    defaultSummary: "Nová verze připravena pro ingestion pipeline.",
    queueing: "Řadím",
    submit: "Nahrát, vytvořit verzi a zařadit ingestion",
    validationPreview: "Kontrolní náhled",
    selectedDocument: "Vybraný dokument",
    noDocument: "Není vybraný dokument",
    boundaryCheck: "Kontrola hranic",
    boundaryDetail: "Browser po preflight nahrává soubor pouze přes podepsaný aplikační upload endpoint. Ingestion pak čte objekt přes s3:// URI ze sdíleného úložiště.",
    authorization: "Oprávnění",
    authorizationDetail: "Viditelné, protože Registry API autorizace uděluje document.ingest.",
    uploadGate: "Publish gate",
    uploadGateDetail: "Nejdřív upload, preflight, ingestion a governance kontrola; publikace až po schválení v detailu dokumentu.",
    uploadSession: "Upload session",
    objectKey: "Objekt",
    expires: "Expiruje",
    createdVersion: "Vytvořena verze",
    queuedJob: "a zařazena ingestion úloha"
  },
  en: {
    hidden: "Upload actions are hidden because Registry API did not grant document.ingest.",
    workflowError: "Workflow API returned HTTP",
    requestFailed: "Workflow request failed.",
    uploadError: "Upload endpoint returned HTTP",
    preflightError: "Preflight endpoint returned HTTP",
    missingFile: "Choose a file and wait for preflight first.",
    title: "Upload wizard",
    file: "File",
    chooseFile: "Choose file for preflight",
    fileReady: "File ready",
    hashing: "Computing SHA-256",
    hashFailed: "File hash could not be computed.",
    preflighting: "Checking preflight",
    preflightReady: "Preflight approved",
    uploadReady: "Upload ready",
    uploading: "Uploading file",
    uploadStored: "File stored",
    size: "size",
    mime: "MIME",
    sha256: "SHA-256",
    document: "Document",
    versionLabel: "Version label",
    validFrom: "Valid from",
    sourceFileUri: "Source file URI",
    sourceFileUriHint: "The URI is created by the preflight endpoint and cannot be edited manually.",
    parserProfile: "Parser profile",
    chunkingStrategy: "Chunking strategy",
    changeSummary: "Change summary",
    defaultSummary: "New version prepared for ingestion pipeline.",
    queueing: "Queueing",
    submit: "Upload, create version and queue ingestion",
    validationPreview: "Validation preview",
    selectedDocument: "Selected document",
    noDocument: "No document selected",
    boundaryCheck: "Boundary check",
    boundaryDetail: "After preflight, the browser uploads only through a signed application upload endpoint. Ingestion then reads the object through an s3:// URI from shared storage.",
    authorization: "Authorization",
    authorizationDetail: "Visible because Registry API authorization grants document.ingest.",
    uploadGate: "Publish gate",
    uploadGateDetail: "Upload, preflight, ingestion and governance check first; publish only after approval in the document detail.",
    uploadSession: "Upload session",
    objectKey: "Object",
    expires: "Expires",
    createdVersion: "Created version",
    queuedJob: "and queued ingestion job"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

interface FilePreflight {
  name: string;
  size: number;
  type: string;
  hash: string | null;
  hashing: boolean;
  error: string | null;
}

type UploadPhase = "idle" | "preflight" | "ready" | "uploading" | "stored";

export function UploadWizard({ documents, authorization }: UploadWizardProps) {
  const { language } = useLanguage();
  const copy = uploadCopy[language];
  const [selectedDocumentId, setSelectedDocumentId] = useState(documents[0]?.document_id ?? "");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreflight, setFilePreflight] = useState<FilePreflight | null>(null);
  const [uploadPreflight, setUploadPreflight] = useState<UploadPreflightDecision | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [submitted, setSubmitted] = useState<{ version: DocumentVersion; job: IngestionJob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedDocument = useMemo(
    () => documents.find((document) => document.document_id === selectedDocumentId),
    [documents, selectedDocumentId]
  );

  const prepareUploadSession = useCallback(
    async (documentId: string, file: File, hash: string) => {
      setUploadPreflight(null);
      setUploadPhase("preflight");
      setError(null);

      const response = await fetch("/api/controlled-document/upload/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: documentId,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type || "application/octet-stream",
          sha256: hash
        })
      });

      if (!response.ok) {
        setUploadPhase("idle");
        setError(`${copy.preflightError} ${response.status}. ${await readErrorMessage(response)}`);
        return;
      }

      const body = (await response.json()) as { preflight: UploadPreflightDecision };
      setUploadPreflight(body.preflight);
      setUploadPhase("ready");
    },
    [copy.preflightError]
  );

  if (!authorization.can_ingest) {
    return (
      <section className="panel">
        <div className="empty-state">
          <ShieldCheck size={24} aria-hidden="true" />
          {copy.hidden}
        </div>
      </section>
    );
  }

  const sourceUri = uploadPreflight?.source_file_uri ?? defaultSourceUri(selectedDocumentId, filePreflight?.name ?? "file.md");
  const canSubmit = Boolean(selectedDocumentId && selectedFile && filePreflight?.hash && uploadPreflight && !submitting);
  const uploadStatusLabel =
    uploadPhase === "stored"
      ? copy.uploadStored
      : uploadPhase === "uploading"
        ? copy.uploading
        : uploadPhase === "ready"
          ? copy.preflightReady
          : uploadPhase === "preflight"
            ? copy.preflighting
            : copy.uploadReady;

  return (
    <section className="grid grid--two">
      <form
        className="panel"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!selectedFile || !filePreflight?.hash || !uploadPreflight) {
            setError(copy.missingFile);
            return;
          }

          setSubmitting(true);
          setUploadPhase("uploading");
          setError(null);
          const form = new FormData(event.currentTarget);

          try {
            const uploadResponse = await fetch(uploadPreflight.upload_url, {
              method: uploadPreflight.upload_method,
              headers: uploadPreflight.required_headers,
              body: selectedFile
            });

            if (!uploadResponse.ok) {
              setError(`${copy.uploadError} ${uploadResponse.status}. ${await readErrorMessage(uploadResponse)}`);
              setUploadPhase("ready");
              return;
            }

            const uploaded = (await uploadResponse.json()) as UploadContentResponse;
            setUploadPhase("stored");

            const payload = {
              ...Object.fromEntries(form.entries()),
              document_id: selectedDocumentId,
              upload_session_id: uploadPreflight.upload_session_id,
              upload_token: uploadPreflight.required_headers["X-AKL-Upload-Token"],
              source_file_uri: uploaded.source_file_uri,
              file_hash: uploaded.file.sha256,
              file_name: uploaded.file.filename,
              file_size: uploaded.file.size_bytes,
              file_type: uploaded.file.mime_type
            };
            const workflowResponse = await fetch("/api/controlled-document/ingestion", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });

            if (!workflowResponse.ok) {
              setError(`${copy.workflowError} ${workflowResponse.status}. ${await readErrorMessage(workflowResponse)}`);
              return;
            }

            setSubmitted((await workflowResponse.json()) as { version: DocumentVersion; job: IngestionJob });
          } catch (reason: unknown) {
            setError(reason instanceof Error ? reason.message : copy.requestFailed);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <div className="panel__header">
          <h2>{copy.title}</h2>
          <FileUp size={18} aria-hidden="true" />
        </div>
        <div className="panel__body form-grid">
          <div className="field">
            <label htmlFor="source-file">{copy.file}</label>
            <div className="file-drop">
              <UploadCloud size={20} aria-hidden="true" />
              <input
                id="source-file"
                type="file"
                accept=".doc,.docx,.md,.markdown,.pdf,.rtf,.txt,application/msword,application/pdf,application/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain,text/rtf"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  setSubmitted(null);
                  setUploadPreflight(null);
                  setUploadPhase("idle");
                  if (!file) {
                    setSelectedFile(null);
                    setFilePreflight(null);
                    return;
                  }
                  setSelectedFile(file);
                  setFilePreflight({
                    name: file.name,
                    size: file.size,
                    type: file.type || "application/octet-stream",
                    hash: null,
                    hashing: true,
                    error: null
                  });
                  try {
                    const hash = await sha256(file);
                    setFilePreflight({
                      name: file.name,
                      size: file.size,
                      type: file.type || "application/octet-stream",
                      hash,
                      hashing: false,
                      error: null
                    });
                    await prepareUploadSession(selectedDocumentId, file, hash);
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
                value={uploadPhase === "ready" || uploadPhase === "stored" ? "valid" : filePreflight.hashing || uploadPhase === "preflight" ? "running" : "completed_with_warnings"}
                label={filePreflight.hashing ? copy.hashing : uploadStatusLabel}
              />
              <div className="preflight-hash">
                <Fingerprint size={15} aria-hidden="true" />
                <span>{filePreflight.hash ?? filePreflight.error ?? copy.hashing}</span>
              </div>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="document">{copy.document}</label>
            <select
              id="document"
              value={selectedDocumentId}
              onChange={(event) => {
                const documentId = event.target.value;
                setSelectedDocumentId(documentId);
                setSubmitted(null);
                if (selectedFile && filePreflight?.hash) {
                  void prepareUploadSession(documentId, selectedFile, filePreflight.hash);
                }
              }}
            >
              {documents.map((document) => (
                <option key={document.document_id} value={document.document_id}>{document.title}</option>
              ))}
            </select>
          </div>
          <div className="form-grid form-grid--two">
            <div className="field">
              <label htmlFor="version">{copy.versionLabel}</label>
              <input id="version" name="version_label" placeholder="1.1" defaultValue="0.1" />
            </div>
            <div className="field">
              <label htmlFor="valid-from">{copy.validFrom}</label>
              <input id="valid-from" name="valid_from" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="source-uri">{copy.sourceFileUri}</label>
            <input id="source-uri" name="source_file_uri" value={sourceUri} readOnly />
            <small>{copy.sourceFileUriHint}</small>
          </div>
          <div className="form-grid form-grid--two">
            <div className="field">
              <label htmlFor="parser">{copy.parserProfile}</label>
              <select id="parser" name="parser_profile" defaultValue="controlled_document">
                <option value="controlled_document">controlled_document</option>
                <option value="plain_text">plain_text</option>
                <option value="ocr_heavy">ocr_heavy</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="chunking">{copy.chunkingStrategy}</label>
              <select id="chunking" name="chunking_strategy" defaultValue="legal_structured">
                <option value="legal_structured">legal_structured</option>
                <option value="semantic">semantic</option>
                <option value="fixed_window">fixed_window</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="summary">{copy.changeSummary}</label>
            <textarea id="summary" name="change_summary" defaultValue={copy.defaultSummary} key={language} />
          </div>
          <input type="hidden" name="embedding_profile" value="default" />
          <button className="button button--primary" type="submit" disabled={!canSubmit}>
            <Play size={16} aria-hidden="true" />
            {submitting ? copy.queueing : copy.submit}
          </button>
          {error ? <p className="notice">{error}</p> : null}
        </div>
      </form>

      <aside className="panel">
        <div className="panel__header">
          <h2>{copy.validationPreview}</h2>
          {submitted ? <StatusBadge value={submitted.job.status} /> : <StatusBadge value={uploadPhase === "ready" || uploadPhase === "stored" ? "valid" : uploadPhase === "preflight" ? "running" : "draft"} />}
        </div>
        <div className="panel__body stack">
          <div className="timeline-item">
            <strong>{copy.selectedDocument}</strong>
            <span>{selectedDocument?.title ?? copy.noDocument}</span>
          </div>
          <div className="timeline-item">
            <strong>{copy.boundaryCheck}</strong>
            <span>{copy.boundaryDetail}</span>
          </div>
          {uploadPreflight ? (
            <>
              <div className="timeline-item">
                <strong>{copy.uploadSession}</strong>
                <span>{uploadPreflight.upload_session_id}</span>
              </div>
              <div className="timeline-item">
                <strong>{copy.objectKey}</strong>
                <span>{uploadPreflight.object_key}</span>
              </div>
              <div className="timeline-item">
                <strong>{copy.expires}</strong>
                <span>{formatDateTime(uploadPreflight.expires_at, language)}</span>
              </div>
            </>
          ) : null}
          <div className="timeline-item">
            <strong>{copy.authorization}</strong>
            <span>{copy.authorizationDetail}</span>
          </div>
          <div className="timeline-item">
            <strong>{copy.uploadGate}</strong>
            <span>{copy.uploadGateDetail}</span>
          </div>
          {submitted ? (
            <div className="notice">
              <CheckCircle2 size={16} aria-hidden="true" /> {copy.createdVersion} {submitted.version.document_version_id} {copy.queuedJob} {submitted.job.job_id}.
            </div>
          ) : null}
        </div>
      </aside>
    </section>
  );
}

function defaultSourceUri(documentId: string, fileName: string): string {
  const safeDocumentId = documentId || "doc_pending";
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "file.md";
  return `s3://akl-documents/${safeDocumentId}/draft/pending/${safeName}`;
}

async function sha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = Array.from(new Uint8Array(digest));
  return `sha256:${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? "";
  } catch {
    return "";
  }
}
