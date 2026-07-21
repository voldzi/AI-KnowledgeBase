import { createHash } from "node:crypto";

export const DIRECTOR_COPILOT_CONTRACT_VERSION = "director-copilot-1" as const;
export const DIRECTOR_COPILOT_QUERY_PLAN_VERSION = "director-copilot-query-plan-2" as const;
export const DIRECTOR_COPILOT_EVIDENCE_VERSION = "director-copilot-evidence-1" as const;
export const DIRECTOR_COPILOT_SNAPSHOT_VERSION = "director-copilot-analysis-snapshot-1" as const;

export const DOMAIN_TOOL_IDS = {
  budget: "budget.project_financial_snapshot.v1",
  projectflow: "projectflow.project_delivery_snapshot.v1",
} as const;

export type DomainApplication = keyof typeof DOMAIN_TOOL_IDS;
export type DomainToolId = (typeof DOMAIN_TOOL_IDS)[DomainApplication];
export type DomainSourceSystem = "STRATOS_BUDGET" | "STRATOS_PROJECTFLOW";
export type EvidenceSourceSystem = DomainSourceSystem | "STRATOS_AKB";
export type HandlingClass = "PUBLIC" | "INTERNAL" | "PROJECT_MANAGEMENT" | "RESTRICTED";
export type PolicyObligation =
  | "AUDIT_ACCESS"
  | "NO_EXTERNAL_AI"
  | "LOCAL_PROCESSING_ONLY"
  | "NO_PUBLIC_EXPORT"
  | "NO_EXPORT"
  | "WATERMARK"
  | "ENCRYPT_AT_REST"
  | "RECIPIENT_CONFIRMATION"
  | "ORIGINATOR_APPROVAL"
  | "PAP_ENFORCEMENT";
export type ScopeType = "own" | "public" | "organization" | "organization_unit" | "budget_scope" | "portfolio" | "project" | "document" | "recipient_set";

export interface ScopeCoordinate {
  type: ScopeType;
  id?: string;
}

export interface InformationClassification {
  handling_class: HandlingClass;
  legal_classification: "NONE";
  tlp: "TLP:RED" | "TLP:AMBER+STRICT" | "TLP:AMBER" | "TLP:GREEN" | "TLP:CLEAR" | null;
  pap: "PAP:RED" | "PAP:AMBER" | "PAP:GREEN" | "PAP:CLEAR" | null;
}

export interface SourcePolicy {
  binding_id: string;
  version: "information-policy-2.0.0";
  hash: string;
  classification: InformationClassification;
  audience: string[];
  obligations: PolicyObligation[];
}

export interface DomainFact {
  key: string;
  value: string | number | boolean | null;
  value_type: "text" | "number" | "integer" | "boolean" | "date" | "datetime" | "currency" | "percent" | "duration_days";
  unit?: string | null;
  currency?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  quality?: number;
}

export interface DomainToolItem {
  entity_type: string;
  entity_id: string;
  canonical_id: string;
  authorized_scope: ScopeCoordinate;
  source_version: string;
  as_of: string;
  facts: DomainFact[];
  deep_link: string;
  document_context_tags: string[];
  policy: SourcePolicy;
}

export interface DomainToolRequest {
  schema_version: typeof DIRECTOR_COPILOT_CONTRACT_VERSION;
  tool_id: DomainToolId;
  tool_call_id: string;
  plan_id: string;
  organization_id: "org_stratos";
  actor: { type: "person"; subject_id: string };
  requested_at: string;
  requested_scopes: ScopeCoordinate[];
  parameters: {
    as_of?: string;
    project_ids?: string[];
    portfolio_ids?: string[];
    cursor?: string | null;
    limit?: number;
  };
}

export interface DomainToolResponse {
  schema_version: typeof DIRECTOR_COPILOT_CONTRACT_VERSION;
  tool_id: DomainToolId;
  tool_call_id: string;
  status: "complete" | "partial" | "unavailable" | "not_authorized";
  generated_at: string;
  as_of: string;
  source_system: DomainSourceSystem;
  source_version: string;
  items: DomainToolItem[];
  warnings: string[];
  next_cursor: string | null;
}

