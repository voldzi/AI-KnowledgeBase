"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  FileSearch,
  Network,
  Search,
  ShieldCheck,
  Tags,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import {
  StratosButtonLink,
  StratosDataTable,
  StratosSearchBox,
  StratosSelect,
  type StratosDataTableColumn,
} from "@/components/stratos";
import { documentTypeLabel, formatDateTime, formatNumber } from "@/lib/format";
import { withAppBasePath } from "@/lib/app-url";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type {
  AnalystSearchField,
  AnalystSearchMode,
  AnalystSearchResponse,
  AnalystCase,
  AnalystEvidenceItem,
  Classification,
  Document,
  DocumentMetadataSummary,
  DocumentMetadataSummaryBucket,
  DocumentReadinessIssue,
  DocumentReadinessReport,
  DocumentStatus,
  DocumentType,
  EntityFacetReport,
  EntityRelationshipEdge,
  EntityRelationshipResponse,
  EntitySearchHit,
  EntitySearchResponse,
  QueryComposerPlan,
  QueryComposerPreview,
  QueryComposerRecoveryAction,
  QueryComposerTokenInput,
  QueryComposerValidationIssue,
  QuerySuggestionResponse,
} from "@/lib/types";

interface IntelligenceWorkbenchProps {
  documents: Document[];
  summary: DocumentMetadataSummary;
  readiness: DocumentReadinessReport;
  entityFacets: EntityFacetReport;
  analystCases: AnalystCase[];
  generatedAtIso: string;
}

interface CandidateSignal {
  id: string;
  type: "document_number" | "owner" | "tag" | "external_system";
  label: string;
  count: number;
}

type IntelligenceSectionId =
  | "overview"
  | "corpus"
  | "search"
  | "cases"
  | "entities"
  | "relationships"
  | "quality";

const INTELLIGENCE_SECTION_IDS: readonly IntelligenceSectionId[] = [
  "overview",
  "corpus",
  "search",
  "cases",
  "entities",
  "relationships",
  "quality",
];

interface IntelligenceSectionNavItem {
  id: IntelligenceSectionId;
  label: string;
  value: string;
  icon: LucideIcon;
}

type QueryTokenType = "term" | "phrase" | "field" | "entity" | "operator" | "saved_query";

interface QueryComposerToken {
  id: string;
  type: QueryTokenType;
  label: string;
  value: string;
  queryFragment: string;
  entityType?: string;
  entityValue?: string;
  mode?: AnalystSearchMode;
  field?: AnalystSearchField;
}

interface QuerySuggestion {
  id: string;
  type: QueryTokenType;
  group: string;
  label: string;
  detail: string;
  value: string;
  queryFragment: string;
  entityType?: string;
  entityValue?: string;
  mode?: AnalystSearchMode;
  field?: AnalystSearchField;
}

const ANALYST_FIELD_ALIASES: Record<Exclude<AnalystSearchField, "all">, string> = {
  title: "title",
  body: "body",
  section: "section",
  entity: "entity",
  source: "source",
};

