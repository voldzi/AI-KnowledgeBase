import { createHash } from "node:crypto";

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import errorSchema from "./contracts/director-copilot-2-error.schema.json";
import manifestSchema from "./contracts/director-copilot-2-manifest.schema.json";
import pinnedManifestBundleJson from "./contracts/director-copilot-2-manifests.json";
import requestSchema from "./contracts/director-copilot-2-request.schema.json";
import responseSchema from "./contracts/director-copilot-2-response.schema.json";

export const DIRECTOR_COPILOT_V2_CONTRACT = "director-copilot-2" as const;
export const DIRECTOR_COPILOT_V2_REVISION = "2.0.3" as const;
export const DIRECTOR_COPILOT_V2_MANIFEST_BUNDLE_SHA256 =
  "3cf0248f1db9ee8742af25b546a209ce9bbe9c4938dc9c88240ae45f97245bf5" as const;

export const V2_TOOL_IDS = {
  budgetOrganization: "budget.organization_financial_summary.v1",
  budgetProject: "budget.project_financial_snapshot.v1",
  projectflow: "projectflow.portfolio_delivery_overview.v1",
  archflow: "archflow.need_portfolio_overview.v1",
  aiip: "aiip.idea_portfolio_overview.v1",
} as const;

export type DirectorCopilotV2ToolId = (typeof V2_TOOL_IDS)[keyof typeof V2_TOOL_IDS];
export type DirectorCopilotV2Application = "budget" | "projectflow" | "archflow" | "aiip";
export type ActiveDirectorCopilotV2Application = Exclude<
  DirectorCopilotV2Application,
  "aiip"
>;
export type DirectorCopilotV2Audience = "budget-api" | "projectflow-api" | "archflow-api" | "aiip-api";
export type DirectorCopilotV2ScopeType =
  | "own"
  | "public"
  | "organization"
  | "organization_unit"
  | "budget_scope"
  | "portfolio"
  | "project"
  | "document"
  | "recipient_set";
export type DirectorCopilotV2Granularity =
  | "organization"
  | "organization_unit"
  | "portfolio"
  | "project"
  | "item";
export type DirectorCopilotV2Scenario =
  | "plan"
  | "actual"
  | "forecast"
  | "commitments"
  | "variance";

export interface DirectorCopilotV2Scope {
  type: DirectorCopilotV2ScopeType;
  id?: string;
}

export type DirectorCopilotV2RequestPeriod =
  | { type: "fiscal_year"; fiscal_year: number }
  | { type: "interval"; start: string; end: string };

export interface DirectorCopilotV2EntityFilters {
  organization_unit_ids?: string[];
  budget_scope_ids?: string[];
  portfolio_ids?: string[];
  project_ids?: string[];
  need_ids?: string[];
  idea_ids?: string[];
}

export interface DirectorCopilotV2Request {
  schema_version: typeof DIRECTOR_COPILOT_V2_CONTRACT;
  tool_id: DirectorCopilotV2ToolId;
  tool_call_id: string;
  plan_id: string;
  organization_id: "org_stratos";
  actor: { type: "person"; subject_id: string };
  requested_at: string;
  requested_scopes: DirectorCopilotV2Scope[];
  parameters: {
    period: DirectorCopilotV2RequestPeriod;
    entity_filters: DirectorCopilotV2EntityFilters;
    granularity: DirectorCopilotV2Granularity;
    group_by: string[];
    scenario: DirectorCopilotV2Scenario[];
    as_of?: string;
    cursor?: string | null;
    limit: number;
  };
}

export interface DirectorCopilotV2Fact {
  key: string;
  value: string | number | boolean | null;
  value_type: "text" | "number" | "currency" | "percent" | "duration_days" | "date" | "boolean";
  unit: string | null;
  currency: string | null;
  period_start: string;
  period_end: string;
  quality: number;
}