export interface EvidenceItem {
  schema_version: typeof DIRECTOR_COPILOT_EVIDENCE_VERSION;
  evidence_id: string;
  type: "structured_fact" | "document_finding" | "interpretation" | "uncertainty";
  source_system: EvidenceSourceSystem;
  entity_type: string;
  entity_id: string;
  canonical_id: string;
  source_version: string;
  as_of: string;
  retrieved_at: string;
  authorized_scope: ScopeCoordinate;
  deep_link: string;
  policy: SourcePolicy;
  source_hash: string;
  quality: number;
  fact?: DomainFact;
  document_citation?: {
    document_id: string;
    document_version_id: string;
    chunk_id: string;
    page_number: number | null;
    section_path: string[];
  };
  statement?: string;
  input_evidence_ids?: string[];
  uncertainty_code?: "SOURCE_UNAVAILABLE" | "NOT_AUTHORIZED" | "STALE" | "CONFLICT" | "MISSING" | "AMBIGUOUS_ENTITY" | "UNSUPPORTED_POLICY";
}

export interface DirectorQueryPlanNode {
  node_id: string;
  tool_id: DomainToolId | "akb.contract_risk_retrieval.v1";
  source_application: DomainApplication | "akb";
  required_capability: "budget:read" | "projectflow:read" | "akb:chat";
  requested_scopes: ScopeCoordinate[];
  depends_on: string[];
  timeout_ms: number;
}

export interface DirectorQueryPlan {
  schema_version: typeof DIRECTOR_COPILOT_QUERY_PLAN_VERSION;
  plan_id: string;
  intent: "portfolio_risk_correlation";
  language: "cs" | "en";
  created_at: string;
  as_of: string;
  projection_hash: string;
  nodes: DirectorQueryPlanNode[];
  output: {
    kind: "answer";
    four_layer_answer: true;
    artifact_contract_version: "report.v2";
  };
  quality_gates: {
    structured_facts_required: true;
    document_citations_required: true;
    partial_must_be_visible: true;
    no_scope_expansion: true;
  };
}

export interface StrictestPolicy {
  classification: InformationClassification;
  audience_mode: "all_source_policies_required";
  audience: string[];
  obligations: PolicyObligation[];
  source_policies: Array<{
    source_system: EvidenceSourceSystem;
    binding_id: string;
    version: "information-policy-2.0.0";
    hash: string;
  }>;
}

export interface AnalysisSnapshot {
  schema_version: typeof DIRECTOR_COPILOT_SNAPSHOT_VERSION;
  snapshot_id: string;
  created_at: string;
  correlation_id: string;
  plan: DirectorQueryPlan;
  projection_hash: string;
  evidence: EvidenceItem[];
  unavailable_sources: Array<{
    source: EvidenceSourceSystem;
    status: "partial" | "unavailable" | "not_authorized";
    code: string;
  }>;
  strictest_policy: StrictestPolicy;
  document_context_tags: string[];
  document_context_bindings: Array<{
    canonical_id: string;
    tags: string[];
  }>;
  snapshot_hash: string;
}

export class DirectorCopilotContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "DirectorCopilotContractError";
  }
}

