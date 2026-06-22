import { createHash } from "node:crypto";

import type {
  AssistantChatResponse,
  AssistantReportArtifact,
  AssistantReportRow,
  Document,
  DocumentMetadataSummary,
  DocumentMetadataSummaryBucket,
  ResponseLanguage
} from "@/lib/types";

type CellValue = string | number | boolean | null;

interface TopicQuery {
  key: string;
  labelCs: string;
  labelEn: string;
  terms: string[];
  matchAll?: boolean;
}

interface RegistryReportBuildInput {
  message: string;
  conversationId?: string | null;
  context?: Record<string, unknown>;
  language?: ResponseLanguage;
  documents: Document[];
}

interface RegistrySummaryReportBuildInput {
  message: string;
  conversationId?: string | null;
  context?: Record<string, unknown>;
  language?: ResponseLanguage;
  summary: DocumentMetadataSummary;
}

export interface RegistryReportAuditSummary {
  artifactId: string;
  documentCount: number;
  messageHash: string;
  scannedDocumentCount: number;
  topicCount: number;
  warningCount: number;
}

export const REGISTRY_DOCUMENT_SCAN_WARNING_THRESHOLD = 20_000;

const INVENTORY_INTENT_WORDS = [
  "kolik",
  "pocet",
  "pocitej",
  "spocitej",
  "seznam",
  "prehled",
  "inventar",
  "evidence",
  "statistik"
];

const STRUCTURED_OUTPUT_WORDS = [
  "tabulk",
  "excel",
  "xlsx",
  "pdf",
  "sestav",
  "report"
];

const INVENTORY_SUBJECT_WORDS = [
  "dokument",
  "soubor",
  "registr",
  "evidence",
  "tema",
  "temat",
  "oblast"
];

const DOCUMENT_OR_DOMAIN_WORDS = [
  "dokument",
  "soubor",
  "digitalizac",
  "rizeni",
  "projekt",
  "finance",
  "rozpocet",
  "smlouv",
  "smluv",
  "contract",
  "predpis",
  "smernic",
  "zakon",
  "vyhlask",
  "narizen",
  "audit",
  "bezpecnost",
  "it",
  "ict",
  "governance"
];

const COMMAND_STOP_WORDS = [
  "vytvor",
  "vytvorte",
  "udelej",
  "udelejte",
  "zpracuj",
  "zpracujte",
  "exportuj",
  "exportujte",
  "do tabulky",
  "tabulku",
  "excel",
  "xlsx",
  "pdf",
  "sestav",
  "report",
  "prehled",
  "prosim"
];

const TOPIC_CATALOG: TopicQuery[] = [
  {
    key: "digitalizace",
    labelCs: "digitalizace",
    labelEn: "digitization",
    terms: [
      "digitalizace",
      "digitalni",
      "digitální",
      "e-government",
      "egovernment",
      "digital governance",
      "dia",
      "ict"
    ]
  },
  {
    key: "rizeni-projektu",
    labelCs: "řízení projektů",
    labelEn: "project management",
    terms: [
      "rizeni projektu",
      "řízení projektů",
      "projektove rizeni",
      "projektové řízení",
      "project management",
      "projectflow",
      "projekt"
    ]
  },
  {
    key: "finance",
    labelCs: "finance",
    labelEn: "finance",
    terms: ["finance", "financni", "finanční", "rozpocet", "rozpočet", "budget", "cashflow", "platba", "payment", "faktura"]
  },
  {
    key: "smlouvy",
    labelCs: "smlouvy",
    labelEn: "contracts",
    terms: ["smlouva", "smlouvy", "smluv", "smluvni", "smluvní", "contract", "dodatek", "plneni", "plnění"]
  },
  {
    key: "vnitrni-predpisy",
    labelCs: "vnitřní předpisy",
    labelEn: "internal regulations",
    terms: ["vnitrni predpis", "vnitřní předpis", "predpis", "předpis", "smernice", "směrnice", "policy", "procedure"]
  },
  {
    key: "zakony-a-vyhlasky",
    labelCs: "zákony a vyhlášky",
    labelEn: "laws and decrees",
    terms: ["zakon", "zákon", "zakony", "zákony", "vyhlaska", "vyhláška", "narizeni", "nařízení", "sbirka", "sbírka"]
  }
];

const DOCUMENT_TYPE_LABELS_CS: Record<Document["document_type"], string> = {
  directive: "směrnice",
  regulation: "regulace",
  methodology: "metodika",
  policy: "politika",
  procedure: "postup",
  manual: "manuál",
  knowledge_base_article: "znalostní článek",
  project_documentation: "projektová dokumentace",
  meeting_record: "záznam z jednání",
  contract: "smlouva",
  attachment: "příloha",
  other: "ostatní"
};