export interface DirectorCopilotV2Methodology {
  name: string;
  version: string;
  temporal_semantics?: string;
  aggregation?: string;
  comparison_basis?: string;
  dimensions?: string[];
  components?: Array<{ key: string; description: string }>;
}

export interface DirectorCopilotV2Policy {
  schema_version: "stratos-information-policy-2";
  binding_id: string;
  version: string;
  hash: string | null;
  classification: {
    handling_class: string;
    legal_classification: string;
    tlp: string | null;
    pap: string | null;
  };
  audience: string[];
  obligations: string[];
}

export interface DirectorCopilotV2Link {
  key: string;
  relation_type: "direct" | "derived" | "informational";
  target_entity_type: string;
  target_canonical_id: string;
}

export interface DirectorCopilotV2Item {
  entity_type: string;
  entity_id: string;
  canonical_id: string;
  source_version: string;
  as_of: string;
  period: { start: string; end: string; fiscal_year: number };
  unit: string | null;
  currency: string | null;
  facts: DirectorCopilotV2Fact[];
  methodology: DirectorCopilotV2Methodology;
  deep_link: string;
  document_context_tags: string[];
  policy: DirectorCopilotV2Policy;
  policy_lineage: Array<{
    resource_id: string | null;
    binding_id: string;
    hash: string | null;
    source_version: string;
  }>;
  links: DirectorCopilotV2Link[];
}

export interface DirectorCopilotV2Response {
  schema_version: typeof DIRECTOR_COPILOT_V2_CONTRACT;
  tool_id: DirectorCopilotV2ToolId;
  tool_call_id: string;
  status: "complete" | "partial" | "no_data" | "not_authorized";
  generated_at: string;
  as_of: string;
  period: { start: string; end: string; fiscal_year: number };
  source_system: string;
  source_version: string;
  methodology: DirectorCopilotV2Methodology;
  completeness: {
    authorized_result_complete: boolean;
    source_coverage: "complete" | "partial" | "denied";
    missing_reasons: string[];
    candidate_count: number;
  };
  items: DirectorCopilotV2Item[];
  warnings: string[];
  next_cursor: string | null;
}

export interface DirectorCopilotV2ErrorEnvelope {
  schema_version: typeof DIRECTOR_COPILOT_V2_CONTRACT;
  status: "error";
  http_status: 400 | 401 | 403 | 413 | 422 | 503;
  error_code: string;
  message: string;
  retryable: boolean;
  tool_call_id: string | null;
}

export interface DirectorCopilotV2Manifest {
  schema_version: typeof DIRECTOR_COPILOT_V2_CONTRACT;
  contract_revision: typeof DIRECTOR_COPILOT_V2_REVISION;
  tool_id: DirectorCopilotV2ToolId;
  owner: "BUDGET" | "PROJECTFLOW" | "ARCHFLOW" | "AIIP";
  audience: DirectorCopilotV2Audience;
  schema_revision: string;
  metrics: Array<{
    key: string;
    value_type: DirectorCopilotV2Fact["value_type"];
    description: string;
  }>;
  entity_types: string[];
  canonical_id_prefixes: Array<{
    entity_type: string;
    prefix: string;
    aggregate: boolean;
  }>;
  relationships: Array<{
    key: string;
    source_entity_type: string;
    target_entity_type: string;
    target_canonical_id_prefix: string;
    cardinality: "one" | "zero_or_one" | "many";
    derivation: DirectorCopilotV2Link["relation_type"];
    location: { kind: "link" | "fact"; key: string };
  }>;
  link_keys: Array<{
    key: string;
    target_entity_type: string;
    target_canonical_id_prefix: string;
    max_items: number;
  }>;
  periods: Array<DirectorCopilotV2RequestPeriod["type"]>;
  granularities: DirectorCopilotV2Granularity[];
  group_by: string[];
  scenarios: DirectorCopilotV2Scenario[];
  capability_requirements: {
    all_of: string[];
    any_of: string[];
    conditional: Array<{
      when: {
        scope_types: DirectorCopilotV2ScopeType[];
        granularities: DirectorCopilotV2Granularity[];
      };
      all_of: string[];
      any_of: string[];
    }>;
  };
  supported_scope_types: DirectorCopilotV2ScopeType[];
  timeout_ms: number;
  limits: {
    max_items: 100;
    max_response_bytes: 262_144;
    max_candidate_count: 100_000;
  };
  pagination: "cursor";
  reason_codes: string[];
  input_schema_ref: "director-copilot-2-request.schema.json";
  output_schema_ref: "director-copilot-2-response.schema.json";
  error_schema_ref: "director-copilot-2-error.schema.json";
}