const RESPONSE_FIELDS = new Set(["schema_version", "tool_id", "tool_call_id", "status", "generated_at", "as_of", "source_system", "source_version", "items", "warnings", "next_cursor"]);
const ITEM_FIELDS = new Set(["entity_type", "entity_id", "canonical_id", "authorized_scope", "source_version", "as_of", "facts", "deep_link", "document_context_tags", "policy"]);
const FACT_FIELDS = new Set(["key", "value", "value_type", "unit", "currency", "period_start", "period_end", "quality"]);
const POLICY_FIELDS = new Set(["binding_id", "version", "hash", "classification", "audience", "obligations"]);
const CLASSIFICATION_FIELDS = new Set(["handling_class", "legal_classification", "tlp", "pap"]);
const SCOPE_FIELDS = new Set(["type", "id"]);
const STATUS_VALUES = new Set(["complete", "partial", "unavailable", "not_authorized"]);
const HANDLING_CLASSES = new Set(["PUBLIC", "INTERNAL", "PROJECT_MANAGEMENT", "RESTRICTED"]);
const OBLIGATIONS = new Set([
  "AUDIT_ACCESS", "NO_EXTERNAL_AI", "LOCAL_PROCESSING_ONLY", "NO_PUBLIC_EXPORT",
  "NO_EXPORT", "WATERMARK", "ENCRYPT_AT_REST", "RECIPIENT_CONFIRMATION",
  "ORIGINATOR_APPROVAL", "PAP_ENFORCEMENT",
]);
const SCOPE_TYPES = new Set(["own", "public", "organization", "organization_unit", "budget_scope", "portfolio", "project", "document", "recipient_set"]);
const FACT_TYPES = new Set(["text", "number", "integer", "boolean", "date", "datetime", "currency", "percent", "duration_days"]);
const TOOL_FACT_TYPES: Record<DomainToolId, Readonly<Record<string, DomainFact["value_type"]>>> = {
  [DOMAIN_TOOL_IDS.budget]: {
    "budget.variance_amount": "currency",
    "budget.variance_percent": "percent",
    "budget.plan_amount": "currency",
    "budget.actual_amount": "currency",
    "budget.forecast_amount": "currency",
  },
  [DOMAIN_TOOL_IDS.projectflow]: {
    "milestone.max_delay_days": "duration_days",
    "project.status": "text",
    "project.schedule_status": "text",
    "milestone.next_due_date": "date",
  },
};

export function parseDomainToolResponse(
  value: unknown,
  expected: { toolId: DomainToolId; toolCallId: string; requestedScopes: ScopeCoordinate[]; maxItems?: number; nowMs?: number },
): DomainToolResponse {
  const body = record(value, "DOMAIN_TOOL_RESPONSE_INVALID", "Domain tool response must be an object.");
  exactFields(body, RESPONSE_FIELDS, "DOMAIN_TOOL_RESPONSE_FIELD_UNKNOWN");
  requiredEqual(body, "schema_version", DIRECTOR_COPILOT_CONTRACT_VERSION);
  requiredEqual(body, "tool_id", expected.toolId);
  requiredEqual(body, "tool_call_id", expected.toolCallId);
  const status = requiredString(body, "status");
  if (!STATUS_VALUES.has(status)) fail("DOMAIN_TOOL_STATUS_INVALID", "Domain tool response status is invalid.");
  const generatedAt = validDateTime(requiredString(body, "generated_at"), "generated_at");
  validDateTime(requiredString(body, "as_of"), "as_of");
  const nowMs = expected.nowMs ?? Date.now();
  if (generatedAt > nowMs + 5 * 60_000) fail("DOMAIN_TOOL_TIME_INVALID", "Domain tool generated_at is in the future.");
  const expectedSource = expected.toolId === DOMAIN_TOOL_IDS.budget ? "STRATOS_BUDGET" : "STRATOS_PROJECTFLOW";
  requiredEqual(body, "source_system", expectedSource);
  boundedString(body.source_version, "source_version", 200);
  const itemsValue = array(body.items, "DOMAIN_TOOL_ITEMS_INVALID", "Domain tool items must be an array.");
  const maxItems = Math.min(expected.maxItems ?? 100, 100);
  if (itemsValue.length > maxItems) fail("DOMAIN_TOOL_ITEMS_LIMIT", "Domain tool response exceeds the requested item limit.");
  if ((status === "unavailable" || status === "not_authorized") && itemsValue.length) {
    fail("DOMAIN_TOOL_STATUS_ITEMS_INVALID", "Unavailable or unauthorized responses cannot contain items.");
  }
  const items = itemsValue.map((item) => parseItem(item, expected.requestedScopes, expected.toolId));
  const warnings = stringList(body.warnings, "warnings", 20, 300);
  const nextCursor = optionalString(body.next_cursor, "next_cursor", 500);
  return {
    schema_version: DIRECTOR_COPILOT_CONTRACT_VERSION,
    tool_id: expected.toolId,
    tool_call_id: expected.toolCallId,
    status: status as DomainToolResponse["status"],
    generated_at: requiredString(body, "generated_at"),
    as_of: requiredString(body, "as_of"),
    source_system: expectedSource,
    source_version: requiredString(body, "source_version"),
    items,
    warnings,
    next_cursor: nextCursor,
  };
}