const workbenchCopy = {
  cs: {
    metricsLabel: "Metriky Intelligence Workbench",
    sectionNavigation: "Navigace Intelligence",
    sectionOverview: "Přehled",
    sectionCorpus: "Korpus",
    sectionSearch: "Hledání",
    sectionCases: "Spisy",
    sectionEntities: "Entity",
    sectionRelationships: "Vazby",
    sectionQuality: "Připravenost",
    corpusExplorer: "Korpus dokumentů",
    corpus: "Korpus",
    corpusDetail: "oprávněných dokumentů",
    readiness: "Připravenost",
    readinessDetail: "ready skóre",
    review: "K revizi",
    reviewDetail: "metadata nebo kvalita",
    blocked: "Blokováno",
    blockedDetail: "kritické signály",
    analystSearch: "Analytické hledání",
    advancedAnalystSearch: "Inteligentní hledání",
    advancedAnalystDetail: "Hledání nad oprávněným obsahem dokumentů s dohledatelnými zdroji.",
    analystQueryPlaceholder: 'Např. title:RMO AND entity:RMO12/2024 nebo "technický správce"~5',
    queryComposer: "Průvodce dotazem",
    queryComposerDetail: "Začněte pojmem a zpřesněte jej pomocí nabízených výrazů, polí nebo entit.",
    composerPlaceholder: "Napište pojem, číslo dokumentu, zkratku nebo část názvu...",
    composerApply: "Upravit jako text",
    composerRun: "Hledat",
    composerClear: "Vyčistit",
    composerSuggestions: "Návrhy",
    composerEmpty: "Napište pojem nebo vyberte pole, entitu či uložený dotaz.",
    composerTokens: "Sestavený dotaz",
    composerPreview: "Výsledný dotaz",
    composerUseText: "Použít jako text",
    composerUsePhrase: "Použít jako frázi",
    composerServerReady: "Dotaz ověřen",
    composerServerPartial: "Částečné návrhy",
    composerValidating: "Ověřuji dotaz",
    composerLocalFallback: "Lokální fallback",
    composerStart: "Připraveno k zadání",
    composerInvalid: "Dotaz má chyby a nejde bezpečně spustit.",
    composerEstimatedResults: "Odhad nálezů",
    composerNoEstimatedResults: "Tento dotaz pravděpodobně nic nenajde.",
    composerPreviewUnavailable: "Odhad nálezů není dočasně dostupný.",
    composerRecovery: "Doporučené rozšíření dotazu",
    advancedControls: "Pokročilé nastavení dotazu",
    advancedControlsDetail: "Ruční syntaxe, režim, pole a proximity vzdálenost",
    composerCost: "Náročnost",
    composerClauses: "Části",
    composerCostLow: "nízká",
    composerCostMedium: "střední",
    composerCostHigh: "vysoká",
    suggestionGroupBuilder: "Builder",
    suggestionGroupFields: "Pole",
    suggestionGroupEntities: "Entity",
    suggestionGroupDictionary: "Slovník korpusu",
    suggestionGroupCases: "Spisy a dotazy",
    suggestionGroupOperators: "Operátory",
    tokenTerm: "Text",
    tokenPhrase: "Fráze",
    tokenField: "Pole",
    tokenEntity: "Entita",
    tokenOperator: "Operátor",
    tokenSavedQuery: "Uložený dotaz",
    queryMode: "Režim",
    searchField: "Pole",
    proximitySlop: "Vzdálenost",
    runAnalystSearch: "Spustit hledání",
    analystIdle: "Zadejte dotaz a vyberte režim hledání.",
    analystLoading: "Spouštím analytický dotaz v OpenSearch...",
    analystError: "Analytické hledání se nepodařilo dokončit.",
    analystEmpty: "Nenalezen žádný citovaný nález pro analytický dotaz.",
    analystInputRequired: "Zadejte analytický dotaz.",
    analystCase: "Analytický spis",
    analystCaseDetail: "Uložené dotazy a evidence sety pro TOVEK-like práci",
    caseTitlePlaceholder: "Název nového spisu",
    createCase: "Založit spis",
    activeCase: "Aktivní spis",
    noCase: "Žádný spis",
    saveQuery: "Uložit dotaz",
    savedQueries: "Uložené dotazy",
    evidenceSet: "Evidence set",
    addToCase: "Přidat do evidence",
    caseRequired: "Nejdřív založte nebo vyberte analytický spis.",
    caseSaved: "Uloženo do analytického spisu.",
    caseError: "Operace se spisem se nepodařila.",
    modeSmart: "Smart",
    modeBoolean: "Boolean",
    modePhrase: "Fráze",
    modeProximity: "Proximity",
    modeFielded: "Fielded",
    fieldAll: "Všechna pole",
    fieldTitle: "Název",
    fieldBody: "Text",
    fieldSection: "Sekce",
    fieldEntity: "Entity",
    fieldSource: "Zdroj",
    searchLabel: "Hledat",
    searchPlaceholder: "Název, ID, gestor, vlastník, štítek nebo metadata",
    statusFilter: "Stav",
    typeFilter: "Typ",
    classificationFilter: "Klasifikace",
    all: "Vše",
    clearFilter: "Zrušit filtr",
    closeFilter: "Zavřít filtr",
    filterTitlePrefix: "Filtr",
    noFilterResults: "Nenalezena žádná hodnota.",
    document: "Dokument",
    status: "Stav",
    classification: "Klasifikace",
    signal: "Signál",
    updated: "Aktualizováno",
    open: "Otevřít",
    emptyDocuments: "Nenalezen žádný dokument pro aktuální analytický filtr.",
    facets: "Facety korpusu",
    types: "Typy",
    classifications: "Klasifikace",
    owners: "Vlastníci a gestoři",
    readinessSignals: "Signály připravenosti",
    topIssues: "Nejčastější problémy",
    issueSamples: "Vzorky k řešení",
    entityIndex: "Index entit chunků",
    entityCoverage: "Pokrytí chunků",
    entityTypes: "Typy entit",
    entityValues: "Hodnoty podle typu",
    entityUnavailable: "Entity index zatím není dostupný.",
    chunksWithEntities: "chunků s entitami",
    evidenceSearch: "Vyhledávání důkazů",
    evidenceSearchDetail: "Citované nálezy nad autorizovanými dokumenty",
    evidenceQueryPlaceholder: "Hledat text, číslo dokumentu, e-mail, URL nebo IP adresu",
    entityType: "Typ entity",
    entityValue: "Hodnota entity",
    runSearch: "Hledat důkazy",
    evidenceIdle: "Zadejte dotaz nebo klikněte na hodnotu entity v indexu.",
    evidenceLoading: "Hledám v autorizovaných dokumentech...",
    evidenceError: "Vyhledávání se nepodařilo dokončit.",
    evidenceEmpty: "Nenalezen žádný citovaný nález pro aktuální dotaz.",
    evidenceInputRequired: "Zadejte dotaz, typ entity nebo hodnotu entity.",
    evidenceResults: "Nálezy",
    resultsCount: "nalezeno",
    page: "strana",
    section: "sekce",
    score: "skóre",
    source: "zdroj",
    version: "verze",
    clearEvidenceFilter: "Vyčistit entity filtr",
    selectEvidence: "Zobrazit nálezy",
    candidates: "Kandidátní entity",
    relationshipSeeds: "Zárodky vazeb",
    relationshipGraph: "Vazby entit",
    relationshipGraphDetail: "Evidence-backed vztahy z autorizovaných chunků",
    loadRelationships: "Načíst vazby",
    relationshipIdle: "Načtěte vazby nebo klikněte na hodnotu entity v indexu.",
    relationshipLoading: "Skládám vztahový graf z citovaných chunků...",
    relationshipError: "Vazby se nepodařilo načíst.",
    relationshipEmpty: "Nenalezena žádná citovaná vazba pro aktuální filtr.",
    relationshipResults: "Vazby",
    relationshipTypeCoOccurs: "společný výskyt",
    confidence: "jistota",
    evidenceCount: "důkazů",
    documentsCount: "dokumentů",
    evidence: "důkaz",
    generated: "Vygenerováno",
    noSignals: "Bez signálů v aktuálním oprávněném rozsahu.",
    noCandidates: "Bez dostatečných metadata kandidátů.",
    documentNumber: "Číslo dokumentu",
    owner: "Vlastník",
    tag: "Štítek",
    externalSystem: "Externí systém",
    documentTypeRelation: "typ dokumentu",
    classificationRelation: "klasifikace",
    statusRelation: "stav",
  },
  en: {
    metricsLabel: "Intelligence Workbench metrics",
    sectionNavigation: "Intelligence navigation",
    sectionOverview: "Overview",
    sectionCorpus: "Corpus",
    sectionSearch: "Search",
    sectionCases: "Cases",
    sectionEntities: "Entities",
    sectionRelationships: "Relationships",
    sectionQuality: "Readiness",
    corpusExplorer: "Document corpus",
    corpus: "Corpus",
    corpusDetail: "authorized documents",
    readiness: "Readiness",
    readinessDetail: "ready score",
    review: "Review",
    reviewDetail: "metadata or quality",
    blocked: "Blocked",
    blockedDetail: "critical signals",
    analystSearch: "Analyst search",
    advancedAnalystSearch: "Advanced analyst search",
    advancedAnalystDetail: "Boolean, phrase, proximity, and fielded queries over authorized chunks",
    analystQueryPlaceholder: 'For example title:RMO AND entity:RMO12/2024 or "technical owner"~5',
    queryComposer: "AKB Query Composer",
    queryComposerDetail: "Build a query from boxes, corpus dictionary, entities, fields, and saved queries.",
    composerPlaceholder: "Type a term, document number, abbreviation, or part of a title...",
    composerApply: "Use query",
    composerRun: "Run composer",
    composerClear: "Clear",
    composerSuggestions: "Suggestions",
    composerEmpty: "Type a term or choose a field, entity, or saved query.",
    composerTokens: "Composed query",
    composerPreview: "OpenSearch query",
    composerUseText: "Use as text",
    composerUsePhrase: "Use as phrase",
    composerServerReady: "Server validated",
    composerServerPartial: "Partial suggestions",
    composerValidating: "Validating query",
    composerLocalFallback: "Local fallback",
    composerStart: "Ready for input",
    composerInvalid: "The query has errors and cannot be safely run.",
    composerEstimatedResults: "Estimated results",
    composerNoEstimatedResults: "This query is unlikely to return a result.",
    composerPreviewUnavailable: "The result estimate is temporarily unavailable.",
    composerRecovery: "Recommended query expansion",
    advancedControls: "Advanced query settings",
    advancedControlsDetail: "Raw syntax, mode, field, and proximity distance",
    composerCost: "Cost",
    composerClauses: "Clauses",
    composerCostLow: "low",
    composerCostMedium: "medium",
    composerCostHigh: "high",
    suggestionGroupBuilder: "Builder",
    suggestionGroupFields: "Fields",
    suggestionGroupEntities: "Entities",
    suggestionGroupDictionary: "Corpus dictionary",
    suggestionGroupCases: "Cases and queries",
    suggestionGroupOperators: "Operators",
    tokenTerm: "Text",
    tokenPhrase: "Phrase",
    tokenField: "Field",
    tokenEntity: "Entity",
    tokenOperator: "Operator",
    tokenSavedQuery: "Saved query",
    queryMode: "Mode",
    searchField: "Field",
    proximitySlop: "Distance",
    runAnalystSearch: "Run search",
    analystIdle: "Enter a query and choose a search mode.",
    analystLoading: "Running analyst query in OpenSearch...",
    analystError: "Analyst search could not be completed.",
    analystEmpty: "No cited finding matches the analyst query.",
    analystInputRequired: "Enter an analyst query.",
    analystCase: "Analyst case",
    analystCaseDetail: "Saved queries and evidence sets for TOVEK-like work",
    caseTitlePlaceholder: "New case title",
    createCase: "Create case",
    activeCase: "Active case",
    noCase: "No case",
    saveQuery: "Save query",
    savedQueries: "Saved queries",
    evidenceSet: "Evidence set",
    addToCase: "Add to evidence",
    caseRequired: "Create or select an analyst case first.",
    caseSaved: "Saved to analyst case.",
    caseError: "Analyst case operation failed.",
    modeSmart: "Smart",
    modeBoolean: "Boolean",
    modePhrase: "Phrase",
    modeProximity: "Proximity",
    modeFielded: "Fielded",
    fieldAll: "All fields",
    fieldTitle: "Title",
    fieldBody: "Body",
    fieldSection: "Section",
    fieldEntity: "Entities",
    fieldSource: "Source",
    searchLabel: "Search",
    searchPlaceholder: "Title, ID, owner unit, owner, tag, or metadata",
    statusFilter: "Status",
    typeFilter: "Type",
    classificationFilter: "Classification",
    all: "All",
    clearFilter: "Clear filter",
    closeFilter: "Close filter",
    filterTitlePrefix: "Filter",
    noFilterResults: "No value found.",
    document: "Document",
    status: "Status",
    classification: "Classification",
    signal: "Signal",
    updated: "Updated",
    open: "Open",
    emptyDocuments: "No document matches the current intelligence filter.",
    facets: "Corpus facets",
    types: "Types",
    classifications: "Classifications",
    owners: "Owners and stewards",
    readinessSignals: "Readiness signals",
    topIssues: "Top issues",
    issueSamples: "Resolution samples",
    entityIndex: "Chunk entity index",
    entityCoverage: "Chunk coverage",
    entityTypes: "Entity types",
    entityValues: "Values by type",
    entityUnavailable: "Entity index is not available yet.",
    chunksWithEntities: "chunks with entities",
    evidenceSearch: "Evidence search",
    evidenceSearchDetail: "Cited findings over authorized documents",
    evidenceQueryPlaceholder: "Search text, document number, email, URL, or IP address",
    entityType: "Entity type",
    entityValue: "Entity value",
    runSearch: "Search evidence",
    evidenceIdle: "Enter a query or click an entity value in the index.",
    evidenceLoading: "Searching authorized documents...",
    evidenceError: "Evidence search could not be completed.",
    evidenceEmpty: "No cited finding matches the current query.",
    evidenceInputRequired: "Enter a query, entity type, or entity value.",
    evidenceResults: "Findings",
    resultsCount: "found",
    page: "page",
    section: "section",
    score: "score",
    source: "source",
    version: "version",
    clearEvidenceFilter: "Clear entity filter",
    selectEvidence: "Show findings",
    candidates: "Candidate entities",
    relationshipSeeds: "Relationship seeds",
    relationshipGraph: "Entity relationships",
    relationshipGraphDetail: "Evidence-backed relationships from authorized chunks",
    loadRelationships: "Load relationships",
    relationshipIdle: "Load relationships or click an entity value in the index.",
    relationshipLoading: "Building the relationship graph from cited chunks...",
    relationshipError: "Relationships could not be loaded.",
    relationshipEmpty: "No cited relationship matches the current filter.",
    relationshipResults: "Relationships",
    relationshipTypeCoOccurs: "co-occurrence",
    confidence: "confidence",
    evidenceCount: "evidence",
    documentsCount: "documents",
    evidence: "evidence",
    generated: "Generated",
    noSignals: "No signals in the current authorized scope.",
    noCandidates: "No sufficient metadata candidates.",
    documentNumber: "Document number",
    owner: "Owner",
    tag: "Tag",
    externalSystem: "External system",
    documentTypeRelation: "document type",
    classificationRelation: "classification",
    statusRelation: "status",
  },
} satisfies Record<AklLanguage, Record<string, string>>;