export interface DirectorCopilotV2ManifestBundle {
  schema_version: typeof DIRECTOR_COPILOT_V2_CONTRACT;
  contract_revision: typeof DIRECTOR_COPILOT_V2_REVISION;
  manifests: DirectorCopilotV2Manifest[];
}

export class DirectorCopilotV2ContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly diagnosticPaths: string[] = [],
  ) {
    super(message);
    this.name = "DirectorCopilotV2ContractError";
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: true,
});
addFormats(ajv);

const validateRequest = ajv.compile(requestSchema);
const validateResponse = ajv.compile(responseSchema);
const validateManifest = ajv.compile(manifestSchema);
const validateError = ajv.compile(errorSchema);

const COMMON_ERROR_CODES = new Set([
  "DIRECTOR_COPILOT_CONTRACT_INVALID",
  "DIRECTOR_COPILOT_AUTHENTICATION_REQUIRED",
  "DIRECTOR_COPILOT_IDENTITY_FORBIDDEN",
  "DIRECTOR_COPILOT_RESPONSE_TOO_LARGE",
  "DIRECTOR_COPILOT_TOOL_UNSUPPORTED",
]);

const EXPECTED_TOOLS: Record<DirectorCopilotV2Application, DirectorCopilotV2ToolId[]> = {
  budget: [V2_TOOL_IDS.budgetOrganization, V2_TOOL_IDS.budgetProject],
  projectflow: [V2_TOOL_IDS.projectflow],
  archflow: [V2_TOOL_IDS.archflow],
  aiip: [V2_TOOL_IDS.aiip],
};

const EXPECTED_AUDIENCE: Record<DirectorCopilotV2Application, DirectorCopilotV2Audience> = {
  budget: "budget-api",
  projectflow: "projectflow-api",
  archflow: "archflow-api",
  aiip: "aiip-api",
};

const SOURCE_SYSTEM: Record<DirectorCopilotV2Manifest["owner"], string> = {
  BUDGET: "STRATOS_BUDGET",
  PROJECTFLOW: "STRATOS_PROJECTFLOW",
  ARCHFLOW: "STRATOS_ARCHFLOW",
  AIIP: "STRATOS_AIIP",
};

const pinnedBundle = parsePinnedBundle(pinnedManifestBundleJson);
const pinnedByTool = new Map(
  pinnedBundle.manifests.map((manifest) => [manifest.tool_id, manifest]),
);

export function pinnedDirectorCopilotV2ManifestBundle(): DirectorCopilotV2ManifestBundle {
  return structuredClone(pinnedBundle);
}

export function pinnedDirectorCopilotV2Manifest(
  toolId: DirectorCopilotV2ToolId,
): DirectorCopilotV2Manifest {
  const manifest = pinnedByTool.get(toolId);
  if (!manifest) {
    fail("DIRECTOR_COPILOT_V2_TOOL_UNKNOWN", `Pinned manifest is missing ${toolId}.`);
  }
  return structuredClone(manifest);
}