function parseItem(value: unknown, requestedScopes: ScopeCoordinate[], toolId: DomainToolId): DomainToolItem {
  const item = record(value, "DOMAIN_TOOL_ITEM_INVALID", "Domain tool item must be an object.");
  exactFields(item, ITEM_FIELDS, "DOMAIN_TOOL_ITEM_FIELD_UNKNOWN");
  const authorizedScope = parseScope(item.authorized_scope);
  if (!requestedScopes.some((scope) => equalScope(scope, authorizedScope))) {
    fail("DOMAIN_TOOL_SCOPE_EXPANSION", "Domain tool item is outside the requested effective scopes.");
  }
  const entityType = boundedString(item.entity_type, "entity_type", 80);
  if (entityType !== "project") {
    fail("DOMAIN_TOOL_ENTITY_TYPE_INVALID", "Domain tool item must represent a project.");
  }
  const canonicalId = boundedString(item.canonical_id, "canonical_id", 300);
  if (!/^stratos:project:[A-Za-z0-9._:/-]+$/.test(canonicalId)) {
    fail("DOMAIN_TOOL_CANONICAL_ID_INVALID", "Domain tool canonical_id is invalid.");
  }
  validDateTime(boundedString(item.as_of, "as_of", 80), "item.as_of");
  const factsValue = array(item.facts, "DOMAIN_TOOL_FACTS_INVALID", "Domain tool facts must be an array.");
  if (!factsValue.length || factsValue.length > 40) fail("DOMAIN_TOOL_FACTS_LIMIT", "Domain tool item has an invalid fact count.");
  const documentContextTags = requiredStringList(item.document_context_tags, "document_context_tags", 20, 120);
  const expectedProjectTag = `project:${canonicalId.slice("stratos:project:".length)}`;
  if (!documentContextTags.includes(expectedProjectTag)) {
    fail("DOMAIN_TOOL_PROJECT_TAG_MISSING", "Domain tool item must include its exact canonical project context tag.");
  }
  return {
    entity_type: entityType,
    entity_id: boundedString(item.entity_id, "entity_id", 200),
    canonical_id: canonicalId,
    authorized_scope: authorizedScope,
    source_version: boundedString(item.source_version, "source_version", 200),
    as_of: requiredString(item, "as_of"),
    facts: factsValue.map((fact) => parseFact(fact, toolId)),
    deep_link: safeDeepLink(boundedString(item.deep_link, "deep_link", 2000)),
    document_context_tags: documentContextTags,
    policy: parsePolicy(item.policy),
  };
}

function parseFact(value: unknown, toolId: DomainToolId): DomainFact {
  const fact = record(value, "DOMAIN_TOOL_FACT_INVALID", "Domain tool fact must be an object.");
  exactFields(fact, FACT_FIELDS, "DOMAIN_TOOL_FACT_FIELD_UNKNOWN");
  const key = boundedString(fact.key, "fact.key", 80);
  if (!/^[a-z][a-z0-9_.-]{0,79}$/.test(key)) fail("DOMAIN_TOOL_FACT_KEY_INVALID", "Domain tool fact key is invalid.");
  const expectedValueType = TOOL_FACT_TYPES[toolId][key];
  if (!expectedValueType) {
    fail("DOMAIN_TOOL_FACT_KEY_UNSUPPORTED", "Domain tool fact key is not allowed for this tool version.");
  }
  const valueType = requiredString(fact, "value_type");
  if (!FACT_TYPES.has(valueType)) fail("DOMAIN_TOOL_FACT_TYPE_INVALID", "Domain tool fact value_type is invalid.");
  if (valueType !== expectedValueType) {
    fail("DOMAIN_TOOL_FACT_TYPE_UNSUPPORTED", "Domain tool fact value_type is not allowed for this fact key.");
  }
  if (!["string", "number", "boolean"].includes(typeof fact.value) && fact.value !== null) {
    fail("DOMAIN_TOOL_FACT_VALUE_INVALID", "Domain tool fact value must be scalar.");
  }
  validateFactValue(fact.value, valueType);
  const quality = fact.quality === undefined ? 1 : fact.quality;
  if (typeof quality !== "number" || !Number.isFinite(quality) || quality < 0 || quality > 1) {
    fail("DOMAIN_TOOL_FACT_QUALITY_INVALID", "Domain tool fact quality is invalid.");
  }
  const currency = optionalString(fact.currency, "currency", 3);
  if (currency && !/^[A-Z]{3}$/.test(currency)) fail("DOMAIN_TOOL_FACT_CURRENCY_INVALID", "Domain tool fact currency is invalid.");
  if (valueType === "currency" && !currency) {
    fail("DOMAIN_TOOL_FACT_CURRENCY_INVALID", "A currency fact requires an ISO currency.");
  }
  return {
    key,
    value: fact.value as DomainFact["value"],
    value_type: valueType as DomainFact["value_type"],
    unit: optionalString(fact.unit, "unit", 40),
    currency,
    period_start: optionalDate(fact.period_start, "period_start"),
    period_end: optionalDate(fact.period_end, "period_end"),
    quality,
  };
}