const DOCUMENT_TYPE_LABELS_EN: Record<Document["document_type"], string> = {
  directive: "directive",
  regulation: "regulation",
  methodology: "methodology",
  policy: "policy",
  procedure: "procedure",
  manual: "manual",
  knowledge_base_article: "knowledge base article",
  project_documentation: "project documentation",
  meeting_record: "meeting record",
  contract: "contract",
  attachment: "attachment",
  other: "other"
};

export function isRegistryDocumentReportQuestion(message: string): boolean {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  const hasInventoryIntent = INVENTORY_INTENT_WORDS.some((word) => normalized.includes(word));
  const hasStructuredOutputIntent = STRUCTURED_OUTPUT_WORDS.some((word) => normalized.includes(word));
  const hasInventorySubject = INVENTORY_SUBJECT_WORDS.some((word) => normalized.includes(word));
  const hasDocumentOrDomain = DOCUMENT_OR_DOMAIN_WORDS.some((word) => normalized.includes(word));
  return hasDocumentOrDomain && (hasInventoryIntent || (hasStructuredOutputIntent && hasInventorySubject));
}

export function extractRegistryDocumentTopics(message: string, language: ResponseLanguage = "cs"): string[] {
  return extractTopics(message).map((topic) => language === "en" ? topic.labelEn : topic.labelCs);
}

export function buildRegistryDocumentReportFromSummary(
  input: RegistrySummaryReportBuildInput
): AssistantChatResponse | null {
  if (!isRegistryDocumentReportQuestion(input.message)) {
    return null;
  }

  const language = input.language ?? "cs";
  const artifact = buildArtifactFromSummary({
    language,
    summary: input.summary
  });
  const warnings = [...artifact.warnings];
  const topicLabels = artifact.rows.map((row) => String(row.cells.topic ?? ""));
  const conversationId = input.conversationId ?? `conv_registry_${hashText(input.message).slice(0, 16)}`;

  return buildRegistryResponse({
    language,
    conversationId,
    context: input.context,
    artifact,
    scannedDocumentCount: input.summary.total_visible_documents,
    totalMatched: input.summary.total_matched_documents,
    topicLabels,
    warnings,
    reportSource: "registry_metadata_summary"
  });
}

export function buildRegistryDocumentReport(input: RegistryReportBuildInput): AssistantChatResponse | null {
  if (!isRegistryDocumentReportQuestion(input.message)) {
    return null;
  }

  const language = input.language ?? "cs";
  const topics = extractTopics(input.message);
  const artifact = buildArtifact({
    language,
    documents: input.documents,
    topics
  });
  const warnings = [...artifact.warnings];
  const topicLabels = artifact.rows.map((row) => String(row.cells.topic ?? ""));
  const totalMatched = uniqueMatchedDocumentCount(input.documents, topics);
  const conversationId = input.conversationId ?? `conv_registry_${hashText(input.message).slice(0, 16)}`;

  return buildRegistryResponse({
    language,
    conversationId,
    context: input.context,
    artifact,
    scannedDocumentCount: input.documents.length,
    totalMatched,
    topicLabels,
    warnings,
    reportSource: "registry_metadata"
  });
}

function buildRegistryResponse(input: {
  language: ResponseLanguage;
  conversationId: string;
  context?: Record<string, unknown>;
  artifact: AssistantReportArtifact;
  scannedDocumentCount: number;
  totalMatched: number;
  topicLabels: string[];
  warnings: string[];
  reportSource: "registry_metadata" | "registry_metadata_summary";
}): AssistantChatResponse {
  return {
    response_type: "answer",
    conversation_id: input.conversationId,
    answer: buildAnswer({
      language: input.language,
      scannedDocumentCount: input.scannedDocumentCount,
      totalMatched: input.totalMatched,
      topicLabels: input.topicLabels,
      warnings: input.warnings
    }),
    message: null,
    questions: [],
    why_needed: null,
    current_context: {
      ...(input.context ?? {}),
      answer_source: input.reportSource,
      report_kind: "document_inventory",
      registry_report_matched_document_count: input.totalMatched,
      registry_report_scanned_document_count: input.scannedDocumentCount,
      topics: input.topicLabels
    },
    citations: [],
    follow_up_questions: input.language === "en"
      ? [
          "Do you want a breakdown by document type, classification, or owner?",
          "Should I narrow this to valid documents only?"
        ]
      : [
          "Chcete rozpad podle typu dokumentu, klasifikace nebo vlastníka?",
          "Mám výsledek zúžit jen na platné dokumenty?"
        ],
    suggested_actions: [
      {
        label: input.language === "en" ? "Export report" : "Exportovat sestavu",
        action_type: "export_report",
        target: input.artifact.artifact_id
      }
    ],
    report_artifacts: [input.artifact],
    confidence: input.warnings.includes("REGISTRY_SCAN_LIMIT_REACHED") ? "medium" : "high",
    warnings: input.warnings,
    missing_information: null,
    recommended_action: null
  };
}