export function parseDirectorCopilotV2ManifestEnvelope(
  value: unknown,
  application: DirectorCopilotV2Application,
): DirectorCopilotV2Manifest[] {
  if (!isRecord(value) || !hasExactKeys(value, ["schema_version", "manifests"])) {
    fail("DIRECTOR_COPILOT_V2_MANIFEST_ENVELOPE_INVALID", "Manifest response is not a closed envelope.");
  }
  if (value.schema_version !== DIRECTOR_COPILOT_V2_CONTRACT || !Array.isArray(value.manifests)) {
    fail("DIRECTOR_COPILOT_V2_MANIFEST_ENVELOPE_INVALID", "Manifest response has an invalid version or list.");
  }
  const manifests = value.manifests.map((candidate) => {
    schemaAssert(validateManifest, candidate, "DIRECTOR_COPILOT_V2_MANIFEST_INVALID");
    return candidate as DirectorCopilotV2Manifest;
  });
  const expectedTools = EXPECTED_TOOLS[application];
  if (
    manifests.length !== expectedTools.length
    || manifests.some((manifest) => (
      !expectedTools.includes(manifest.tool_id)
      || manifest.audience !== EXPECTED_AUDIENCE[application]
    ))
  ) {
    fail("DIRECTOR_COPILOT_V2_MANIFEST_SET_INVALID", `Unexpected ${application} manifest set.`);
  }
  for (const manifest of manifests) {
    const pinned = pinnedByTool.get(manifest.tool_id);
    if (!pinned || canonicalJson(pinned) !== canonicalJson(manifest)) {
      fail("DIRECTOR_COPILOT_V2_MANIFEST_DRIFT", `Manifest ${manifest.tool_id} differs from the pinned contract.`);
    }
  }
  return manifests.map((manifest) => structuredClone(manifest));
}

export function assertDirectorCopilotV2Request(value: unknown): asserts value is DirectorCopilotV2Request {
  schemaAssert(validateRequest, value, "DIRECTOR_COPILOT_V2_REQUEST_INVALID");
}

export function parseDirectorCopilotV2Response(
  value: unknown,
  expected: {
    manifest: DirectorCopilotV2Manifest;
    toolCallId: string;
    nowMs?: number;
  },
): DirectorCopilotV2Response {
  schemaAssert(validateResponse, value, "DIRECTOR_COPILOT_V2_RESPONSE_INVALID");
  const response = value as DirectorCopilotV2Response;
  if (
    response.tool_id !== expected.manifest.tool_id
    || response.tool_call_id !== expected.toolCallId
    || response.source_system !== SOURCE_SYSTEM[expected.manifest.owner]
  ) {
    fail("DIRECTOR_COPILOT_V2_RESPONSE_BINDING_INVALID", "Response does not match the requested tool call.");
  }
  const generatedAt = Date.parse(response.generated_at);
  if (
    Number.isNaN(generatedAt)
    || generatedAt > (expected.nowMs ?? Date.now()) + 5 * 60_000
  ) {
    fail("DIRECTOR_COPILOT_V2_RESPONSE_TIME_INVALID", "Response generated_at is invalid.");
  }
  const reasonCodes = new Set(expected.manifest.reason_codes);
  for (const reason of [...response.warnings, ...response.completeness.missing_reasons]) {
    if (!reasonCodes.has(reason)) {
      fail("DIRECTOR_COPILOT_V2_REASON_UNKNOWN", `Unknown reason code ${reason}.`);
    }
  }
  if (
    (response.status === "no_data" || response.status === "not_authorized")
    && response.items.length !== 0
  ) {
    fail("DIRECTOR_COPILOT_V2_STATUS_ITEMS_INVALID", `${response.status} must not contain items.`);
  }
  if (
    response.status === "complete"
    && (
      !response.completeness.authorized_result_complete
      || response.completeness.source_coverage !== "complete"
    )
  ) {
    fail("DIRECTOR_COPILOT_V2_COMPLETENESS_INVALID", "Complete response is not complete.");
  }
  if (
    response.status === "not_authorized"
    && response.completeness.source_coverage !== "denied"
  ) {
    fail("DIRECTOR_COPILOT_V2_COMPLETENESS_INVALID", "Denied response must declare denied coverage.");
  }
  for (const item of response.items) {
    validateItemAgainstManifest(item, expected.manifest);
  }
  return structuredClone(response);
}