function validateFactValue(value: unknown, valueType: string): void {
  if (value === null) return;
  if (typeof value === "string" && value.length > 1_000) {
    fail("DOMAIN_TOOL_FACT_VALUE_INVALID", "Domain tool fact string exceeds its limit.");
  }
  const valid = valueType === "text"
    ? typeof value === "string"
    : valueType === "boolean"
      ? typeof value === "boolean"
      : valueType === "integer"
        ? typeof value === "number" && Number.isInteger(value)
        : ["number", "currency", "percent", "duration_days"].includes(valueType)
          ? typeof value === "number" && Number.isFinite(value)
          : valueType === "date"
            ? typeof value === "string" && isCalendarDate(value)
            : valueType === "datetime"
              ? typeof value === "string" && !Number.isNaN(Date.parse(value)) && value.includes("T")
              : false;
  if (!valid) fail("DOMAIN_TOOL_FACT_VALUE_TYPE_MISMATCH", "Domain tool fact value does not match value_type.");
}

function parsePolicy(value: unknown): SourcePolicy {
  const policy = record(value, "DOMAIN_TOOL_POLICY_INVALID", "Domain tool policy must be an object.");
  exactFields(policy, POLICY_FIELDS, "DOMAIN_TOOL_POLICY_FIELD_UNKNOWN");
  requiredEqual(policy, "version", "information-policy-2.0.0");
  const hash = boundedString(policy.hash, "policy.hash", 71);
  if (!/^sha256:[a-f0-9]{64}$/.test(hash)) fail("DOMAIN_TOOL_POLICY_HASH_INVALID", "Domain tool policy hash is invalid.");
  const classification = record(policy.classification, "DOMAIN_TOOL_CLASSIFICATION_INVALID", "Domain tool classification must be an object.");
  exactFields(classification, CLASSIFICATION_FIELDS, "DOMAIN_TOOL_CLASSIFICATION_FIELD_UNKNOWN");
  const handlingClass = requiredString(classification, "handling_class");
  if (!HANDLING_CLASSES.has(handlingClass)) fail("DOMAIN_TOOL_HANDLING_CLASS_INVALID", "Domain tool handling class is invalid.");
  requiredEqual(classification, "legal_classification", "NONE");
  const tlp = enumOrNull(classification.tlp, ["TLP:RED", "TLP:AMBER+STRICT", "TLP:AMBER", "TLP:GREEN", "TLP:CLEAR"], "tlp");
  const pap = enumOrNull(classification.pap, ["PAP:RED", "PAP:AMBER", "PAP:GREEN", "PAP:CLEAR"], "pap");
  const audience = stringList(policy.audience, "audience", 32, 160);
  if (!audience.length) fail("DOMAIN_TOOL_AUDIENCE_INVALID", "Domain tool policy audience is empty.");
  const obligations = stringList(policy.obligations, "obligations", 16, 40);
  if (obligations.some((obligation) => !OBLIGATIONS.has(obligation))) {
    fail("DOMAIN_TOOL_OBLIGATION_UNKNOWN", "Domain tool policy contains an unknown obligation.");
  }
  return {
    binding_id: validPolicyBindingId(boundedString(policy.binding_id, "policy.binding_id", 200, 8)),
    version: "information-policy-2.0.0",
    hash,
    classification: {
      handling_class: handlingClass as HandlingClass,
      legal_classification: "NONE",
      tlp: tlp as InformationClassification["tlp"],
      pap: pap as InformationClassification["pap"],
    },
    audience: [...new Set(audience)],
    obligations: [...new Set(obligations)] as PolicyObligation[],
  };
}