export function summarizeRegistryReportForAudit(
  response: AssistantChatResponse,
  message: string,
  scannedDocumentCount: number
): RegistryReportAuditSummary | null {
  const artifact = response.report_artifacts[0];
  if (!artifact) return null;
  const documentCount =
    typeof response.current_context.registry_report_matched_document_count === "number"
      ? response.current_context.registry_report_matched_document_count
      : artifact.rows.reduce((sum, row) => {
          const value = row.cells.document_count;
          return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
        }, 0);
  return {
    artifactId: artifact.artifact_id,
    documentCount,
    messageHash: hashText(message),
    scannedDocumentCount,
    topicCount: artifact.rows.length,
    warningCount: response.warnings.length
  };
}

function buildArtifact(input: {
  language: ResponseLanguage;
  documents: Document[];
  topics: TopicQuery[];
}): AssistantReportArtifact {
  const title = input.language === "en" ? "Document Inventory by Topic" : "Inventura dokumentů podle témat";
  const rows = input.topics.map((topic, index) => buildTopicRow(topic, input.documents, input.language, index));
  const warnings = ["REGISTRY_METADATA_REPORT"];
  if (input.documents.length >= REGISTRY_DOCUMENT_SCAN_WARNING_THRESHOLD) {
    warnings.push("REGISTRY_SCAN_LIMIT_REACHED");
  }

  return {
    artifact_id: `rpt_registry_${hashText(`${title}:${input.topics.map((topic) => topic.key).join(",")}`).slice(0, 16)}`,
    title,
    description: input.language === "en"
      ? "Permission-scoped metadata report generated from the AKB document registry. Content interpretation still requires cited RAG answers."
      : "Metadatová sestava podle oprávnění aktuálního uživatele z registru dokumentů AKB. Výklad obsahu dokumentů dál vyžaduje RAG odpověď s citacemi.",
    columns: [
      { key: "topic", label: input.language === "en" ? "Topic" : "Téma", type: "text" },
      { key: "document_count", label: input.language === "en" ? "Documents" : "Dokumentů", type: "number" },
      { key: "valid_or_approved_count", label: input.language === "en" ? "Valid / approved" : "Platné / schválené", type: "number" },
      { key: "document_types", label: input.language === "en" ? "Document types" : "Typy dokumentů", type: "text" },
      { key: "classifications", label: input.language === "en" ? "Classifications" : "Klasifikace", type: "text" },
      { key: "statuses", label: input.language === "en" ? "Statuses" : "Stavy", type: "text" },
      { key: "owners", label: input.language === "en" ? "Owners / stewards" : "Vlastníci / gestoři", type: "text" },
      { key: "example_documents", label: input.language === "en" ? "Examples" : "Příklady dokumentů", type: "text" }
    ],
    rows,
    export_formats: ["xlsx", "pdf"],
    source_citation_count: 0,
    warnings
  };
}

function buildArtifactFromSummary(input: {
  language: ResponseLanguage;
  summary: DocumentMetadataSummary;
}): AssistantReportArtifact {
  const title = input.language === "en" ? "Document Inventory by Topic" : "Inventura dokumentů podle témat";
  const rows = input.summary.topics.map((topic, index) => summaryTopicRow(topic, input.language, index));
  const warnings = ["REGISTRY_METADATA_REPORT", ...input.summary.warnings];

  return {
    artifact_id: `rpt_registry_${hashText(`${title}:${input.summary.topics.map((topic) => topic.topic).join(",")}`).slice(0, 16)}`,
    title,
    description: input.language === "en"
      ? "Permission-scoped metadata report generated from the AKB document registry summary endpoint. Content interpretation still requires cited RAG answers."
      : "Metadatová sestava podle oprávnění aktuálního uživatele ze summary endpointu registru dokumentů AKB. Výklad obsahu dokumentů dál vyžaduje RAG odpověď s citacemi.",
    columns: reportColumns(input.language),
    rows,
    export_formats: ["xlsx", "pdf"],
    source_citation_count: 0,
    warnings
  };
}