export function IntelligenceWorkbench({
  documents,
  summary,
  readiness,
  entityFacets,
  analystCases,
  generatedAtIso,
}: IntelligenceWorkbenchProps) {
  const { language } = useLanguage();
  const copy = workbenchCopy[language];
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<DocumentStatus[]>([]);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [analystQuery, setAnalystQuery] = useState("");
  const [analystMode, setAnalystMode] = useState<AnalystSearchMode>("smart");
  const [analystField, setAnalystField] = useState<AnalystSearchField>("all");
  const [analystProximitySlop, setAnalystProximitySlop] = useState(5);
  const [analystStatus, setAnalystStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [analystResult, setAnalystResult] = useState<AnalystSearchResponse | null>(null);
  const [analystError, setAnalystError] = useState<string | null>(null);
  const [evidenceQuery, setEvidenceQuery] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityValue, setEntityValue] = useState("");
  const [evidenceStatus, setEvidenceStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [evidenceResult, setEvidenceResult] = useState<EntitySearchResponse | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [relationshipStatus, setRelationshipStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [relationshipResult, setRelationshipResult] = useState<EntityRelationshipResponse | null>(null);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [cases, setCases] = useState<AnalystCase[]>(analystCases);
  const [activeCaseId, setActiveCaseId] = useState(analystCases[0]?.case_id ?? "");
  const [newCaseTitle, setNewCaseTitle] = useState("");
  const [caseStatus, setCaseStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [caseMessage, setCaseMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<IntelligenceSectionId>("overview");
  const [composerInput, setComposerInput] = useState("");
  const [composerTokens, setComposerTokens] = useState<QueryComposerToken[]>([]);
  const [serverQueryState, setServerQueryState] = useState<QuerySuggestionResponse | null>(null);
  const [querySuggestionStatus, setQuerySuggestionStatus] = useState<"idle" | "loading" | "ready" | "partial" | "fallback">("idle");

  const activeCase = useMemo(
    () => cases.find((candidate) => candidate.case_id === activeCaseId) ?? null,
    [activeCaseId, cases],
  );

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return documents
      .filter((document) => {
        if (statuses.length > 0 && !statuses.includes(document.status)) {
          return false;
        }
        if (types.length > 0 && !types.includes(document.document_type)) {
          return false;
        }
        if (
          classifications.length > 0 &&
          !classifications.includes(document.classification)
        ) {
          return false;
        }
        if (!normalizedQuery) {
          return true;
        }
        return documentSearchText(document, language).includes(normalizedQuery);
      })
      .slice(0, 50);
  }, [classifications, documents, language, query, statuses, types]);

  const candidateSignals = useMemo(
    () => deriveCandidateSignals(documents),
    [documents],
  );
  const statusOptions = useMemo(
    () => summary.by_status.map((bucket) => bucket.key as DocumentStatus),
    [summary.by_status],
  );
  const typeOptions = useMemo(
    () =>
      summary.by_document_type.map((bucket) => bucket.key as DocumentType),
    [summary.by_document_type],
  );
  const classificationOptions = useMemo(
    () =>
      summary.by_classification.map((bucket) => bucket.key as Classification),
    [summary.by_classification],
  );
  const entityTypeOptions = useMemo(
    () => entityFacets.entity_types.map((bucket) => bucket.key),
    [entityFacets.entity_types],
  );
  const localQuerySuggestions = useMemo(
    () =>
      buildQuerySuggestions({
        input: composerInput,
        documents,
        candidateSignals,
        entityFacets,
        cases,
        activeCase,
        copy,
        language,
      }),
    [activeCase, candidateSignals, cases, composerInput, copy, documents, entityFacets, language],
  );
  const composedQuery = useMemo(
    () => composeQueryFromTokens(composerTokens, composerInput),
    [composerInput, composerTokens],
  );
  const serverPlanMatch = serverQueryState?.plan.query_text === composedQuery;
  const querySuggestions = composerInput.trim() || composerTokens.length > 0
    ? localQuerySuggestions
    : localQuerySuggestions.slice(0, 12);
  const composerPlan = serverPlanMatch ? (serverQueryState?.plan ?? null) : null;
  const composerPreview = serverPlanMatch ? (serverQueryState?.preview ?? null) : null;
  const composerValidation = serverPlanMatch ? (serverQueryState?.validation ?? []) : [];
  const composerSuggestionStatus = !composedQuery.trim()
    ? "idle"
    : querySuggestionStatus === "fallback" || serverPlanMatch
      ? querySuggestionStatus
      : "loading";
  const sectionNavItems = useMemo<IntelligenceSectionNavItem[]>(
    () => [
      {
        id: "overview",
        label: copy.sectionOverview,
        value: `${Math.round(readiness.readiness_score * 100)}%`,
        icon: CheckCircle2,
      },
      {
        id: "corpus",
        label: copy.sectionCorpus,
        value: formatNumber(summary.total_visible_documents, language),
        icon: FileSearch,
      },
      {
        id: "search",
        label: copy.sectionSearch,
        value:
          analystResult?.total_hits !== undefined
            ? formatNumber(analystResult.total_hits, language)
            : copy.modeSmart,
        icon: Search,
      },
      {
        id: "cases",
        label: copy.sectionCases,
        value: formatNumber(cases.length, language),
        icon: ShieldCheck,
      },
      {
        id: "entities",
        label: copy.sectionEntities,
        value: formatNumber(entityFacets.chunks_with_entities, language),
        icon: Tags,
      },
      {
        id: "relationships",
        label: copy.sectionRelationships,
        value:
          relationshipResult?.total_edges !== undefined
            ? formatNumber(relationshipResult.total_edges, language)
            : formatNumber(candidateSignals.length, language),
        icon: Network,
      },
      {
        id: "quality",
        label: copy.sectionQuality,
        value: formatNumber(readiness.review_documents, language),
        icon: AlertTriangle,
      },
    ],
    [
      analystResult?.total_hits,
      candidateSignals.length,
      cases.length,
      copy,
      entityFacets.chunks_with_entities,
      language,
      readiness.readiness_score,
      readiness.review_documents,
      relationshipResult?.total_edges,
      summary.total_visible_documents,
    ],
  );

  useEffect(() => {
    const syncSectionFromHash = () => {
      const hashValue = window.location.hash.replace("#", "");
      if (isIntelligenceSectionId(hashValue)) {
        setActiveSection(hashValue);
      }
    };
    syncSectionFromHash();
    window.addEventListener("hashchange", syncSectionFromHash);
    return () => window.removeEventListener("hashchange", syncSectionFromHash);
  }, []);

  useEffect(() => {
    if (!composedQuery.trim()) {
      setServerQueryState(null);
      setQuerySuggestionStatus("idle");
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setQuerySuggestionStatus("loading");
      try {
        const response = await fetch(withAppBasePath("/api/intelligence/query/suggestions"), {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            input: composerInput,
            tokens: composerTokens.map(composerTokenToServer),
            active_case_id: activeCaseId || null,
            language,
            limit: 36,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Query suggestions failed with HTTP ${response.status}`);
        }
        const payload = (await response.json()) as QuerySuggestionResponse;
        setServerQueryState(payload);
        setQuerySuggestionStatus(payload.status === "partial" ? "partial" : "ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setServerQueryState(null);
        setQuerySuggestionStatus("fallback");
      }
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeCaseId, composedQuery, composerInput, composerTokens, language]);

  function selectIntelligenceSection(sectionId: IntelligenceSectionId) {
    setActiveSection(sectionId);
    const nextHash = sectionId === "overview" ? "" : `#${sectionId}`;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${nextHash}`,
    );
  }

  async function runAnalystSearch(
    queryOverride?: string,
    modeOverride?: AnalystSearchMode,
    fieldsOverride?: AnalystSearchField[],
  ) {
    const queryText = queryOverride ?? analystQuery;
    const queryMode = modeOverride ?? analystMode;
    const searchFields = fieldsOverride ?? [analystField];
    if (!queryText.trim()) {
      setAnalystStatus("error");
      setAnalystResult(null);
      setAnalystError(copy.analystInputRequired);
      return;
    }

    setAnalystQuery(queryText);
    setAnalystStatus("loading");
    setAnalystError(null);
    try {
      const response = await fetch(withAppBasePath("/api/intelligence/analyst/search"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          query: queryText,
          query_mode: queryMode,
          search_fields: searchFields,
          proximity_slop: analystProximitySlop,
          entity_type: entityType || null,
          entity_value: entityValue || null,
          limit: 12,
        }),
      });
      if (!response.ok) {
        throw new Error(`Analyst search failed with HTTP ${response.status}`);
      }
      const payload = (await response.json()) as AnalystSearchResponse;
      setAnalystResult(payload);
      setAnalystStatus("ready");
    } catch {
      setAnalystStatus("error");
      setAnalystResult(null);
      setAnalystError(copy.analystError);
    }
  }

  function addComposerSuggestion(suggestion: QuerySuggestion) {
    const token: QueryComposerToken = {
      id: `${suggestion.id}:${Date.now()}:${composerTokens.length}`,
      type: suggestion.type,
      label: suggestion.label,
      value: suggestion.value,
      queryFragment: suggestion.queryFragment,
      entityType: suggestion.entityType,
      entityValue: suggestion.entityValue,
      mode: suggestion.mode,
      field: suggestion.field,
    };
    setComposerTokens((current) => [...current, token]);
    if (suggestion.entityType !== undefined) {
      setEntityType(suggestion.entityType);
    }
    if (suggestion.entityValue !== undefined) {
      setEntityValue(suggestion.entityValue);
    }
    if (suggestion.mode !== undefined) {
      setAnalystMode(suggestion.mode);
    }
    if (suggestion.field !== undefined) {
      setAnalystField(suggestion.field);
    }
    setComposerInput("");
  }

  function removeComposerToken(tokenId: string) {
    setComposerTokens((current) => current.filter((token) => token.id !== tokenId));
  }

  function clearComposer() {
    setComposerTokens([]);
    setComposerInput("");
    setAnalystQuery("");
  }

  function applyComposerQuery() {
    const nextQuery = composedQuery.trim();
    const nextPlan = composerPlan;
    setAnalystQuery(nextQuery);
    if (nextPlan?.query_mode) {
      setAnalystMode(nextPlan.query_mode);
    } else if (nextQuery.includes(":")) {
      setAnalystMode("fielded");
    }
    const firstField = nextPlan?.search_fields.find((field) => field !== "all");
    if (firstField) {
      setAnalystField(firstField);
    }
  }

  function runComposerSearch() {
    const nextQuery = composedQuery.trim();
    if (composerPlan?.can_run === false) {
      setAnalystStatus("error");
      setAnalystResult(null);
      setAnalystError(composerValidation.find((issue) => issue.severity === "error")?.message ?? copy.composerInvalid);
      return;
    }
    const nextMode = composerPlan?.query_mode ?? (nextQuery.includes(":") ? "fielded" : analystMode);
    const nextFields = composerPlan?.search_fields.length ? composerPlan.search_fields : [analystField];
    setAnalystMode(nextMode);
    const firstField = nextFields.find((field) => field !== "all");
    if (firstField) {
      setAnalystField(firstField);
    }
    void runAnalystSearch(nextQuery, nextMode, nextFields);
  }

  function applyRecoveryAction(action: QueryComposerRecoveryAction) {
    setComposerTokens([]);
    setComposerInput(action.query_text);
    setAnalystQuery(action.query_text);
    setAnalystMode(action.query_mode);
    setAnalystField(action.search_fields.find((field) => field !== "all") ?? "all");
    void runAnalystSearch(action.query_text, action.query_mode, action.search_fields);
  }

  async function runEvidenceSearch(overrides: {
    query?: string;
    entityType?: string;
    entityValue?: string;
  } = {}) {
    const nextQuery = overrides.query ?? evidenceQuery;
    const nextEntityType = overrides.entityType ?? entityType;
    const nextEntityValue = overrides.entityValue ?? entityValue;
    if (overrides.query !== undefined) setEvidenceQuery(overrides.query);
    if (overrides.entityType !== undefined) setEntityType(overrides.entityType);
    if (overrides.entityValue !== undefined) setEntityValue(overrides.entityValue);

    if (!nextQuery.trim() && !nextEntityType.trim() && !nextEntityValue.trim()) {
      setEvidenceStatus("error");
      setEvidenceResult(null);
      setEvidenceError(copy.evidenceInputRequired);
      return;
    }

    setEvidenceStatus("loading");
    setEvidenceError(null);
    try {
      const response = await fetch(withAppBasePath("/api/intelligence/entities/search"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          query: nextQuery,
          entity_type: nextEntityType || null,
          entity_value: nextEntityValue || null,
          limit: 12,
        }),
      });
      if (!response.ok) {
        throw new Error(`Search failed with HTTP ${response.status}`);
      }
      const payload = (await response.json()) as EntitySearchResponse;
      setEvidenceResult(payload);
      setEvidenceStatus("ready");
    } catch {
      setEvidenceStatus("error");
      setEvidenceResult(null);
      setEvidenceError(copy.evidenceError);
    }
  }

  async function runRelationshipSearch(overrides: {
    entityType?: string;
    entityValue?: string;
  } = {}) {
    const nextEntityType = overrides.entityType ?? entityType;
    const nextEntityValue = overrides.entityValue ?? entityValue;
    if (overrides.entityType !== undefined) setEntityType(overrides.entityType);
    if (overrides.entityValue !== undefined) setEntityValue(overrides.entityValue);

    setRelationshipStatus("loading");
    setRelationshipError(null);
    try {
      const response = await fetch(withAppBasePath("/api/intelligence/entities/relationships"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          entity_type: nextEntityType || null,
          entity_value: nextEntityValue || null,
          min_evidence_count: 1,
          limit: 12,
        }),
      });
      if (!response.ok) {
        throw new Error(`Relationship graph failed with HTTP ${response.status}`);
      }
      const payload = (await response.json()) as EntityRelationshipResponse;
      setRelationshipResult(payload);
      setRelationshipStatus("ready");
    } catch {
      setRelationshipStatus("error");
      setRelationshipResult(null);
      setRelationshipError(copy.relationshipError);
    }
  }

  async function createAnalystCase() {
    const title = newCaseTitle.trim();
    if (!title) {
      setCaseStatus("error");
      setCaseMessage(copy.caseRequired);
      return;
    }
    setCaseStatus("loading");
    setCaseMessage(null);
    try {
      const response = await fetch(withAppBasePath("/api/intelligence/cases"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          title,
          classification: "internal",
          tags: ["intelligence"],
          metadata: { source: "intelligence_workbench" },
        }),
      });
      if (!response.ok) {
        throw new Error(`Create case failed with HTTP ${response.status}`);
      }
      const payload = (await response.json()) as AnalystCase;
      setCases((current) => [payload, ...current.filter((candidate) => candidate.case_id !== payload.case_id)]);
      setActiveCaseId(payload.case_id);
      setNewCaseTitle("");
      setCaseStatus("ready");
      setCaseMessage(copy.caseSaved);
    } catch {
      setCaseStatus("error");
      setCaseMessage(copy.caseError);
    }
  }

  async function saveAnalystQueryToCase() {
    if (!activeCase || !analystQuery.trim()) {
      setCaseStatus("error");
      setCaseMessage(activeCase ? copy.analystInputRequired : copy.caseRequired);
      return;
    }
    setCaseStatus("loading");
    setCaseMessage(null);
    try {
      const response = await fetch(withAppBasePath(`/api/intelligence/cases/${activeCase.case_id}/saved-queries`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          title: analystQuery.trim().slice(0, 120),
          query_text: analystQuery,
          query_mode: analystMode,
          search_fields: [analystField],
          filters: {
            entity_type: entityType || null,
            entity_value: entityValue || null,
            proximity_slop: analystProximitySlop,
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Save query failed with HTTP ${response.status}`);
      }
      const savedQuery = (await response.json()) as AnalystCase["saved_queries"][number];
      setCases((current) =>
        current.map((candidate) =>
          candidate.case_id === activeCase.case_id
            ? {
                ...candidate,
                saved_queries: [...candidate.saved_queries, savedQuery],
                updated_at: savedQuery.created_at,
              }
            : candidate,
        ),
      );
      setCaseStatus("ready");
      setCaseMessage(copy.caseSaved);
    } catch {
      setCaseStatus("error");
      setCaseMessage(copy.caseError);
    }
  }

  async function addEvidenceHitToCase(hit: EntitySearchHit) {
    if (!activeCase) {
      setCaseStatus("error");
      setCaseMessage(copy.caseRequired);
      return;
    }
    setCaseStatus("loading");
    setCaseMessage(null);
    try {
      const response = await fetch(withAppBasePath(`/api/intelligence/cases/${activeCase.case_id}/evidence`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          title: hit.document_title || hit.chunk_id,
          document_id: hit.document_id,
          document_version_id: hit.document_version_id,
          document_title: hit.document_title,
          chunk_id: hit.chunk_id,
          page_number: hit.page_number,
          section_title: hit.section_title,
          source_file_name: hit.source_file_name,
          score: hit.score,
          snippet: hit.snippet,
          entity_types: hit.entity_types,
          entity_values: hit.entity_values,
          metadata: {
            source: "intelligence_workbench",
            query_mode: analystMode,
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Add evidence failed with HTTP ${response.status}`);
      }
      const evidence = (await response.json()) as AnalystEvidenceItem;
      setCases((current) =>
        current.map((candidate) =>
          candidate.case_id === activeCase.case_id
            ? {
                ...candidate,
                evidence_items: [...candidate.evidence_items, evidence],
                updated_at: evidence.created_at,
              }
            : candidate,
        ),
      );
      setCaseStatus("ready");
      setCaseMessage(copy.caseSaved);
    } catch {
      setCaseStatus("error");
      setCaseMessage(copy.caseError);
    }
  }

  useEffect(() => {
    void runRelationshipSearch({ entityType: "", entityValue: "" });
    // Initial graph load should not reset when the user edits filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns: Array<StratosDataTableColumn<Document>> = [
    {
      id: "document",
      label: copy.document,
      width: "minmax(280px, 1.5fr)",
      sortable: true,
      sortAccessor: (document) => document.title,
      render: (document) => (
        <span className="cell-title">
          <strong>{document.title}</strong>
          <span>
            {document.document_id} - {documentTypeLabel(document.document_type, language)}
          </span>
        </span>
      ),
    },
    {
      id: "status",
      label: copy.status,
      width: 132,
      sortable: true,
      sortAccessor: (document) => document.status,
      render: (document) => <StatusBadge value={document.status} />,
    },
    {
      id: "classification",
      label: copy.classification,
      width: 140,
      sortable: true,
      sortAccessor: (document) => document.classification,
      render: (document) => document.classification,
    },
    {
      id: "signal",
      label: copy.signal,
      width: "minmax(190px, 0.8fr)",
      render: (document) => documentSignalLabel(document, readiness.issues),
    },
    {
      id: "updated",
      label: copy.updated,
      width: 170,
      sortable: true,
      sortAccessor: (document) => document.updated_at,
      render: (document) => formatDateTime(document.updated_at, language),
    },
    {
      id: "open",
      label: copy.open,
      width: 104,
      resizable: false,
      render: (document) => (
        <StratosButtonLink href={`/documents/${document.document_id}`}>
          {copy.open}
          <ArrowUpRight size={15} aria-hidden="true" />
        </StratosButtonLink>
      ),
    },
  ];

  return (
    <div className="stack intelligence-workbench">
      <nav className="intelligence-subnav" aria-label={copy.sectionNavigation}>
        <div className="intelligence-subnav__list" role="tablist" aria-orientation="horizontal">
          {sectionNavItems.map(({ id, label, value, icon: Icon }) => (
            <button
              aria-controls={`intelligence-section-${id}`}
              aria-selected={activeSection === id}
              className={`intelligence-subnav__button${activeSection === id ? " is-active" : ""}`}
              id={`intelligence-tab-${id}`}
              key={id}
              onClick={() => selectIntelligenceSection(id)}
              role="tab"
              type="button"
            >
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
              <strong>{value}</strong>
            </button>
          ))}
        </div>
      </nav>

      <div
        aria-labelledby={`intelligence-tab-${activeSection}`}
        className="stack intelligence-section"
        id={`intelligence-section-${activeSection}`}
        role="tabpanel"
      >
        {activeSection === "overview" ? (
          <>
            <section className="grid grid--metrics" aria-label={copy.metricsLabel}>
              <MetricCard
                detail={copy.corpusDetail}
                icon={FileSearch}
                label={copy.corpus}
                value={formatNumber(summary.total_visible_documents, language)}
              />
              <MetricCard
                detail={copy.readinessDetail}
                icon={CheckCircle2}
                label={copy.readiness}
                tone={readiness.readiness_score >= 0.8 ? "success" : "attention"}
                value={`${Math.round(readiness.readiness_score * 100)} %`}
              />
              <MetricCard
                detail={copy.reviewDetail}
                icon={Search}
                label={copy.review}
                tone={readiness.review_documents > 0 ? "attention" : "success"}
                value={formatNumber(readiness.review_documents, language)}
              />
              <MetricCard
                detail={copy.blockedDetail}
                icon={AlertTriangle}
                label={copy.blocked}
                tone={readiness.blocked_documents > 0 ? "danger" : "success"}
                value={formatNumber(readiness.blocked_documents, language)}
              />
            </section>

            <section className="panel">
              <div className="panel__header">
                <h2>{copy.facets}</h2>
                <span className="muted">
                  {copy.generated}: {formatDateTime(generatedAtIso, language)}
                </span>
              </div>
              <div className="panel__body intelligence-facet-grid">
                <FacetColumn title={copy.types} buckets={summary.by_document_type} />
                <FacetColumn
                  title={copy.classifications}
                  buckets={summary.by_classification}
                />
                <FacetColumn title={copy.owners} buckets={summary.by_owner} />
              </div>
            </section>
          </>
        ) : null}

        {activeSection === "corpus" ? (
          <section className="panel">
            <div className="panel__header">
              <h2>{copy.corpusExplorer}</h2>
              <span className="muted">
                {copy.generated}: {formatDateTime(generatedAtIso, language)}
              </span>
            </div>
            <div className="panel__body panel__body--toolbar">
              <div className="table-toolbar table-toolbar--four">
                <StratosSearchBox
                  id="intelligence-query"
                  label={copy.searchLabel}
                  value={query}
                  placeholder={copy.searchPlaceholder}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <StratosSelect
                  id="intelligence-status-filter"
                  label={copy.statusFilter}
                  multiple
                  placeholder={copy.all}
                  clearDescription={copy.clearFilter}
                  closeLabel={copy.closeFilter}
                  filterTitlePrefix={copy.filterTitlePrefix}
                  noResultsLabel={copy.noFilterResults}
                  value={statuses}
                  onValuesChange={(values) => setStatuses(values as DocumentStatus[])}
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </StratosSelect>
                <StratosSelect
                  id="intelligence-type-filter"
                  label={copy.typeFilter}
                  multiple
                  placeholder={copy.all}
                  clearDescription={copy.clearFilter}
                  closeLabel={copy.closeFilter}
                  filterTitlePrefix={copy.filterTitlePrefix}
                  noResultsLabel={copy.noFilterResults}
                  value={types}
                  onValuesChange={(values) => setTypes(values as DocumentType[])}
                >
                  {typeOptions.map((type) => (
                    <option key={type} value={type}>
                      {documentTypeLabel(type, language)}
                    </option>
                  ))}
                </StratosSelect>
                <StratosSelect
                  id="intelligence-classification-filter"
                  label={copy.classificationFilter}
                  multiple
                  placeholder={copy.all}
                  clearDescription={copy.clearFilter}
                  closeLabel={copy.closeFilter}
                  filterTitlePrefix={copy.filterTitlePrefix}
                  noResultsLabel={copy.noFilterResults}
                  value={classifications}
                  onValuesChange={(values) =>
                    setClassifications(values as Classification[])
                  }
                >
                  {classificationOptions.map((classification) => (
                    <option key={classification} value={classification}>
                      {classification}
                    </option>
                  ))}
                </StratosSelect>
              </div>
            </div>
            <StratosDataTable
              rows={filteredDocuments}
              columns={columns}
              getRowId={(document) => document.document_id}
              emptyLabel={copy.emptyDocuments}
              aria-label={copy.corpusExplorer}
            />
          </section>
        ) : null}

        {activeSection === "search" ? (
          <>
            <section className="panel">
              <div className="panel__header">
                <div>
                  <h2>{copy.advancedAnalystSearch}</h2>
                  <p>{copy.advancedAnalystDetail}</p>
                </div>
                {analystResult ? (
                  <span className="muted">
                    {formatNumber(analystResult.total_hits, language)} {copy.resultsCount}
                  </span>
                ) : null}
              </div>
              <div className="panel__body stack">
                <QueryComposer
                  copy={copy}
                  input={composerInput}
                  onAddSuggestion={addComposerSuggestion}
                  onApply={applyComposerQuery}
                  onClear={clearComposer}
                  onInputChange={setComposerInput}
                  onRecovery={applyRecoveryAction}
                  onRemoveToken={removeComposerToken}
                  onRun={runComposerSearch}
                  plan={composerPlan}
                  preview={composerPreview}
                  previewQuery={composedQuery || analystQuery}
                  suggestionStatus={composerSuggestionStatus}
                  suggestions={querySuggestions}
                  tokens={composerTokens}
                  validation={composerValidation}
                />
                <details className="intelligence-advanced-controls">
                  <summary>
                    <strong>{copy.advancedControls}</strong>
                    <span>{copy.advancedControlsDetail}</span>
                  </summary>
                  <div className="intelligence-analyst-toolbar intelligence-analyst-toolbar--controls">
                  <label className="stratos-field" htmlFor="intelligence-analyst-query">
                    <span>{copy.composerPreview}</span>
                    <input
                      id="intelligence-analyst-query"
                      type="text"
                      value={analystQuery}
                      placeholder={copy.analystQueryPlaceholder}
                      onChange={(event) => setAnalystQuery(event.target.value)}
                    />
                  </label>
                  <label className="stratos-field" htmlFor="intelligence-analyst-mode">
                    <span>{copy.queryMode}</span>
                    <select
                      id="intelligence-analyst-mode"
                      value={analystMode}
                      onChange={(event) => setAnalystMode(event.target.value as AnalystSearchMode)}
                    >
                      <option value="smart">{copy.modeSmart}</option>
                      <option value="boolean">{copy.modeBoolean}</option>
                      <option value="phrase">{copy.modePhrase}</option>
                      <option value="proximity">{copy.modeProximity}</option>
                      <option value="fielded">{copy.modeFielded}</option>
                    </select>
                  </label>
                  <label className="stratos-field" htmlFor="intelligence-analyst-field">
                    <span>{copy.searchField}</span>
                    <select
                      id="intelligence-analyst-field"
                      value={analystField}
                      onChange={(event) => setAnalystField(event.target.value as AnalystSearchField)}
                    >
                      <option value="all">{copy.fieldAll}</option>
                      <option value="title">{copy.fieldTitle}</option>
                      <option value="body">{copy.fieldBody}</option>
                      <option value="section">{copy.fieldSection}</option>
                      <option value="entity">{copy.fieldEntity}</option>
                      <option value="source">{copy.fieldSource}</option>
                    </select>
                  </label>
                  <label className="stratos-field" htmlFor="intelligence-analyst-proximity">
                    <span>{copy.proximitySlop}</span>
                    <input
                      id="intelligence-analyst-proximity"
                      type="number"
                      min={1}
                      max={25}
                      value={analystProximitySlop}
                      onChange={(event) => setAnalystProximitySlop(Number(event.target.value) || 5)}
                    />
                  </label>
                  <div className="intelligence-evidence-actions">
                    <button
                      className="button button--primary"
                      type="button"
                      onClick={() => {
                        void runAnalystSearch();
                      }}
                      disabled={analystStatus === "loading"}
                    >
                      <Search size={15} aria-hidden="true" />
                      {copy.runAnalystSearch}
                    </button>
                  </div>
                  </div>
                </details>
                <AnalystSearchResults
                  copy={copy}
                  language={language}
                  status={analystStatus}
                  error={analystError}
                  result={analystResult}
                  recoveryActions={composerPreview?.recovery_actions ?? []}
                  onRecovery={applyRecoveryAction}
                  onAddEvidence={activeCase ? addEvidenceHitToCase : undefined}
                />
              </div>
            </section>

          </>
        ) : null}

        {activeSection === "cases" ? (
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>{copy.analystCase}</h2>
                <p>{copy.analystCaseDetail}</p>
              </div>
              {activeCase ? (
                <span className="muted">
                  {activeCase.saved_queries.length} {copy.savedQueries} ·{" "}
                  {activeCase.evidence_items.length} {copy.evidenceSet}
                </span>
              ) : null}
            </div>
            <div className="panel__body stack">
              <div className="intelligence-case-toolbar">
                <label className="stratos-field" htmlFor="intelligence-active-case">
                  <span>{copy.activeCase}</span>
                  <select
                    id="intelligence-active-case"
                    value={activeCaseId}
                    onChange={(event) => setActiveCaseId(event.target.value)}
                  >
                    <option value="">{copy.noCase}</option>
                    {cases.map((analystCase) => (
                      <option key={analystCase.case_id} value={analystCase.case_id}>
                        {analystCase.title}
                      </option>
                    ))}
                  </select>
                </label>
                <StratosSearchBox
                  id="intelligence-new-case-title"
                  label={copy.analystCase}
                  value={newCaseTitle}
                  placeholder={copy.caseTitlePlaceholder}
                  onChange={(event) => setNewCaseTitle(event.target.value)}
                />
                <div className="intelligence-evidence-actions">
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => {
                      void createAnalystCase();
                    }}
                    disabled={caseStatus === "loading"}
                  >
                    {copy.createCase}
                  </button>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => {
                      void saveAnalystQueryToCase();
                    }}
                    disabled={caseStatus === "loading" || !activeCase}
                  >
                    {copy.saveQuery}
                  </button>
                </div>
              </div>
              {caseMessage ? (
                <p className={caseStatus === "error" ? "notice notice--danger" : "notice"} role="status">
                  {caseMessage}
                </p>
              ) : null}
              {activeCase ? (
                <div className="intelligence-case-summary">
                  <div>
                    <span>{copy.savedQueries}</span>
                    <strong>{formatNumber(activeCase.saved_queries.length, language)}</strong>
                  </div>
                  <div>
                    <span>{copy.evidenceSet}</span>
                    <strong>{formatNumber(activeCase.evidence_items.length, language)}</strong>
                  </div>
                  <div>
                    <span>{copy.updated}</span>
                    <strong>{formatDateTime(activeCase.updated_at, language)}</strong>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeSection === "entities" ? (
          <>
            <section className="grid grid--two">
              <div className="panel">
              <div className="panel__header">
                <h2>{copy.entityIndex}</h2>
                <span className="muted">
                  {formatNumber(entityFacets.chunks_with_entities, language)}/
                  {formatNumber(entityFacets.total_chunks, language)}
                </span>
              </div>
              <div className="panel__body intelligence-facet-grid intelligence-entity-grid">
                {entityFacets.status === "ready" ? (
                  <>
                    <FacetColumn title={copy.entityTypes} buckets={entityFacets.entity_types} />
                    <EntityValueGroups
                      title={copy.entityValues}
                      report={entityFacets}
                      language={language}
                      emptyLabel={copy.noSignals}
                      selectLabel={copy.selectEvidence}
                      onSelect={(selectedType, selectedValue) => {
                        void runEvidenceSearch({
                          entityType: selectedType,
                          entityValue: selectedValue,
                        });
                        void runRelationshipSearch({
                          entityType: selectedType,
                          entityValue: selectedValue,
                        });
                      }}
                    />
                  </>
                ) : (
                  <p className="muted">{copy.entityUnavailable}</p>
                )}
              </div>
            </div>

              <div className="panel">
              <div className="panel__header">
                <h2>{copy.candidates}</h2>
                <Network size={18} aria-hidden="true" />
              </div>
              <div className="panel__body">
                {candidateSignals.length > 0 ? (
                  <div className="intelligence-signal-list">
                    {candidateSignals.slice(0, 14).map((candidate) => (
                      <div className="intelligence-signal" key={candidate.id}>
                        <span>
                          <strong>{candidate.label}</strong>
                          <small>{candidateTypeLabel(candidate.type, copy)}</small>
                        </span>
                        <b>{formatNumber(candidate.count, language)}</b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">{copy.noCandidates}</p>
                )}
              </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel__header">
                <div>
                  <h2>{copy.evidenceSearch}</h2>
                  <p>{copy.evidenceSearchDetail}</p>
                </div>
                {evidenceResult ? (
                  <span className="muted">
                    {formatNumber(evidenceResult.total_hits, language)} {copy.resultsCount}
                  </span>
                ) : null}
              </div>
              <div className="panel__body stack">
                <div className="intelligence-evidence-toolbar">
                  <StratosSearchBox
                    id="intelligence-evidence-query"
                    label={copy.searchLabel}
                    value={evidenceQuery}
                    placeholder={copy.evidenceQueryPlaceholder}
                    onChange={(event) => setEvidenceQuery(event.target.value)}
                  />
                  <label className="stratos-field" htmlFor="intelligence-entity-type">
                    <span>{copy.entityType}</span>
                    <select
                      id="intelligence-entity-type"
                      value={entityType}
                      onChange={(event) => setEntityType(event.target.value)}
                    >
                      <option value="">{copy.all}</option>
                      {entityTypeOptions.map((type) => (
                        <option key={type} value={type}>
                          {entityTypeLabel(type, language)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="stratos-field" htmlFor="intelligence-entity-value">
                    <span>{copy.entityValue}</span>
                    <input
                      id="intelligence-entity-value"
                      type="text"
                      value={entityValue}
                      placeholder="RMO12/2024"
                      onChange={(event) => setEntityValue(event.target.value)}
                    />
                  </label>
                  <div className="intelligence-evidence-actions">
                    <button
                      className="button button--primary"
                      type="button"
                      onClick={() => {
                        void runEvidenceSearch();
                      }}
                      disabled={evidenceStatus === "loading"}
                    >
                      <Search size={15} aria-hidden="true" />
                      {copy.runSearch}
                    </button>
                    {entityType || entityValue ? (
                      <button
                        className="button"
                        type="button"
                        onClick={() => {
                          setEntityType("");
                          setEntityValue("");
                        }}
                      >
                        {copy.clearEvidenceFilter}
                      </button>
                    ) : null}
                  </div>
                </div>
                <EvidenceSearchResults
                  copy={copy}
                  language={language}
                  status={evidenceStatus}
                  error={evidenceError}
                  result={evidenceResult}
                  onAddEvidence={activeCase ? addEvidenceHitToCase : undefined}
                />
              </div>
            </section>
          </>
        ) : null}

        {activeSection === "relationships" ? (
          <section className="grid grid--two">
            <div className="panel">
              <div className="panel__header">
                <div>
                  <h2>{copy.relationshipGraph}</h2>
                  <p>{copy.relationshipGraphDetail}</p>
                </div>
                {relationshipResult ? (
                  <span className="muted">
                    {formatNumber(relationshipResult.total_edges, language)} {copy.relationshipResults}
                  </span>
                ) : (
                  <Network size={18} aria-hidden="true" />
                )}
              </div>
              <div className="panel__body stack">
                <div className="intelligence-evidence-actions">
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      void runRelationshipSearch();
                    }}
                    disabled={relationshipStatus === "loading"}
                  >
                    <Network size={15} aria-hidden="true" />
                    {copy.loadRelationships}
                  </button>
                </div>
                <RelationshipGraphResults
                  copy={copy}
                  language={language}
                  status={relationshipStatus}
                  error={relationshipError}
                  result={relationshipResult}
                />
              </div>
            </div>

            <div className="panel">
              <div className="panel__header">
                <h2>{copy.relationshipSeeds}</h2>
                <Network size={18} aria-hidden="true" />
              </div>
              <div className="panel__body intelligence-relation-grid" aria-label={copy.relationshipSeeds}>
                <RelationSeed
                  label={copy.documentTypeRelation}
                  buckets={summary.by_document_type}
                />
                <RelationSeed
                  label={copy.classificationRelation}
                  buckets={summary.by_classification}
                />
                <RelationSeed label={copy.statusRelation} buckets={summary.by_status} />
              </div>
            </div>
          </section>
        ) : null}

        {activeSection === "quality" ? (
          <section className="panel">
            <div className="panel__header">
              <h2>{copy.readinessSignals}</h2>
              <ShieldCheck size={18} aria-hidden="true" />
            </div>
            <div className="panel__body stack">
              <SignalList
                title={copy.topIssues}
                buckets={readiness.issue_counts}
                emptyLabel={copy.noSignals}
              />
              <IssueSamples
                issues={readiness.issues}
                emptyLabel={copy.noSignals}
              />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function QueryComposer({
  copy,
  input,
  onAddSuggestion,
  onApply,
  onClear,
  onInputChange,
  onRecovery,
  onRemoveToken,
  onRun,
  plan,
  preview,
  previewQuery,
  suggestionStatus,
  suggestions,
  tokens,
  validation,
}: {
  copy: Record<string, string>;
  input: string;
  onAddSuggestion: (suggestion: QuerySuggestion) => void;
  onApply: () => void;
  onClear: () => void;
  onInputChange: (value: string) => void;
  onRecovery: (action: QueryComposerRecoveryAction) => void;
  onRemoveToken: (tokenId: string) => void;
  onRun: () => void;
  plan: QueryComposerPlan | null;
  preview: QueryComposerPreview | null;
  previewQuery: string;
  suggestionStatus: "idle" | "loading" | "ready" | "partial" | "fallback";
  suggestions: QuerySuggestion[];
  tokens: QueryComposerToken[];
  validation: QueryComposerValidationIssue[];
}) {
  const groupedSuggestions = groupSuggestionsByLabel(suggestions);
  const firstSuggestion = suggestions[0];
  const blockingIssue = validation.find((issue) => issue.severity === "error");
  const visibleValidation = validation.filter((issue) => issue.severity !== "info").slice(0, 3);

  return (
    <section className="query-composer" aria-label={copy.queryComposer}>
      <div className="query-composer__header">
        <div>
          <h3>{copy.queryComposer}</h3>
          <p>{copy.queryComposerDetail}</p>
        </div>
        <div className="query-composer__actions">
          <button className="button" type="button" onClick={onApply} disabled={!previewQuery.trim()}>
            {copy.composerApply}
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={onRun}
            disabled={!previewQuery.trim() || plan?.can_run === false || suggestionStatus === "loading"}
          >
            <Search size={15} aria-hidden="true" />
            {copy.composerRun}
          </button>
        </div>
      </div>

      <div className="query-composer__builder" aria-label={copy.composerTokens}>
        {tokens.length > 0 ? (
          <div className="query-composer__tokens">
            {tokens.map((token) => (
              <button
                className={`query-composer-token query-composer-token--${token.type}`}
                key={token.id}
                onClick={() => onRemoveToken(token.id)}
                title={`${tokenTypeLabel(token.type, copy)}: ${token.value}`}
                type="button"
              >
                <span>{tokenTypeLabel(token.type, copy)}</span>
                <strong>{token.value}</strong>
                <b aria-hidden="true">×</b>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">{copy.composerEmpty}</p>
        )}
        <label className="query-composer__input" htmlFor="intelligence-query-composer-input">
          <Search size={16} aria-hidden="true" />
          <input
            id="intelligence-query-composer-input"
            type="text"
            value={input}
            placeholder={copy.composerPlaceholder}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && firstSuggestion) {
                event.preventDefault();
                onAddSuggestion(firstSuggestion);
              }
            }}
          />
        </label>
      </div>

      <div className="query-composer__preview">
        <span>{copy.composerPreview}</span>
        <code>{previewQuery || "..."}</code>
        {tokens.length > 0 || input.trim() ? (
          <button className="query-composer__clear" type="button" onClick={onClear}>
            {copy.composerClear}
          </button>
        ) : null}
      </div>

      <div className="query-composer__plan">
        <span className={`query-composer__state query-composer__state--${suggestionStatus}`}>
          {suggestionStatusLabel(suggestionStatus, copy)}
        </span>
        {plan ? (
          <span>
            {modeLabel(plan.query_mode, copy)}
            {" · "}
            {copy.composerCost}: {costLabel(plan.estimated_cost, copy)}
            {" · "}
            {copy.composerClauses}: {plan.clause_count}
          </span>
        ) : null}
        {preview?.status === "ready" && preview.total_hits !== null ? (
          <strong className={preview.total_hits === 0 ? "query-composer__estimate is-empty" : "query-composer__estimate"}>
            {copy.composerEstimatedResults}: {preview.total_hits.toLocaleString()}
          </strong>
        ) : preview?.status === "unavailable" ? (
          <span className="query-composer__estimate is-unavailable">{copy.composerPreviewUnavailable}</span>
        ) : null}
      </div>

      {preview?.status === "ready" && preview.total_hits === 0 ? (
        <div className="query-composer__recovery" role="status">
          <strong>{copy.composerNoEstimatedResults}</strong>
          {preview.recovery_actions.length > 0 ? (
            <div>
              <span>{copy.composerRecovery}</span>
              {preview.recovery_actions.map((action) => (
                <button key={action.id} type="button" onClick={() => onRecovery(action)}>
                  <strong>{action.label}</strong>
                  <small>
                    {action.detail}
                    {action.total_hits !== null ? ` · ${action.total_hits.toLocaleString()}` : ""}
                  </small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {blockingIssue || visibleValidation.length > 0 ? (
        <div className="query-composer__validation" role={blockingIssue ? "alert" : "status"}>
          {visibleValidation.map((issue) => (
            <span className={`query-composer__issue query-composer__issue--${issue.severity}`} key={`${issue.code}:${issue.position ?? issue.token_id ?? issue.message}`}>
              {issue.message}
            </span>
          ))}
        </div>
      ) : null}

      <div className="query-composer__suggestions" aria-label={copy.composerSuggestions}>
        {groupedSuggestions.map(([group, groupSuggestions]) => (
          <div className="query-composer__suggestion-group" key={group}>
            <h4>{group}</h4>
            <div>
              {groupSuggestions.map((suggestion) => (
                <button
                  className={`query-composer-suggestion query-composer-suggestion--${suggestion.type}`}
                  key={suggestion.id}
                  onClick={() => onAddSuggestion(suggestion)}
                  type="button"
                >
                  <span>{suggestion.label}</span>
                  <small>{suggestion.detail}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function composerTokenToServer(token: QueryComposerToken): QueryComposerTokenInput {
  return {
    id: token.id,
    type: token.type,
    label: token.label,
    value: token.value,
    query_fragment: token.queryFragment,
    entity_type: token.entityType,
    entity_value: token.entityValue,
    mode: token.mode,
    field: token.field,
  };
}

function suggestionStatusLabel(
  status: "idle" | "loading" | "ready" | "partial" | "fallback",
  copy: Record<string, string>,
): string {
  if (status === "ready") return copy.composerServerReady;
  if (status === "partial") return copy.composerServerPartial;
  if (status === "fallback") return copy.composerLocalFallback;
  if (status === "loading") return copy.composerValidating;
  return copy.composerStart;
}

function modeLabel(mode: AnalystSearchMode, copy: Record<string, string>): string {
  if (mode === "boolean") return copy.modeBoolean;
  if (mode === "phrase") return copy.modePhrase;
  if (mode === "proximity") return copy.modeProximity;
  if (mode === "fielded") return copy.modeFielded;
  return copy.modeSmart;
}

function costLabel(cost: QueryComposerPlan["estimated_cost"], copy: Record<string, string>): string {
  if (cost === "high") return copy.composerCostHigh;
  if (cost === "medium") return copy.composerCostMedium;
  return copy.composerCostLow;
}

function buildQuerySuggestions({
  input,
  documents,
  candidateSignals,
  entityFacets,
  cases,
  activeCase,
  copy,
  language,
}: {
  input: string;
  documents: Document[];
  candidateSignals: CandidateSignal[];
  entityFacets: EntityFacetReport;
  cases: AnalystCase[];
  activeCase: AnalystCase | null;
  copy: Record<string, string>;
  language: AklLanguage;
}): QuerySuggestion[] {
  const rawInput = input.trim();
  const normalizedInput = normalizeSuggestionText(rawInput);
  const suggestions: QuerySuggestion[] = [];
  const seen = new Set<string>();
  const addSuggestion = (suggestion: QuerySuggestion) => {
    const key = `${suggestion.type}:${suggestion.queryFragment}:${suggestion.label}`.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    suggestions.push(suggestion);
  };

  if (rawInput) {
    addSuggestion({
      id: `builder:term:${rawInput}`,
      type: "term",
      group: copy.suggestionGroupBuilder,
      label: `${copy.composerUseText}: ${rawInput}`,
      detail: copy.tokenTerm,
      value: rawInput,
      queryFragment: rawInput,
    });
    addSuggestion({
      id: `builder:phrase:${rawInput}`,
      type: "phrase",
      group: copy.suggestionGroupBuilder,
      label: `${copy.composerUsePhrase}: ${rawInput}`,
      detail: copy.tokenPhrase,
      value: rawInput,
      queryFragment: quoteQueryValue(rawInput),
      mode: "phrase",
    });
    for (const field of Object.keys(ANALYST_FIELD_ALIASES) as Array<Exclude<AnalystSearchField, "all">>) {
      addSuggestion({
        id: `field:${field}:${rawInput}`,
        type: "field",
        group: copy.suggestionGroupFields,
        label: `${fieldLabel(field, copy)}: ${rawInput}`,
        detail: `${copy.tokenField} · ${ANALYST_FIELD_ALIASES[field]}:`,
        value: rawInput,
        queryFragment: `${ANALYST_FIELD_ALIASES[field]}:${quoteQueryValue(rawInput)}`,
        field,
        mode: "fielded",
      });
    }
  }

  for (const operator of ["AND", "OR", "NOT"]) {
    if (!rawInput || operator.toLowerCase().startsWith(normalizedInput)) {
      addSuggestion({
        id: `operator:${operator}`,
        type: "operator",
        group: copy.suggestionGroupOperators,
        label: operator,
        detail: copy.tokenOperator,
        value: operator,
        queryFragment: operator,
        mode: "boolean",
      });
    }
  }

  const activeSavedQueries = activeCase?.saved_queries ?? [];
  for (const savedQuery of [...activeSavedQueries, ...cases.flatMap((analystCase) => analystCase.saved_queries)].slice(0, 24)) {
    if (!rawInput || suggestionMatches(savedQuery.title, normalizedInput) || suggestionMatches(savedQuery.query_text, normalizedInput)) {
      addSuggestion({
        id: `saved:${savedQuery.saved_query_id}`,
        type: "saved_query",
        group: copy.suggestionGroupCases,
        label: savedQuery.title,
        detail: savedQuery.query_mode,
        value: savedQuery.query_text,
        queryFragment: savedQuery.query_text,
        mode: savedQuery.query_mode,
      });
    }
  }

  for (const group of entityFacets.entity_groups.slice(0, 12)) {
    for (const value of group.values.slice(0, 8)) {
      const label = value.label || value.key;
      if (!rawInput || suggestionMatches(label, normalizedInput) || suggestionMatches(group.label, normalizedInput)) {
        addSuggestion({
          id: `entity:${group.entity_type}:${value.key}`,
          type: "entity",
          group: copy.suggestionGroupEntities,
          label,
          detail: entityTypeLabel(group.entity_type, language),
          value: value.key,
          queryFragment: `entity:${quoteQueryValue(value.key)}`,
          entityType: group.entity_type,
          entityValue: value.key,
          field: "entity",
          mode: "fielded",
        });
      }
    }
  }

  for (const candidate of candidateSignals.slice(0, 30)) {
    if (!rawInput || suggestionMatches(candidate.label, normalizedInput)) {
      addSuggestion({
        id: `candidate:${candidate.id}`,
        type: candidate.type === "document_number" ? "entity" : "term",
        group: copy.suggestionGroupDictionary,
        label: candidate.label,
        detail: candidateTypeLabel(candidate.type, copy),
        value: candidate.label,
        queryFragment:
          candidate.type === "document_number"
            ? `entity:${quoteQueryValue(candidate.label)}`
            : quoteQueryValue(candidate.label),
        entityType: candidate.type === "document_number" ? "document_number" : undefined,
        entityValue: candidate.type === "document_number" ? candidate.label : undefined,
        mode: candidate.type === "document_number" ? "fielded" : "phrase",
      });
    }
  }

  for (const document of documents.slice(0, 40)) {
    const values = [
      { label: document.title, detail: copy.fieldTitle, fragment: `title:${quoteQueryValue(document.title)}`, field: "title" as const },
      { label: document.document_id, detail: copy.document, fragment: quoteQueryValue(document.document_id), field: undefined },
      { label: document.gestor_unit ?? document.owner, detail: copy.owners, fragment: quoteQueryValue(document.gestor_unit ?? document.owner), field: undefined },
      ...document.tags.slice(0, 3).map((tag) => ({
        label: tag,
        detail: copy.tag,
        fragment: quoteQueryValue(tag),
        field: undefined,
      })),
    ];
    for (const value of values) {
      if (value.label && (!rawInput || suggestionMatches(value.label, normalizedInput))) {
        addSuggestion({
          id: `document:${document.document_id}:${value.detail}:${value.label}`,
          type: value.field ? "field" : "term",
          group: copy.suggestionGroupDictionary,
          label: value.label,
          detail: value.detail,
          value: value.label,
          queryFragment: value.fragment,
          field: value.field,
          mode: value.field ? "fielded" : "phrase",
        });
      }
    }
  }

  return suggestions.slice(0, 36);
}

function groupSuggestionsByLabel(suggestions: QuerySuggestion[]): Array<[string, QuerySuggestion[]]> {
  const groups = new Map<string, QuerySuggestion[]>();
  for (const suggestion of suggestions) {
    const current = groups.get(suggestion.group) ?? [];
    if (current.length < 8) {
      current.push(suggestion);
      groups.set(suggestion.group, current);
    }
  }
  return [...groups.entries()];
}

function composeQueryFromTokens(tokens: QueryComposerToken[], input: string): string {
  const fragments = tokens.map((token) => token.queryFragment.trim()).filter(Boolean);
  const trailingInput = input.trim();
  if (trailingInput) {
    fragments.push(trailingInput);
  }
  return fragments.join(" ").replace(/\s+/g, " ").trim();
}

function quoteQueryValue(value: string): string {
  const escaped = value.trim().replaceAll('"', '\\"');
  if (!escaped) {
    return "";
  }
  return /[\s:/()]/.test(escaped) ? `"${escaped}"` : escaped;
}

function normalizeSuggestionText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function suggestionMatches(value: string | null | undefined, normalizedInput: string): boolean {
  if (!normalizedInput) {
    return true;
  }
  return normalizeSuggestionText(value ?? "").includes(normalizedInput);
}

function fieldLabel(field: Exclude<AnalystSearchField, "all">, copy: Record<string, string>): string {
  if (field === "title") return copy.fieldTitle;
  if (field === "body") return copy.fieldBody;
  if (field === "section") return copy.fieldSection;
  if (field === "entity") return copy.fieldEntity;
  return copy.fieldSource;
}

function tokenTypeLabel(type: QueryTokenType, copy: Record<string, string>): string {
  if (type === "phrase") return copy.tokenPhrase;
  if (type === "field") return copy.tokenField;
  if (type === "entity") return copy.tokenEntity;
  if (type === "operator") return copy.tokenOperator;
  if (type === "saved_query") return copy.tokenSavedQuery;
  return copy.tokenTerm;
}

function EntityValueGroups({
  title,
  report,
  language,
  emptyLabel,
  selectLabel,
  onSelect,
}: {
  title: string;
  report: EntityFacetReport;
  language: AklLanguage;
  emptyLabel: string;
  selectLabel: string;
  onSelect: (entityType: string, entityValue: string) => void;
}) {
  if (report.entity_groups.length === 0) {
    return (
      <div className="intelligence-facet-column">
        <h3>{title}</h3>
        <p className="muted">{emptyLabel}</p>
      </div>
    );
  }
  return (
    <div className="intelligence-facet-column">
      <h3>{title}</h3>
      <div className="intelligence-signal-list">
        {report.entity_groups.slice(0, 6).map((group) => (
          <div className="intelligence-signal" key={group.entity_type}>
            <span>
              <strong>{entityGroupLabel(group, language)}</strong>
              <small>
                {group.values.slice(0, 3).map((value) => (
                  <button
                    className="intelligence-entity-value-button"
                    key={value.key}
                    type="button"
                    title={`${selectLabel}: ${value.label}`}
                    onClick={() => onSelect(group.entity_type, value.key)}
                  >
                    {value.label}
                  </button>
                ))}
              </small>
            </span>
            <b>{formatNumber(group.count, language)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalystSearchResults({
  copy,
  language,
  status,
  error,
  result,
  recoveryActions,
  onRecovery,
  onAddEvidence,
}: {
  copy: Record<string, string>;
  language: AklLanguage;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  result: AnalystSearchResponse | null;
  recoveryActions: QueryComposerRecoveryAction[];
  onRecovery: (action: QueryComposerRecoveryAction) => void;
  onAddEvidence?: (hit: EntitySearchHit) => void;
}) {
  if (status === "idle") {
    return <p className="muted">{copy.analystIdle}</p>;
  }
  if (status === "loading") {
    return <p className="muted" role="status">{copy.analystLoading}</p>;
  }
  if (status === "error") {
    return <p className="notice notice--danger" role="alert">{error ?? copy.analystError}</p>;
  }
  if (!result || result.hits.length === 0) {
    return (
      <div className="intelligence-search-empty">
        <Search size={20} aria-hidden="true" />
        <strong>{copy.analystEmpty}</strong>
        {recoveryActions.map((action) => (
          <button className="button" key={action.id} type="button" onClick={() => onRecovery(action)}>
            {action.label}
            {action.total_hits !== null ? ` (${action.total_hits.toLocaleString()})` : ""}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="intelligence-evidence-results" aria-label={copy.advancedAnalystSearch}>
      {result.hits.map((hit) => (
        <EvidenceSearchHitCard
          copy={copy}
          hit={hit}
          key={hit.chunk_id}
          language={language}
          onAddEvidence={onAddEvidence}
        />
      ))}
    </div>
  );
}

function EvidenceSearchResults({
  copy,
  language,
  status,
  error,
  result,
  onAddEvidence,
}: {
  copy: Record<string, string>;
  language: AklLanguage;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  result: EntitySearchResponse | null;
  onAddEvidence?: (hit: EntitySearchHit) => void;
}) {
  if (status === "idle") {
    return <p className="muted">{copy.evidenceIdle}</p>;
  }
  if (status === "loading") {
    return <p className="muted" role="status">{copy.evidenceLoading}</p>;
  }
  if (status === "error") {
    return <p className="notice notice--danger" role="alert">{error ?? copy.evidenceError}</p>;
  }
  if (!result || result.hits.length === 0) {
    return <p className="muted">{copy.evidenceEmpty}</p>;
  }

  return (
    <div className="intelligence-evidence-results" aria-label={copy.evidenceResults}>
      {result.hits.map((hit) => (
        <EvidenceSearchHitCard
          copy={copy}
          hit={hit}
          key={hit.chunk_id}
          language={language}
          onAddEvidence={onAddEvidence}
        />
      ))}
    </div>
  );
}

function EvidenceSearchHitCard({
  copy,
  hit,
  language,
  onAddEvidence,
}: {
  copy: Record<string, string>;
  hit: EntitySearchHit;
  language: AklLanguage;
  onAddEvidence?: (hit: EntitySearchHit) => void;
}) {
  const location = [
    hit.page_number ? `${copy.page} ${hit.page_number}` : null,
    hit.section_title ? `${copy.section}: ${hit.section_title}` : null,
    hit.section_path.length > 0 ? hit.section_path.join(" / ") : null,
  ].filter(Boolean);
  return (
    <article className="intelligence-evidence-hit">
      <div className="intelligence-evidence-hit__header">
        <span>
          <strong>{hit.document_title}</strong>
          <small>
            {hit.document_id} · {copy.version}: {hit.version_label ?? hit.document_version_id}
          </small>
        </span>
        <StratosButtonLink href={`/documents/${hit.document_id}`}>
          {copy.open}
          <ArrowUpRight size={15} aria-hidden="true" />
        </StratosButtonLink>
      </div>
      <p>{hit.snippet}</p>
      {onAddEvidence ? (
        <div className="intelligence-evidence-actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => onAddEvidence(hit)}
          >
            {copy.addToCase}
          </button>
        </div>
      ) : null}
      <div className="intelligence-evidence-meta">
        <span>{copy.score}: {hit.score.toFixed(2)}</span>
        {location.length > 0 ? <span>{location.join(" · ")}</span> : null}
        {hit.source_file_name ? <span>{copy.source}: {hit.source_file_name}</span> : null}
      </div>
      {hit.entity_pairs.length > 0 ? (
        <div className="intelligence-evidence-entities">
          {hit.entity_pairs.slice(0, 8).map((pair) => (
            <span key={pair}>{entityPairLabel(pair, language)}</span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function RelationshipGraphResults({
  copy,
  language,
  status,
  error,
  result,
}: {
  copy: Record<string, string>;
  language: AklLanguage;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  result: EntityRelationshipResponse | null;
}) {
  if (status === "idle") {
    return <p className="muted">{copy.relationshipIdle}</p>;
  }
  if (status === "loading") {
    return <p className="muted" role="status">{copy.relationshipLoading}</p>;
  }
  if (status === "error") {
    return <p className="notice notice--danger" role="alert">{error ?? copy.relationshipError}</p>;
  }
  if (!result || result.edges.length === 0) {
    return <p className="muted">{copy.relationshipEmpty}</p>;
  }

  return (
    <div className="intelligence-evidence-results" aria-label={copy.relationshipResults}>
      {result.edges.map((edge) => (
        <RelationshipEdgeCard copy={copy} edge={edge} key={edge.edge_id} language={language} />
      ))}
    </div>
  );
}

function RelationshipEdgeCard({
  copy,
  edge,
  language,
}: {
  copy: Record<string, string>;
  edge: EntityRelationshipEdge;
  language: AklLanguage;
}) {
  return (
    <article className="intelligence-evidence-hit">
      <div className="intelligence-evidence-hit__header">
        <span>
          <strong>
            {relationshipEndpointLabel(edge.source, language)} ↔ {relationshipEndpointLabel(edge.target, language)}
          </strong>
          <small>{copy.relationshipTypeCoOccurs}</small>
        </span>
      </div>
      <div className="intelligence-evidence-meta">
        <span>{copy.evidenceCount}: {formatNumber(edge.evidence_count, language)}</span>
        <span>{copy.documentsCount}: {formatNumber(edge.document_count, language)}</span>
        <span>{copy.confidence}: {Math.round(edge.confidence * 100)}%</span>
      </div>
      {edge.evidence.slice(0, 2).map((item) => (
        <div className="intelligence-relationship-evidence" key={item.chunk_id}>
          <span>
            <strong>{item.document_title}</strong>
            <small>
              {item.document_id} · {copy.version}: {item.version_label ?? item.document_version_id}
            </small>
          </span>
          <p>{item.snippet}</p>
          <div className="intelligence-evidence-meta">
            {item.page_number ? <span>{copy.page} {item.page_number}</span> : null}
            {item.section_title ? <span>{copy.section}: {item.section_title}</span> : null}
            {item.source_file_name ? <span>{copy.source}: {item.source_file_name}</span> : null}
            <StratosButtonLink href={`/documents/${item.document_id}`}>
              {copy.open}
              <ArrowUpRight size={15} aria-hidden="true" />
            </StratosButtonLink>
          </div>
        </div>
      ))}
    </article>
  );
}

function FacetColumn({
  title,
  buckets,
}: {
  title: string;
  buckets: DocumentMetadataSummaryBucket[];
}) {
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
  return (
    <div className="intelligence-facet-column">
      <h3>{title}</h3>
      <div className="intelligence-bucket-list">
        {buckets.slice(0, 8).map((bucket) => (
          <div className="intelligence-bucket" key={bucket.key}>
            <span>{bucket.label}</span>
            <b>{bucket.count}</b>
            <i style={{ inlineSize: `${Math.max((bucket.count / max) * 100, 6)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SignalList({
  title,
  buckets,
  emptyLabel,
}: {
  title: string;
  buckets: DocumentMetadataSummaryBucket[];
  emptyLabel: string;
}) {
  return (
    <div>
      <h3 className="panel-subtitle">{title}</h3>
      {buckets.length > 0 ? (
        <div className="intelligence-signal-list">
          {buckets.slice(0, 8).map((bucket) => (
            <div className="intelligence-signal" key={bucket.key}>
              <span>{bucket.label}</span>
              <b>{bucket.count}</b>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">{emptyLabel}</p>
      )}
    </div>
  );
}

function IssueSamples({
  issues,
  emptyLabel,
}: {
  issues: DocumentReadinessIssue[];
  emptyLabel: string;
}) {
  if (issues.length === 0) {
    return <p className="muted">{emptyLabel}</p>;
  }
  return (
    <div className="intelligence-issue-list">
      {issues.slice(0, 6).map((issue) => (
        <div className="intelligence-issue" key={`${issue.document_id}-${issue.code}`}>
          <StatusBadge value={issue.severity} />
          <span>
            <strong>{issue.code}</strong>
            <small>{issue.title}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function RelationSeed({
  label,
  buckets,
}: {
  label: string;
  buckets: DocumentMetadataSummaryBucket[];
}) {
  return (
    <div className="intelligence-relation">
      <span>{label}</span>
      <strong>{buckets[0]?.label ?? "n/a"}</strong>
      <small>{buckets[0]?.count ?? 0}</small>
    </div>
  );
}

function entityGroupLabel(group: EntityFacetReport["entity_groups"][number], language: AklLanguage): string {
  return entityTypeLabel(group.entity_type, language) === group.entity_type
    ? group.label
    : pluralEntityTypeLabel(group.entity_type, language);
}

function entityTypeLabel(entityType: string, language: AklLanguage): string {
  const labels: Record<string, Record<AklLanguage, string>> = {
    document_number: { cs: "Číslo dokumentu", en: "Document number" },
    email: { cs: "E-mail", en: "Email" },
    url: { cs: "URL", en: "URL" },
    ipv4: { cs: "IPv4", en: "IPv4" },
    phone: { cs: "Telefon", en: "Phone" },
    date: { cs: "Datum", en: "Date" },
  };
  return labels[entityType]?.[language] ?? entityType;
}

function pluralEntityTypeLabel(entityType: string, language: AklLanguage): string {
  const labels: Record<string, Record<AklLanguage, string>> = {
    document_number: { cs: "Čísla dokumentů", en: "Document numbers" },
    email: { cs: "E-maily", en: "Emails" },
    url: { cs: "URL", en: "URLs" },
    ipv4: { cs: "IPv4", en: "IPv4" },
    phone: { cs: "Telefony", en: "Phones" },
    date: { cs: "Data", en: "Dates" },
  };
  return labels[entityType]?.[language] ?? entityType;
}

function entityPairLabel(pair: string, language: AklLanguage): string {
  const [type, ...valueParts] = pair.split(":");
  const value = valueParts.join(":");
  return value ? `${entityTypeLabel(type, language)}: ${value}` : pair;
}

function relationshipEndpointLabel(
  endpoint: EntityRelationshipEdge["source"],
  language: AklLanguage,
): string {
  return `${entityTypeLabel(endpoint.entity_type, language)}: ${endpoint.entity_value}`;
}

function documentSearchText(document: Document, language: AklLanguage): string {
  return [
    document.title,
    document.document_id,
    document.owner,
    document.owner_id,
    document.gestor_unit ?? "",
    document.document_type,
    documentTypeLabel(document.document_type, language),
    document.status,
    document.classification,
    ...document.tags,
    JSON.stringify(document.metadata ?? {}),
  ]
    .join(" ")
    .toLowerCase();
}

function documentSignalLabel(
  document: Document,
  issues: DocumentReadinessIssue[],
): string {
  const issue = issues.find((candidate) => candidate.document_id === document.document_id);
  if (issue) {
    return issue.code;
  }
  if (document.tags.length > 0) {
    return document.tags.slice(0, 2).join(", ");
  }
  return document.gestor_unit ?? document.owner;
}

function deriveCandidateSignals(documents: Document[]): CandidateSignal[] {
  const counts = new Map<string, CandidateSignal>();
  for (const document of documents) {
    addCandidate(counts, "owner", document.gestor_unit ?? document.owner, 1);
    for (const tag of document.tags) {
      addCandidate(counts, "tag", tag, 1);
    }
    for (const value of documentNumberValues(document)) {
      addCandidate(counts, "document_number", value, 1);
    }
    const externalSystem = externalMetadataValue(document, "external_system");
    if (externalSystem) {
      addCandidate(counts, "external_system", externalSystem, 1);
    }
  }
  return [...counts.values()].sort(
    (left, right) => right.count - left.count || left.label.localeCompare(right.label, "cs"),
  );
}

function addCandidate(
  counts: Map<string, CandidateSignal>,
  type: CandidateSignal["type"],
  label: string | null | undefined,
  count: number,
) {
  const normalized = label?.trim();
  if (!normalized) {
    return;
  }
  const id = `${type}:${normalized.toLowerCase()}`;
  const current = counts.get(id);
  if (current) {
    current.count += count;
    return;
  }
  counts.set(id, { id, type, label: normalized, count });
}

function documentNumberValues(document: Document): string[] {
  const metadata = document.metadata ?? {};
  return [
    metadata.document_number,
    metadata.doc_number,
    metadata.number,
    metadata.contract_number,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function externalMetadataValue(document: Document, key: string): string | null {
  const external = document.metadata?.external;
  if (!external || typeof external !== "object" || Array.isArray(external)) {
    return null;
  }
  const value = (external as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function candidateTypeLabel(type: CandidateSignal["type"], copy: Record<string, string>) {
  if (type === "document_number") {
    return copy.documentNumber;
  }
  if (type === "owner") {
    return copy.owner;
  }
  if (type === "external_system") {
    return copy.externalSystem;
  }
  return copy.tag;
}

function isIntelligenceSectionId(value: string): value is IntelligenceSectionId {
  return INTELLIGENCE_SECTION_IDS.includes(value as IntelligenceSectionId);
}