function validPolicyBindingId(value: string): string {
  if (!/^(pol|pb)_[A-Za-z0-9_-]{8,}$/.test(value)) {
    fail("DOMAIN_TOOL_POLICY_BINDING_INVALID", "Domain tool policy binding id is invalid.");
  }
  return value;
}

export function parseScopeString(value: string): ScopeCoordinate | null {
  const [type, ...idParts] = value.split(":");
  if (!SCOPE_TYPES.has(type)) return null;
  const id = idParts.join(":").trim();
  return id ? { type: type as ScopeType, id } : { type: type as ScopeType };
}

export function stableSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${stableSha256(value).slice("sha256:".length, "sha256:".length + 32)}`;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function parseScope(value: unknown): ScopeCoordinate {
  const scope = record(value, "DOMAIN_TOOL_SCOPE_INVALID", "Domain tool scope must be an object.");
  exactFields(scope, SCOPE_FIELDS, "DOMAIN_TOOL_SCOPE_FIELD_UNKNOWN");
  const type = requiredString(scope, "type");
  if (!SCOPE_TYPES.has(type)) fail("DOMAIN_TOOL_SCOPE_TYPE_INVALID", "Domain tool scope type is invalid.");
  const id = optionalString(scope.id, "scope.id", 160);
  return id ? { type: type as ScopeType, id } : { type: type as ScopeType };
}

function equalScope(left: ScopeCoordinate, right: ScopeCoordinate): boolean {
  return left.type === right.type && (left.id ?? "") === (right.id ?? "");
}

function safeDeepLink(value: string): string {
  if (value.startsWith("/")) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return value;
  } catch {
    // handled below
  }
  fail("DOMAIN_TOOL_DEEP_LINK_INVALID", "Domain tool deep link must be HTTPS or relative.");
}

function exactFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, code: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) fail(code, `Unexpected domain tool field: ${unknown}`);
}

function record(value: unknown, code: string, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, message);
  return value as Record<string, unknown>;
}

function array(value: unknown, code: string, message: string): unknown[] {
  if (!Array.isArray(value)) fail(code, message);
  return value;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  return boundedString(value[key], key, 4000);
}

function boundedString(value: unknown, name: string, max: number, min = 1): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    fail("DOMAIN_TOOL_STRING_INVALID", `Domain tool ${name} is invalid.`);
  }
  return value;
}

function optionalString(value: unknown, name: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  return boundedString(value, name, max);
}

function stringList(value: unknown, name: string, maxItems: number, maxLength: number): string[] {
  const values = array(value, "DOMAIN_TOOL_LIST_INVALID", `Domain tool ${name} must be an array.`);
  if (values.length > maxItems) fail("DOMAIN_TOOL_LIST_LIMIT", `Domain tool ${name} exceeds its limit.`);
  return values.map((item) => boundedString(item, name, maxLength));
}

function requiredStringList(value: unknown, name: string, maxItems: number, maxLength: number): string[] {
  const values = stringList(value, name, maxItems, maxLength);
  if (!values.length) fail("DOMAIN_TOOL_LIST_EMPTY", `Domain tool ${name} must not be empty.`);
  return values;
}

function requiredEqual(value: Record<string, unknown>, key: string, expected: string): void {
  if (value[key] !== expected) fail("DOMAIN_TOOL_CONTRACT_MISMATCH", `Domain tool ${key} does not match the request.`);
}

function validDateTime(value: string, name: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || !value.includes("T")) fail("DOMAIN_TOOL_TIME_INVALID", `Domain tool ${name} is invalid.`);
  return parsed;
}

function optionalDate(value: unknown, name: string): string | null {
  const date = optionalString(value, name, 10);
  if (date && !isCalendarDate(date)) fail("DOMAIN_TOOL_DATE_INVALID", `Domain tool ${name} is invalid.`);
  return date;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function enumOrNull(value: unknown, allowed: readonly string[], name: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !allowed.includes(value)) fail("DOMAIN_TOOL_ENUM_INVALID", `Domain tool ${name} is invalid.`);
  return value;
}

function fail(code: string, message: string): never {
  throw new DirectorCopilotContractError(code, message);
}