export function parseDirectorCopilotV2Error(
  value: unknown,
  expected: {
    status: number;
    manifest?: DirectorCopilotV2Manifest;
    toolCallId?: string | null;
  },
): DirectorCopilotV2ErrorEnvelope {
  schemaAssert(validateError, value, "DIRECTOR_COPILOT_V2_ERROR_INVALID");
  const envelope = value as DirectorCopilotV2ErrorEnvelope;
  if (envelope.http_status !== expected.status) {
    fail("DIRECTOR_COPILOT_V2_ERROR_STATUS_INVALID", "Error envelope status does not match HTTP status.");
  }
  if (
    expected.toolCallId
    && envelope.tool_call_id !== null
    && envelope.tool_call_id !== expected.toolCallId
  ) {
    fail("DIRECTOR_COPILOT_V2_ERROR_BINDING_INVALID", "Error envelope belongs to another tool call.");
  }
  const allowedCodes = new Set([
    ...COMMON_ERROR_CODES,
    ...(expected.manifest?.reason_codes ?? []),
  ]);
  if (!allowedCodes.has(envelope.error_code)) {
    fail("DIRECTOR_COPILOT_V2_REASON_UNKNOWN", `Unknown error code ${envelope.error_code}.`);
  }
  if (envelope.retryable !== (envelope.http_status === 503)) {
    fail("DIRECTOR_COPILOT_V2_ERROR_RETRY_INVALID", "Only a 503 error may be retryable.");
  }
  return structuredClone(envelope);
}

export function directorCopilotV2ApplicationForTool(
  toolId: DirectorCopilotV2ToolId,
): DirectorCopilotV2Application {
  if (toolId === V2_TOOL_IDS.budgetOrganization || toolId === V2_TOOL_IDS.budgetProject) {
    return "budget";
  }
  if (toolId === V2_TOOL_IDS.projectflow) return "projectflow";
  if (toolId === V2_TOOL_IDS.archflow) return "archflow";
  return "aiip";
}

export function directorCopilotV2StableId(
  prefix: "plan" | "call" | "snap",
  value: unknown,
): string {
  return `${prefix}_${createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 24)}`;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parsePinnedBundle(value: unknown): DirectorCopilotV2ManifestBundle {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["schema_version", "contract_revision", "manifests"])
    || value.schema_version !== DIRECTOR_COPILOT_V2_CONTRACT
    || value.contract_revision !== DIRECTOR_COPILOT_V2_REVISION
    || !Array.isArray(value.manifests)
    || value.manifests.length !== 5
  ) {
    fail("DIRECTOR_COPILOT_V2_PIN_INVALID", "Pinned manifest bundle is invalid.");
  }
  for (const manifest of value.manifests) {
    schemaAssert(validateManifest, manifest, "DIRECTOR_COPILOT_V2_PIN_INVALID");
  }
  const tools = value.manifests.map((manifest) => (
    (manifest as DirectorCopilotV2Manifest).tool_id
  ));
  if (new Set(tools).size !== 5 || tools.some((tool) => !Object.values(V2_TOOL_IDS).includes(tool))) {
    fail("DIRECTOR_COPILOT_V2_PIN_INVALID", "Pinned manifest tools are incomplete.");
  }
  return structuredClone(value) as unknown as DirectorCopilotV2ManifestBundle;
}