function reportColumns(language: ResponseLanguage): AssistantReportArtifact["columns"] {
  return [
    { key: "topic", label: language === "en" ? "Topic" : "Téma", type: "text" },
    { key: "document_count", label: language === "en" ? "Documents" : "Dokumentů", type: "number" },
    { key: "valid_or_approved_count", label: language === "en" ? "Valid / approved" : "Platné / schválené", type: "number" },
    { key: "document_types", label: language === "en" ? "Document types" : "Typy dokumentů", type: "text" },
    { key: "classifications", label: language === "en" ? "Classifications" : "Klasifikace", type: "text" },
    { key: "statuses", label: language === "en" ? "Statuses" : "Stavy", type: "text" },
    { key: "owners", label: language === "en" ? "Owners / stewards" : "Vlastníci / gestoři", type: "text" },
    { key: "example_documents", label: language === "en" ? "Examples" : "Příklady dokumentů", type: "text" }
  ];
}

function summaryTopicRow(
  topic: DocumentMetadataSummary["topics"][number],
  language: ResponseLanguage,
  index: number
): AssistantReportRow {
  return {
    row_id: `topic_${index + 1}_${slugify(topic.topic) || "summary"}`,
    cells: {
      topic: topic.topic,
      document_count: topic.document_count,
      valid_or_approved_count: topic.valid_or_approved_count,
      document_types: formatSummaryBuckets(
        topic.document_types,
        language === "en" ? DOCUMENT_TYPE_LABELS_EN : DOCUMENT_TYPE_LABELS_CS
      ),
      classifications: formatSummaryBuckets(topic.classifications),
      statuses: formatSummaryBuckets(topic.statuses),
      owners: formatSummaryBuckets(topic.owners),
      example_documents: topic.example_documents.join("; ")
    },
    citations: []
  };
}

function buildTopicRow(
  topic: TopicQuery,
  documents: Document[],
  language: ResponseLanguage,
  index: number
): AssistantReportRow {
  const matched = documents.filter((document) => documentMatchesTopic(document, topic));
  const cells: Record<string, CellValue> = {
    topic: language === "en" ? topic.labelEn : topic.labelCs,
    document_count: matched.length,
    valid_or_approved_count: matched.filter((document) => document.status === "valid" || document.status === "approved").length,
    document_types: summarizeCounts(
      matched.map((document) => document.document_type),
      language === "en" ? DOCUMENT_TYPE_LABELS_EN : DOCUMENT_TYPE_LABELS_CS
    ),
    classifications: summarizeCounts(matched.map((document) => document.classification)),
    statuses: summarizeCounts(matched.map((document) => document.status)),
    owners: summarizeCounts(matched.map((document) => document.gestor_unit ?? document.owner ?? document.owner_id)),
    example_documents: matched.slice(0, 5).map((document) => document.title).join("; ")
  };
  return {
    row_id: `topic_${index + 1}_${topic.key}`,
    cells,
    citations: []
  };
}

function formatSummaryBuckets(
  buckets: DocumentMetadataSummaryBucket[],
  labels?: Partial<Record<string, string>>
) {
  return buckets
    .slice(0, 6)
    .map((bucket) => `${labels?.[bucket.key] ?? bucket.label ?? bucket.key}: ${bucket.count}`)
    .join("; ");
}

function buildAnswer(input: {
  language: ResponseLanguage;
  scannedDocumentCount: number;
  totalMatched: number;
  topicLabels: string[];
  warnings: string[];
}) {
  const topics = input.topicLabels.join(", ");
  if (input.language === "en") {
    const capWarning = input.warnings.includes("REGISTRY_SCAN_LIMIT_REACHED")
      ? " The registry scan reached the current web paging ceiling, so this should be moved to a server-side aggregate endpoint for exact enterprise-wide totals."
      : "";
    return `I checked ${input.scannedDocumentCount} permission-visible AKB registry records and found ${input.totalMatched} matching documents for: ${topics}. The table below is a metadata inventory, not a cited interpretation of document content.${capWarning}`;
  }
  const capWarning = input.warnings.includes("REGISTRY_SCAN_LIMIT_REACHED")
    ? " Načtení dosáhlo aktuálního stránkovacího stropu web vrstvy, takže pro přesné celopodnikové součty je vhodné doplnit serverovou agregační službu."
    : "";
  return `Zkontroloval jsem ${input.scannedDocumentCount} dokumentů viditelných podle oprávnění aktuálního uživatele a našel ${input.totalMatched} odpovídajících dokumentů pro témata: ${topics}. Tabulka níže je metadatová inventura, ne citovaný výklad obsahu dokumentů.${capWarning}`;
}

