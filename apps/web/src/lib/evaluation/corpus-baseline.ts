import type {
  ApiRequestContext,
  Document,
  EvaluationDatasetCreate,
  EvaluationRole
} from "@/lib/types";

const SUPPORTED_EVALUATION_DOCUMENT_TYPES = new Set([
  "directive",
  "regulation",
  "methodology",
  "policy",
  "procedure",
  "manual",
  "knowledge_base_article",
  "project_documentation",
  "meeting_record",
  "contract",
  "attachment",
  "other"
]);

export function buildCorpusBaselineDataset(
  documents: Document[],
  context: Pick<ApiRequestContext, "subjectId" | "roles">,
  options: { limit?: number; now?: Date } = {}
): EvaluationDatasetCreate {
  const selected = representativeDocuments(documents, options.limit ?? 32);
  const now = options.now ?? new Date();
  const dateLabel = new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Prague"
  }).format(now);
  const role = evaluationRole(context.roles ?? []);

  return {
    name: `Startovní baseline korpusu ${dateLabel}`,
    description:
      "Silver baseline ověřující, zda AKB dohledá skutečné dokumenty podle jejich evidovaných názvů. Slouží jako startovní diagnostika; odborně posouzené dotazy se povyšují na gold.",
    tags: ["corpus-baseline", "silver", "exact-title", "retrieval-only"],
    visibility: "private",
    metadata: {
      source: "registry-visible-documents",
      generated_at: now.toISOString(),
      generation_method: "exact-title-silver-baseline",
      document_count: selected.length
    },
    cases: selected.map((document, index) => ({
      case_id: `title_${String(index + 1).padStart(3, "0")}`,
      subject_id: context.subjectId,
      query: document.title.slice(0, 4000),
      filters: {
        document_types: evaluationDocumentTypes(document.document_type),
        only_valid: false,
        classification_max: document.classification,
        tags: []
      },
      answer_mode: "retrieve_only",
      max_chunks: 10,
      expected_answer_terms: [],
      forbidden_answer_terms: [],
      expected_citations: [],
      expected_relevant_chunk_ids: [],
      expected_relevant_document_ids: [document.document_id],
      relevance_judgments: [],
      expected_forbidden_chunk_ids: [],
      expected_no_answer: false,
      role,
      query_category: "exact_title",
      judgment_status: "silver",
      weight: 1,
      metadata: {
        source: "registry-title",
        document_id: document.document_id,
        document_status: document.status,
        document_classification: document.classification
      }
    }))
  };
}

export function representativeDocuments(documents: Document[], limit: number): Document[] {
  const unique = new Map<string, Document>();
  for (const document of documents) {
    if (document.document_id && document.title.trim()) {
      unique.set(document.document_id, document);
    }
  }
  const groups = new Map<string, Document[]>();
  for (const document of unique.values()) {
    const group = groups.get(document.document_type) ?? [];
    group.push(document);
    groups.set(document.document_type, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => {
      const statusDifference = statusPriority(left.status) - statusPriority(right.status);
      return statusDifference || left.title.localeCompare(right.title, "cs");
    });
  }

  const selected: Document[] = [];
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  let cursor = 0;
  while (selected.length < limit && orderedGroups.some(([, group]) => cursor < group.length)) {
    for (const [, group] of orderedGroups) {
      const document = group[cursor];
      if (document && selected.length < limit) selected.push(document);
    }
    cursor += 1;
  }
  return selected;
}

function evaluationDocumentTypes(documentType: string): string[] {
  return SUPPORTED_EVALUATION_DOCUMENT_TYPES.has(documentType) ? [documentType] : [];
}

function evaluationRole(roles: string[]): EvaluationRole {
  const normalized = new Set(roles);
  if (["admin", "akl_admin", "akb_admin", "stratos_admin", "stratos_superadmin"].some((role) => normalized.has(role))) {
    return "administrator";
  }
  if (["auditor", "akl_auditor"].some((role) => normalized.has(role))) return "auditor";
  if (["analyst", "akl_analyst"].some((role) => normalized.has(role))) return "analyst";
  if (["document_manager", "akl_document_manager"].some((role) => normalized.has(role))) {
    return "document_manager";
  }
  return "employee";
}

function statusPriority(status: Document["status"]): number {
  if (status === "valid") return 0;
  if (status === "approved") return 1;
  if (status === "review") return 2;
  if (status === "draft") return 3;
  return 4;
}
