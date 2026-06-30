"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, FileClock, FileUp, Fingerprint, Play, ShieldCheck, UploadCloud } from "lucide-react";
import { FieldLabelWithHelp, HelpHint } from "@voldzi/stratos-ui";

import { StatusBadge } from "@/components/status-badge";
import { StratosButton, StratosSelect } from "@/components/stratos";
import { withAppBasePath } from "@/lib/app-url";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import { readErrorMessage, sha256File, SUPPORTED_UPLOAD_ACCEPT } from "./upload-client-utils";
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
  initialDocumentId?: string | null;
  versionsByDocumentId: Record<string, DocumentVersion[]>;
}

const uploadCopy = {
  cs: {
    hidden: "Nahrání dokumentu není pro tuto relaci povolené.",
    workflowError: "Založení verze selhalo s HTTP",
    requestFailed: "Nahrání se nepodařilo dokončit.",
    uploadError: "Uložení souboru selhalo s HTTP",
    preflightError: "Kontrola souboru selhala s HTTP",
    missingFile: "Nejprve vyberte soubor a počkejte na dokončení kontroly.",
    title: "Nahrání nové verze",
    file: "Soubor",
    fileHelpLabel: "Nápověda k souboru",
    fileHelp: "Vyberte originální dokument nové verze. AKB ho bezpečně uloží a použije pro citace.",
    chooseFile: "Vyberte originální soubor dokumentu",
    fileReady: "Soubor připraven",
    hashing: "Počítám SHA-256",
    hashFailed: "Hash souboru se nepodařilo vypočítat.",
    preflighting: "Kontroluji soubor",
    preflightReady: "Soubor je ověřený",
    uploadReady: "Připraveno k nahrání",
    uploading: "Nahrávám soubor",
    uploadStored: "Soubor uložen",
    size: "velikost",
    mime: "MIME",
    sha256: "SHA-256",
    document: "Dokument",
    documentHelpLabel: "Nápověda k výběru dokumentu",
    documentHelp: "Vyberte dokument, ke kterému nová verze patří. Při příchodu z detailu je výběr předvyplněný.",
    versionIncrement: "Typ nové verze",
    versionIncrementHelpLabel: "Nápověda k typu nové verze",
    versionIncrementHelp: "Oprava navyšuje jen opravné číslo, běžná revize menší číslo a hlavní vydání první číslo verze.",
    versionBaseLabel: "Poslední verze",
    versionNextLabel: "Nová verze",
    versionIncrementFix: "Oprava bez věcné změny",
    versionIncrementRevision: "Běžná revize dokumentu",
    versionIncrementMajor: "Nové hlavní vydání",
    versionIncrementHint: "AKB číslo verze dopočítá podle poslední verze dokumentu. Operátor nevyplňuje vlastní text.",
    noPreviousVersion: "žádná",
    validFrom: "Platná od",
    validFromHelpLabel: "Nápověda k platnosti",
    validFromHelp: "Zadejte den, od kterého má být nová verze používána jako aktuální zdroj.",
    sourceFileUri: "Umístění zdroje",
    sourceFileUriHelpLabel: "Nápověda k umístění zdroje",
    sourceFileUriHint: "Umístění zdroje vytvoří AKB automaticky po kontrole souboru.",
    parserProfile: "Způsob čtení dokumentu",
    parserHelpLabel: "Nápověda ke způsobu čtení",
    parserHelp: "Pro řízené dokumenty ponechte výchozí volbu. OCR zvolte pro skeny nebo špatně čitelné PDF.",
    chunkingStrategy: "Dělení pro citace",
    chunkingHelpLabel: "Nápověda k dělení pro citace",
    chunkingHelp: "Podle kapitol a odstavců pomáhá přesně otevírat citace ve směrnicích a metodikách.",
    parserControlled: "Řízený dokument",
    parserPlain: "Jednoduchý text",
    parserOcr: "Sken nebo OCR náročný dokument",
    chunkLegal: "Podle kapitol a odstavců",
    chunkSemantic: "Podle významových částí",
    chunkFixed: "Po stejně velkých úsecích",
    changeSummary: "Souhrn změny",
    changeGuidance: "Místo volného textu vyberte, co se změnilo. AKB z voleb vytvoří auditovatelný souhrn verze.",
    changeSummaryHelpLabel: "Nápověda k souhrnu změny",
    changeSummaryHelp: "Tyto volby nahradí volný text. Díky tomu bude historie verzí srozumitelná a porovnatelná.",
    changeKind: "Typ změny",
    changeKindHelpLabel: "Nápověda k typu změny",
    changeKindHelp: "Vyberte nejbližší důvod nové verze. Pokud si nejste jistí, použijte úpravu obsahu.",
    changeImpact: "Dopad změny",
    changeImpactHelpLabel: "Nápověda k dopadu změny",
    changeImpactHelp: "Dopad říká, zda se mění povinnosti, role, lhůty nebo je potřeba věcná revize.",
    nextStep: "Doporučený další krok",
    nextStepHelpLabel: "Nápověda k dalšímu kroku",
    nextStepHelp: "Zvolte krok, který má po zpracování udělat vlastník nebo správce dokumentu.",
    summaryPreview: "Souhrn pro historii verzí",
    changeKindMinor: "Oprava překlepu nebo formátu",
    changeKindContent: "Úprava obsahu dokumentu",
    changeKindPolicy: "Změna pravidla nebo povinnosti",
    changeKindSource: "Doplnění originálního zdroje",
    changeImpactNone: "Bez dopadu na uživatele",
    changeImpactRoles: "Mění role nebo odpovědnosti",
    changeImpactDates: "Mění platnost, lhůty nebo SLA",
    changeImpactReview: "Vyžaduje věcnou revizi",
    nextStepOwner: "Předat vlastníkovi/gestorovi",
    nextStepGovernance: "Spustit kontrolu pravidel",
    nextStepPublish: "Po schválení publikovat",
    summaryPrefix: "Nová verze",
    queueing: "Řadím",
    submit: "Nahrát verzi a spustit zpracování",
    validationPreview: "Co se stane dál",
    selectedDocument: "Vybraný dokument",
    noDocument: "Není vybraný dokument",
    boundaryCheck: "Bezpečné nahrání",
    boundaryDetail: "Soubor se nahraje přes krátkodobě povolený kanál AKB. Aplikace, ze které uživatel přichází, neukládá binární obsah ani extrahovaný text.",
    authorization: "Oprávnění",
    authorizationDetail: "Tento krok je dostupný, protože uživatel může nahrávat verze dokumentů.",
    uploadGate: "Další krok",
    uploadGateDetail: "Po zpracování otevřete detail dokumentu, zkontrolujte citace a případně předáte verzi ke schválení.",
    uploadSession: "Upload session",
    objectKey: "Objekt",
    expires: "Expiruje",
    createdVersion: "Vytvořena verze",
    queuedJob: "a spuštěno zpracování",
    stepSelectFile: "Vybrat soubor",
    stepSelectFileDetail: "AKB spočítá otisk a ověří typ souboru.",
    stepDescribeChange: "Popsat změnu volbami",
    stepDescribeChangeDetail: "Souhrn verze vznikne z řízených polí, ne z volného textu.",
    stepUpload: "Nahrát a založit verzi",
    stepUploadDetail: "Po nahrání se automaticky spustí zpracování pro citace.",
    done: "Hotovo",
    current: "Probíhá",
    waiting: "Čeká"
  },
  en: {
    hidden: "Document upload is not allowed for this session.",
    workflowError: "Version creation failed with HTTP",
    requestFailed: "Upload could not be completed.",
    uploadError: "File storage failed with HTTP",
    preflightError: "File check failed with HTTP",
    missingFile: "Choose a file and wait for the check to finish.",
    title: "Upload a new version",
    file: "File",
    fileHelpLabel: "File help",
    fileHelp: "Choose the original document for the new version. AKB stores it securely and uses it for citations.",
    chooseFile: "Choose the original document file",
    fileReady: "File ready",
    hashing: "Computing SHA-256",
    hashFailed: "File hash could not be computed.",
    preflighting: "Checking file",
    preflightReady: "File verified",
    uploadReady: "Ready to upload",
    uploading: "Uploading file",
    uploadStored: "File stored",
    size: "size",
    mime: "MIME",
    sha256: "SHA-256",
    document: "Document",
    documentHelpLabel: "Document selection help",
    documentHelp: "Choose the document this new version belongs to. When opened from detail, it is preselected.",
    versionIncrement: "New version type",
    versionIncrementHelpLabel: "New version type help",
    versionIncrementHelp: "Fix increments the patch number, regular revision increments the minor number and major release increments the first version number.",
    versionBaseLabel: "Last version",
    versionNextLabel: "New version",
    versionIncrementFix: "Fix without content change",
    versionIncrementRevision: "Regular document revision",
    versionIncrementMajor: "New major release",
    versionIncrementHint: "AKB calculates the version number from the last document version. Operators do not enter free text.",
    noPreviousVersion: "none",
    validFrom: "Valid from",
    validFromHelpLabel: "Validity help",
    validFromHelp: "Enter the day from which the new version should be used as the current source.",
    sourceFileUri: "Source location",
    sourceFileUriHelpLabel: "Source location help",
    sourceFileUriHint: "AKB creates the source location automatically after the file check.",
    parserProfile: "How AKB reads the file",
    parserHelpLabel: "Reading mode help",
    parserHelp: "Keep the default choice for controlled documents. Use OCR for scans or hard-to-read PDFs.",
    chunkingStrategy: "Citation segmentation",
    chunkingHelpLabel: "Citation segmentation help",
    chunkingHelp: "Chapters and paragraphs help citations open precisely in directives and methodologies.",
    parserControlled: "Controlled document",
    parserPlain: "Simple text",
    parserOcr: "Scanned or OCR-heavy document",
    chunkLegal: "By chapters and paragraphs",
    chunkSemantic: "By semantic sections",
    chunkFixed: "By fixed-size segments",
    changeSummary: "Change summary",
    changeGuidance: "Choose what changed. AKB creates an auditable version summary from these controlled fields.",
    changeSummaryHelpLabel: "Change summary help",
    changeSummaryHelp: "These choices replace free text so version history stays clear and comparable.",
    changeKind: "Change type",
    changeKindHelpLabel: "Change type help",
    changeKindHelp: "Choose the closest reason for the new version. If unsure, use document content update.",
    changeImpact: "Change impact",
    changeImpactHelpLabel: "Change impact help",
    changeImpactHelp: "Impact says whether obligations, roles, dates or a subject-matter review are affected.",
    nextStep: "Recommended next step",
    nextStepHelpLabel: "Next step help",
    nextStepHelp: "Choose the step the owner or document manager should take after processing.",
    summaryPreview: "Version history summary",
    changeKindMinor: "Typo or formatting fix",
    changeKindContent: "Document content update",
    changeKindPolicy: "Rule or obligation change",
    changeKindSource: "Original source added",
    changeImpactNone: "No user impact",
    changeImpactRoles: "Changes roles or responsibilities",
    changeImpactDates: "Changes validity, deadlines or SLA",
    changeImpactReview: "Requires subject-matter review",
    nextStepOwner: "Send to owner/gestor",
    nextStepGovernance: "Run governance checks",
    nextStepPublish: "Publish after approval",
    summaryPrefix: "New version",
    queueing: "Queueing",
    submit: "Upload version and start processing",
    validationPreview: "What happens next",
    selectedDocument: "Selected document",
    noDocument: "No document selected",
    boundaryCheck: "Secure upload",
    boundaryDetail: "The file is uploaded through a short-lived AKB channel. The calling application does not store binary content or extracted text.",
    authorization: "Authorization",
    authorizationDetail: "This step is available because the user can upload document versions.",
    uploadGate: "Next step",
    uploadGateDetail: "After processing, open document detail, review citations and send the version for approval if needed.",
    uploadSession: "Upload session",
    objectKey: "Object",
    expires: "Expires",
    createdVersion: "Created version",
    queuedJob: "and started processing",
    stepSelectFile: "Choose file",
    stepSelectFileDetail: "AKB computes the fingerprint and checks the file type.",
    stepDescribeChange: "Describe change with choices",
    stepDescribeChangeDetail: "Version summary is created from controlled fields, not free text.",
    stepUpload: "Upload and create version",
    stepUploadDetail: "Processing starts automatically after upload so citations can be prepared.",
    done: "Done",
    current: "Current",
    waiting: "Waiting"
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
type ChangeKind = "minor" | "content" | "policy" | "source";
type ChangeImpact = "none" | "roles" | "dates" | "review";
type NextStep = "owner" | "governance" | "publish";
type VersionIncrement = "fix" | "revision" | "major";

export function UploadWizard({ documents, authorization, initialDocumentId, versionsByDocumentId }: UploadWizardProps) {
  const { language } = useLanguage();
  const copy = uploadCopy[language];
  const initialSelectedDocumentId = documents.some((document) => document.document_id === initialDocumentId)
    ? initialDocumentId ?? ""
    : documents[0]?.document_id ?? "";
  const [selectedDocumentId, setSelectedDocumentId] = useState(initialSelectedDocumentId);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreflight, setFilePreflight] = useState<FilePreflight | null>(null);
  const [uploadPreflight, setUploadPreflight] = useState<UploadPreflightDecision | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [submitted, setSubmitted] = useState<{ version: DocumentVersion; job: IngestionJob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [changeKind, setChangeKind] = useState<ChangeKind>("content");
  const [changeImpact, setChangeImpact] = useState<ChangeImpact>("review");
  const [nextStep, setNextStep] = useState<NextStep>("owner");
  const [versionIncrement, setVersionIncrement] = useState<VersionIncrement>("revision");
  const selectedDocument = useMemo(
    () => documents.find((document) => document.document_id === selectedDocumentId),
    [documents, selectedDocumentId]
  );
  const selectedVersions = useMemo(
    () => versionsByDocumentId[selectedDocumentId] ?? [],
    [selectedDocumentId, versionsByDocumentId]
  );
  const currentVersionLabel = useMemo(() => latestVersionLabel(selectedVersions), [selectedVersions]);
  const computedVersionLabel = useMemo(
    () => nextVersionLabelFor(selectedVersions, versionIncrement),
    [selectedVersions, versionIncrement]
  );
  const changeOptions = useMemo(
    () => ({
      versionIncrements: [
        { value: "fix" as const, label: copy.versionIncrementFix },
        { value: "revision" as const, label: copy.versionIncrementRevision },
        { value: "major" as const, label: copy.versionIncrementMajor }
      ],
      kinds: [
        { value: "minor" as const, label: copy.changeKindMinor },
        { value: "content" as const, label: copy.changeKindContent },
        { value: "policy" as const, label: copy.changeKindPolicy },
        { value: "source" as const, label: copy.changeKindSource }
      ],
      impacts: [
        { value: "none" as const, label: copy.changeImpactNone },
        { value: "roles" as const, label: copy.changeImpactRoles },
        { value: "dates" as const, label: copy.changeImpactDates },
        { value: "review" as const, label: copy.changeImpactReview }
      ],
      nextSteps: [
        { value: "owner" as const, label: copy.nextStepOwner },
        { value: "governance" as const, label: copy.nextStepGovernance },
        { value: "publish" as const, label: copy.nextStepPublish }
      ]
    }),
    [copy]
  );
  const changeSummary = useMemo(
    () =>
      buildChangeSummary({
        copy,
        documentTitle: selectedDocument?.title ?? copy.noDocument,
        kindLabel: changeOptions.kinds.find((option) => option.value === changeKind)?.label ?? copy.changeKindContent,
        impactLabel: changeOptions.impacts.find((option) => option.value === changeImpact)?.label ?? copy.changeImpactReview,
        nextStepLabel: changeOptions.nextSteps.find((option) => option.value === nextStep)?.label ?? copy.nextStepOwner
      }),
    [changeImpact, changeKind, changeOptions, copy, nextStep, selectedDocument?.title]
  );

  const prepareUploadSession = useCallback(
    async (documentId: string, file: File, hash: string) => {
      setUploadPreflight(null);
      setUploadPhase("preflight");
      setError(null);

      const response = await fetch(withAppBasePath("/api/controlled-document/upload/preflight"), {
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
  const guidedSteps = [
    {
      label: copy.stepSelectFile,
      detail: copy.stepSelectFileDetail,
      done: Boolean(filePreflight?.hash && uploadPreflight),
      active: uploadPhase === "idle" || uploadPhase === "preflight"
    },
    {
      label: copy.stepDescribeChange,
      detail: copy.stepDescribeChangeDetail,
      done: Boolean(uploadPreflight),
      active: uploadPhase === "ready"
    },
    {
      label: copy.stepUpload,
      detail: copy.stepUploadDetail,
      done: Boolean(submitted),
      active: uploadPhase === "uploading" || uploadPhase === "stored"
    }
  ];

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
            const workflowResponse = await fetch(withAppBasePath("/api/controlled-document/ingestion"), {
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
            <FieldLabelWithHelp htmlFor="source-file" label={copy.file} helpLabel={copy.fileHelpLabel} helpText={copy.fileHelp} />
            <div className="file-drop">
              <UploadCloud size={20} aria-hidden="true" />
              <input
                id="source-file"
                type="file"
                accept={SUPPORTED_UPLOAD_ACCEPT}
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
                    const hash = await sha256File(file);
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

          <StratosSelect
            id="document"
            label={copy.document}
            labelAccessory={<HelpHint label={copy.documentHelpLabel} text={copy.documentHelp} />}
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
          </StratosSelect>
          <div className="form-grid form-grid--three">
            <StratosSelect
              id="version-increment"
              label={copy.versionIncrement}
              labelAccessory={<HelpHint label={copy.versionIncrementHelpLabel} text={copy.versionIncrementHelp} />}
              value={versionIncrement}
              onChange={(event) => setVersionIncrement(event.target.value as VersionIncrement)}
            >
              {changeOptions.versionIncrements.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </StratosSelect>
            <div className="field">
              <label htmlFor="version">{copy.versionNextLabel}</label>
              <input id="version" name="version_label" value={computedVersionLabel} readOnly />
              <small>
                {copy.versionBaseLabel}: {currentVersionLabel ?? copy.noPreviousVersion}. {copy.versionIncrementHint}
              </small>
            </div>
            <div className="field">
              <FieldLabelWithHelp htmlFor="valid-from" label={copy.validFrom} helpLabel={copy.validFromHelpLabel} helpText={copy.validFromHelp} />
              <input id="valid-from" name="valid_from" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
          </div>
          <div className="field">
            <FieldLabelWithHelp htmlFor="source-uri" label={copy.sourceFileUri} helpLabel={copy.sourceFileUriHelpLabel} helpText={copy.sourceFileUriHint} />
            <input id="source-uri" name="source_file_uri" value={sourceUri} readOnly />
            <small>{copy.sourceFileUriHint}</small>
          </div>
          <div className="form-grid form-grid--two">
            <StratosSelect
              id="parser"
              name="parser_profile"
              label={copy.parserProfile}
              labelAccessory={<HelpHint label={copy.parserHelpLabel} text={copy.parserHelp} />}
              defaultValue="controlled_document"
            >
              <option value="controlled_document">{copy.parserControlled}</option>
              <option value="plain_text">{copy.parserPlain}</option>
              <option value="ocr_heavy">{copy.parserOcr}</option>
            </StratosSelect>
            <StratosSelect
              id="chunking"
              name="chunking_strategy"
              label={copy.chunkingStrategy}
              labelAccessory={<HelpHint label={copy.chunkingHelpLabel} text={copy.chunkingHelp} />}
              defaultValue="legal_structured"
            >
              <option value="legal_structured">{copy.chunkLegal}</option>
              <option value="semantic">{copy.chunkSemantic}</option>
              <option value="fixed_window">{copy.chunkFixed}</option>
            </StratosSelect>
          </div>
          <div className="guided-change">
            <div>
              <div className="stratos-field-label-row">
                <strong>{copy.changeSummary}</strong>
                <HelpHint label={copy.changeSummaryHelpLabel} text={copy.changeSummaryHelp} />
              </div>
              <p>{copy.changeGuidance}</p>
            </div>
            <div className="form-grid form-grid--three">
              <StratosSelect
                id="change-kind"
                label={copy.changeKind}
                labelAccessory={<HelpHint label={copy.changeKindHelpLabel} text={copy.changeKindHelp} />}
                value={changeKind}
                onChange={(event) => setChangeKind(event.target.value as ChangeKind)}
              >
                {changeOptions.kinds.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </StratosSelect>
              <StratosSelect
                id="change-impact"
                label={copy.changeImpact}
                labelAccessory={<HelpHint label={copy.changeImpactHelpLabel} text={copy.changeImpactHelp} />}
                value={changeImpact}
                onChange={(event) => setChangeImpact(event.target.value as ChangeImpact)}
              >
                {changeOptions.impacts.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </StratosSelect>
              <StratosSelect
                id="next-step"
                label={copy.nextStep}
                labelAccessory={<HelpHint label={copy.nextStepHelpLabel} text={copy.nextStepHelp} />}
                value={nextStep}
                onChange={(event) => setNextStep(event.target.value as NextStep)}
              >
                {changeOptions.nextSteps.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </StratosSelect>
            </div>
            <div className="summary-preview">
              <span>{copy.summaryPreview}</span>
              <strong>{changeSummary}</strong>
            </div>
            <input type="hidden" name="change_summary" value={changeSummary} />
          </div>
          <input type="hidden" name="embedding_profile" value="default" />
          <StratosButton tone="primary" type="submit" disabled={!canSubmit}>
            <Play size={16} aria-hidden="true" />
            {submitting ? copy.queueing : copy.submit}
          </StratosButton>
          {error ? <p className="notice">{error}</p> : null}
        </div>
      </form>

      <aside className="panel">
        <div className="panel__header">
          <h2>{copy.validationPreview}</h2>
          {submitted ? <StatusBadge value={submitted.job.status} /> : <StatusBadge value={uploadPhase === "ready" || uploadPhase === "stored" ? "valid" : uploadPhase === "preflight" ? "running" : "draft"} />}
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

interface ParsedVersionLabel {
  label: string;
  major: number;
  minor: number;
  patch: number | null;
}

function latestVersionLabel(versions: DocumentVersion[]): string | null {
  return latestParsedVersion(versions)?.label ?? null;
}

function nextVersionLabelFor(versions: DocumentVersion[], increment: VersionIncrement): string {
  const current = latestParsedVersion(versions);
  if (!current) {
    return "1.0";
  }
  if (increment === "major") {
    return `${current.major + 1}.0`;
  }
  if (increment === "fix") {
    return `${current.major}.${current.minor}.${(current.patch ?? 0) + 1}`;
  }
  return `${current.major}.${current.minor + 1}`;
}

function latestParsedVersion(versions: DocumentVersion[]): ParsedVersionLabel | null {
  const parsedVersions = versions
    .map((version) => parseVersionLabel(version.version_label))
    .filter((version): version is ParsedVersionLabel => Boolean(version));
  if (parsedVersions.length === 0) {
    return null;
  }
  parsedVersions.sort(compareVersionLabels);
  return parsedVersions[parsedVersions.length - 1] ?? null;
}

function parseVersionLabel(label: string): ParsedVersionLabel | null {
  const match = label.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/i);
  if (!match) {
    return null;
  }
  return {
    label,
    major: Number(match[1]),
    minor: Number(match[2] ?? "0"),
    patch: match[3] ? Number(match[3]) : null
  };
}

function compareVersionLabels(left: ParsedVersionLabel, right: ParsedVersionLabel): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return (left.patch ?? -1) - (right.patch ?? -1);
}

function buildChangeSummary({
  copy,
  documentTitle,
  kindLabel,
  impactLabel,
  nextStepLabel
}: {
  copy: Record<string, string>;
  documentTitle: string;
  kindLabel: string;
  impactLabel: string;
  nextStepLabel: string;
}): string {
  return `${copy.summaryPrefix}: ${documentTitle}. ${copy.changeKind}: ${kindLabel}. ${copy.changeImpact}: ${impactLabel}. ${copy.nextStep}: ${nextStepLabel}.`;
}
