import type { WorkflowTask, WorkflowTaskKind } from "./workflow-task-model";

type Language = "cs" | "en";
type Translation = [cs: string, en: string];

const titles: Record<string, Translation> = {
  "Document review required": ["Dokument čeká na věcnou kontrolu", "Document review required"],
  "Draft needs completion": ["Koncept je potřeba dokončit", "Draft needs completion"],
  "Governance check before publication": ["Před zveřejněním je nutná kontrola pravidel", "Governance check before publication"],
  "Audit event needs review": ["Auditní upozornění čeká na posouzení", "Audit event needs review"],
  "Document processing failed": ["Zpracování dokumentu selhalo", "Document processing failed"],
  "Document processed with warnings": ["Dokument byl zpracován s upozorněními", "Document processed with warnings"],
  "Document processing in progress": ["Dokument se právě zpracovává", "Document processing in progress"],
  "Document changes requested": ["Dokument byl vrácen k úpravě", "Document changes requested"],
};

const descriptions: Record<string, Translation> = {
  "Review the exact submitted version before approval.": [
    "K rozhodnutí je předána uvedená verze dokumentu.",
    "The listed document version is awaiting a decision.",
  ],
  "Review feedback before submitting a new review.": [
    "Dokument čeká na zapracování připomínek a nové předání ke schválení.",
    "The document is awaiting changes and resubmission for review.",
  ],
  "Review metadata, source context, access classification and publication readiness.": [
    "Ověřte údaje dokumentu, původ zdroje, přístupovou klasifikaci a připravenost ke zveřejnění.",
    "Review metadata, source context, access classification and publication readiness.",
  ],
  "Complete source file, validity metadata and ingestion preparation before review.": [
    "Doplňte originální soubor, údaje o platnosti a podklady pro zpracování před předáním ke kontrole.",
    "Complete source file, validity metadata and ingestion preparation before review.",
  ],
  "Restricted sources require access, conflict and compliance checks before publication.": [
    "Před zveřejněním omezeného zdroje ověřte přístup, možné rozpory a soulad s pravidly.",
    "Restricted sources require access, conflict and compliance checks before publication.",
  ],
  "Review the audit signal and confirm whether a document, ingestion or access policy action is needed.": [
    "Prověřte upozornění a rozhodněte, zda je potřeba upravit dokument, zpracování nebo přístupová pravidla.",
    "Review the audit signal and confirm whether a document, ingestion or access policy action is needed.",
  ],
  "The source is not citation-ready yet and should be fixed before people rely on it.": [
    "Zdroj zatím nelze bezpečně citovat. Před dalším použitím opravte chybu zpracování.",
    "The source is not citation-ready yet and should be fixed before people rely on it.",
  ],
  "Review extraction warnings before relying on generated citations and insights.": [
    "Před použitím citací a vytěžených informací zkontrolujte upozornění ze zpracování.",
    "Review extraction warnings before relying on generated citations and insights.",
  ],
  "Wait until AKB finishes reading the file and preparing citation segments.": [
    "Vyčkejte, až AKB dokončí čtení souboru a přípravu citovatelných částí.",
    "Wait until AKB finishes reading the file and preparing citation segments.",
  ],
};

const sources: Record<string, Translation> = {
  "Document review submission": ["Předání ke schválení", "Document review submission"],
  "Document review decision": ["Rozhodnutí schvalovatele", "Document review decision"],
  "Registry document status": ["Stav dokumentu v registru", "Registry document status"],
  "Registry draft state": ["Rozpracovaný dokument", "Registry draft state"],
  "Document classification policy": ["Pravidla přístupu k dokumentu", "Document classification policy"],
  "Document processing": ["Zpracování dokumentu", "Document processing"],
  "Processing report": ["Výsledek zpracování", "Processing report"],
};