function uniqueMatchedDocumentCount(documents: Document[], topics: TopicQuery[]) {
  const matchedIds = new Set<string>();
  for (const topic of topics) {
    for (const document of documents) {
      if (documentMatchesTopic(document, topic)) {
        matchedIds.add(document.document_id);
      }
    }
  }
  return matchedIds.size;
}

function documentMatchesTopic(document: Document, topic: TopicQuery): boolean {
  if (topic.matchAll) {
    return true;
  }
  const haystack = documentSearchText(document);
  const normalizedTerms = topic.terms.map(normalizeText).filter(Boolean);
  if (normalizedTerms.some((term) => haystack.includes(term))) {
    return true;
  }
  const tokens = tokenize(topic.labelCs);
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}

function documentSearchText(document: Document): string {
  const parts: string[] = [
    document.document_id,
    document.title,
    document.document_type,
    document.status,
    document.classification,
    document.owner_id,
    document.owner,
    document.gestor_unit ?? "",
    ...document.tags,
    ...metadataValues(document.metadata)
  ];
  for (const assignment of document.assignments ?? []) {
    parts.push(assignment.role, assignment.subject_type, assignment.subject_id, assignment.display_label ?? "");
    parts.push(...metadataValues(assignment.metadata));
  }
  return normalizeText(parts.join(" "));
}

function metadataValues(metadata: Record<string, unknown> | undefined): string[] {
  if (!metadata) return [];
  return Object.entries(metadata).flatMap(([key, value]) => {
    if (value === null || value === undefined) return [key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return [key, String(value)];
    }
    if (Array.isArray(value)) {
      return [key, ...value.filter((item) => ["string", "number", "boolean"].includes(typeof item)).map(String)];
    }
    return [key];
  });
}

function extractTopics(message: string): TopicQuery[] {
  const normalized = normalizeText(message);
  const topics = new Map<string, TopicQuery>();
  for (const topic of TOPIC_CATALOG) {
    const aliases = [topic.labelCs, topic.labelEn, ...topic.terms].map(normalizeText);
    if (aliases.some((alias) => alias && normalized.includes(alias))) {
      topics.set(topic.key, topic);
    }
  }

  for (const explicitTopic of explicitTopicPhrases(normalized)) {
    const catalogTopic = TOPIC_CATALOG.find((topic) => {
      const aliases = [topic.labelCs, topic.labelEn, ...topic.terms].map(normalizeText);
      return aliases.some((alias) => alias && (explicitTopic.includes(alias) || alias.includes(explicitTopic)));
    });
    if (catalogTopic) {
      topics.set(catalogTopic.key, catalogTopic);
      continue;
    }
    const key = slugify(explicitTopic);
    if (key && !topics.has(key)) {
      topics.set(key, {
        key,
        labelCs: explicitTopic,
        labelEn: explicitTopic,
        terms: [explicitTopic, ...tokenize(explicitTopic)]
      });
    }
  }

  if (topics.size === 0) {
    topics.set("vsechny-dokumenty", {
      key: "vsechny-dokumenty",
      labelCs: "všechny dokumenty",
      labelEn: "all documents",
      terms: [],
      matchAll: true
    });
  }

  return [...topics.values()].slice(0, 8);
}

function explicitTopicPhrases(normalizedMessage: string): string[] {
  const match = normalizedMessage.match(/\b(?:na\s+)?(?:tema|temata|oblast|oblasti|topic|topics)\b(?<tail>.+)$/);
  if (!match?.groups?.tail) return [];
  const stopPattern = new RegExp(`\\b(?:${COMMAND_STOP_WORDS.map(escapeRegex).join("|")})\\b`);
  const tail = match.groups.tail.split(stopPattern)[0] ?? "";
  return tail
    .split(/[,;/]|\s+(?:a|and)\s+/)
    .map((item) => item.replace(/\b(?:na|k|o|ohledne|pro)\b/g, " ").trim())
    .map((item) => item.replace(/\s+/g, " "))
    .filter((item) => item.length >= 3 && tokenize(item).length > 0);
}

function summarizeCounts<T extends string>(values: T[], labels?: Partial<Record<T, string>>) {
  if (values.length === 0) return "";
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "cs"))
    .slice(0, 6)
    .map(([value, count]) => `${labels?.[value] ?? value}: ${count}`)
    .join("; ");
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9&._/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