function validateItemAgainstManifest(
  item: DirectorCopilotV2Item,
  manifest: DirectorCopilotV2Manifest,
): void {
  if (!manifest.entity_types.includes(item.entity_type)) {
    fail("DIRECTOR_COPILOT_V2_ENTITY_UNKNOWN", `Unknown entity type ${item.entity_type}.`);
  }
  const prefix = manifest.canonical_id_prefixes.find(
    (candidate) => candidate.entity_type === item.entity_type
      && item.canonical_id.startsWith(candidate.prefix),
  );
  if (!prefix) {
    fail("DIRECTOR_COPILOT_V2_CANONICAL_ID_INVALID", `Invalid canonical ID ${item.canonical_id}.`);
  }
  const metrics = new Map(manifest.metrics.map((metric) => [metric.key, metric]));
  const factKeys = new Set<string>();
  for (const fact of item.facts) {
    const metric = metrics.get(fact.key);
    if (!metric || metric.value_type !== fact.value_type) {
      fail("DIRECTOR_COPILOT_V2_FACT_UNKNOWN", `Unknown or incompatible fact ${fact.key}.`);
    }
    if (factKeys.has(fact.key)) {
      fail("DIRECTOR_COPILOT_V2_FACT_DUPLICATE", `Duplicate fact ${fact.key}.`);
    }
    factKeys.add(fact.key);
  }
  const policyLineage = item.policy_lineage.find((lineage) => (
    lineage.binding_id === item.policy.binding_id
    && lineage.hash === item.policy.hash
    && lineage.source_version === item.source_version
    && (lineage.resource_id === null || lineage.resource_id === item.canonical_id)
  ));
  if (!policyLineage) {
    fail(
      "DIRECTOR_COPILOT_V2_POLICY_LINEAGE_INVALID",
      `Item ${item.canonical_id} does not bind its policy to the source version.`,
    );
  }
  try {
    const deepLink = new URL(item.deep_link);
    if (deepLink.protocol !== "https:") throw new Error("unsafe protocol");
  } catch {
    fail(
      "DIRECTOR_COPILOT_V2_DEEP_LINK_INVALID",
      `Item ${item.canonical_id} does not contain a safe HTTPS deep link.`,
    );
  }
  const linkKeys = new Map(manifest.link_keys.map((link) => [link.key, link]));
  const linkCounts = new Map<string, number>();
  const seenLinks = new Set<string>();
  for (const link of item.links) {
    const definition = linkKeys.get(link.key);
    if (
      !definition
      || definition.target_entity_type !== link.target_entity_type
      || !link.target_canonical_id.startsWith(definition.target_canonical_id_prefix)
    ) {
      fail("DIRECTOR_COPILOT_V2_LINK_UNKNOWN", `Unknown or incompatible link ${link.key}.`);
    }
    const signature = `${link.key}|${link.target_canonical_id}`;
    if (seenLinks.has(signature)) {
      fail("DIRECTOR_COPILOT_V2_LINK_DUPLICATE", `Duplicate link ${link.key}.`);
    }
    seenLinks.add(signature);
    const count = (linkCounts.get(link.key) ?? 0) + 1;
    linkCounts.set(link.key, count);
    if (count > definition.max_items) {
      fail("DIRECTOR_COPILOT_V2_LINK_LIMIT", `Link ${link.key} exceeds its declared limit.`);
    }
  }
}

function schemaAssert(
  validate: ValidateFunction,
  value: unknown,
  code: string,
): void {
  if (validate(value)) return;
  fail(
    code,
    `Schema validation failed: ${formatErrors(validate.errors)}.`,
    diagnosticPaths(validate.errors),
  );
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 5)
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

function diagnosticPaths(
  errors: ErrorObject[] | null | undefined,
): string[] {
  return [...new Set(
    (errors ?? [])
      .slice(0, 5)
      .map((error) => `${error.instancePath || "/"}:${error.keyword}`),
  )];
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(
  code: string,
  message: string,
  paths: string[] = [],
): never {
  throw new DirectorCopilotV2ContractError(code, message, paths);
}