const roles: Record<string, Translation> = {
  approver: ["Schvalovatel", "Approver"],
  reviewer: ["Posuzovatel", "Reviewer"],
  gestor: ["Gestor", "Document owner"],
  owner: ["Vlastník", "Owner"],
  steward: ["Správce dokumentu", "Document steward"],
  auditor: ["Auditor", "Auditor"],
  "Owner / gestor": ["Vlastník nebo gestor", "Owner / gestor"],
  "Document manager": ["Správce dokumentu", "Document manager"],
  "Governance / auditor": ["Gestor pravidel nebo auditor", "Governance / auditor"],
  Auditor: ["Auditor", "Auditor"],
  Operations: ["Provozní správce", "Operations"],
  "Knowledge operations": ["Správce znalostní báze", "Knowledge operations"],
  "Security reviewers": ["Bezpečnostní hodnotitelé", "Security reviewers"],
  "Security owner": ["Vlastník bezpečnostní oblasti", "Security owner"],
  "Internal audit": ["Interní audit", "Internal audit"],
  "Knowledge owner": ["Vlastník znalosti", "Knowledge owner"],
  "Knowledge Ops": ["Správa znalostí", "Knowledge Ops"],
  Security: ["Bezpečnost", "Security"],
};

const actions: Record<string, Translation> = {
  "Open audit event": ["Otevřít auditní upozornění", "Open audit event"],
  "Continue draft": ["Dokončit koncept", "Continue draft"],
  "Review governance signals": ["Prověřit pravidla", "Review governance signals"],
  "Inspect processing": ["Zkontrolovat zpracování", "Inspect processing"],
  "Inspect processing error": ["Vyřešit chybu zpracování", "Inspect processing error"],
  "Review extraction warning": ["Prověřit upozornění", "Review extraction warning"],
  "Monitor processing": ["Sledovat zpracování", "Monitor processing"],
  "Open document workbench": ["Otevřít dokument", "Open document workbench"],
};

const fallbackTitles: Record<WorkflowTaskKind, Translation> = {
  review: ["Dokument čeká na kontrolu", "Document needs review"],
  draft: ["Koncept čeká na dokončení", "Draft needs completion"],
  ingestion: ["Zpracování dokumentu vyžaduje pozornost", "Document processing needs attention"],
  governance: ["Pravidla dokumentu vyžadují kontrolu", "Document governance needs review"],
  audit: ["Auditní upozornění vyžaduje kontrolu", "Audit signal needs review"],
};

export interface WorkflowTaskPresentation {
  title: string;
  description: string;
  source: string;
  owner: string;
  role: string;
  actionLabel: string;
  technicalOwner: string | null;
}

export function workflowTaskPresentation(
  task: WorkflowTask,
  language: Language,
): WorkflowTaskPresentation {
  const role = translate(task.role, roles, language);
  const technicalOwner = isTechnicalIdentifier(task.owner) ? task.owner : null;
  const owner = technicalOwner
    ? role
    : translate(task.owner, roles, language);
  return {
    title: technicalTitle(task.title)
      ? translated(fallbackTitles[task.kind], language)
      : translate(task.title, titles, language),
    description: technicalDescription(task.description)
      ? translated(genericDescription(task.kind), language)
      : translate(task.description, descriptions, language),
    source: technicalSource(task.source)
      ? translated(genericSource(task.kind), language)
      : translate(task.source, sources, language),
    owner,
    role,
    actionLabel: translate(task.action_label, actions, language),
    technicalOwner,
  };
}

function translate(
  value: string,
  dictionary: Record<string, Translation>,
  language: Language,
): string {
  return dictionary[value] ? translated(dictionary[value]!, language) : value;
}

function translated(value: Translation, language: Language): string {
  return value[language === "en" ? 1 : 0];
}

function isTechnicalIdentifier(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value)
    || /^(?:user|subject|sub|svc)[:_-]/i.test(value)
    || /^usr_[a-z0-9]+$/i.test(value);
}

function technicalTitle(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{5,}$/.test(value);
}

function technicalDescription(value: string): boolean {
  return technicalTitle(value) || /^[a-z0-9_.-]+$/i.test(value);
}

function technicalSource(value: string): boolean {
  return technicalTitle(value) || /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/i.test(value);
}

function genericDescription(kind: WorkflowTaskKind): Translation {
  if (kind === "ingestion") {
    return ["Otevřete zpracování dokumentu a prověřte uvedený problém.", "Open document processing and review the reported issue."];
  }
  return ["Otevřete související dokument a dokončete doporučený krok.", "Open the related document and complete the recommended step."];
}

function genericSource(kind: WorkflowTaskKind): Translation {
  if (kind === "audit") return ["Auditní stopa", "Audit trail"];
  if (kind === "ingestion") return ["Zpracování dokumentu", "Document processing"];
  return ["Workflow dokumentu", "Document workflow"];
}
