import catalogJson from "./data/stratos-domain-catalog.json";
import type {
  StratosSemanticMetric,
  StratosSemanticSource,
} from "./semantic-types";

export const STRATOS_DOMAIN_CATALOG_VERSION = "stratos-domain-catalog-1" as const;

export type CatalogApplication = StratosSemanticSource | "akb";
export type CatalogToolStatus = "connected" | "contract_ready";
export type CatalogFactType =
  | "text"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "datetime"
  | "currency"
  | "percent"
  | "duration_days";

export interface DomainCatalogMetric {
  key: string;
  value_type: CatalogFactType;
}

export interface DomainCatalogTool {
  tool_id: string;
  application: CatalogApplication;
  source_system: string;
  status: CatalogToolStatus;
  contract_version: string;
  access_capability: string | null;
  read_capabilities: string[];
  scope_types: string[];
  entity_type: string;
  canonical_id_prefix: string;
  context_tag_prefix: string;
  metrics: DomainCatalogMetric[];
}

export interface DomainCatalogRelationship {
  relationship_id: string;
  from_entity_type: string;
  to_entity_type: string;
  strategy: "shared_canonical_id" | "context_tag" | "declared_relation_fact";
  relation_metric: string | null;
  target_canonical_id_prefix: string;
}

export interface StratosDomainCatalog {
  schema_version: typeof STRATOS_DOMAIN_CATALOG_VERSION;
  catalog_id: string;
  owner: "STRATOS";
  tools: DomainCatalogTool[];
  relationships: DomainCatalogRelationship[];
}

const APPLICATIONS = new Set<CatalogApplication>([
  "budget",
  "projectflow",
  "archflow",
  "aiip",
  "akb",
]);
const STATUSES = new Set<CatalogToolStatus>(["connected", "contract_ready"]);
const FACT_TYPES = new Set<CatalogFactType>([
  "text",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "currency",
  "percent",
  "duration_days",
]);
const RELATION_STRATEGIES = new Set<DomainCatalogRelationship["strategy"]>([
  "shared_canonical_id",
  "context_tag",
  "declared_relation_fact",
]);

export const stratosDomainCatalog = parseDomainCatalog(catalogJson);

export function domainCatalogToolForApplication(
  application: CatalogApplication,
): DomainCatalogTool {
  const tool = stratosDomainCatalog.tools.find(
    (candidate) => candidate.application === application,
  );
  if (!tool) {
    throw new Error(`STRATOS domain catalog does not define ${application}.`);
  }
  return tool;
}

export function domainCatalogSourceStatus(
  application: StratosSemanticSource,
): CatalogToolStatus {
  return domainCatalogToolForApplication(application).status;
}

export function domainCatalogMetric(
  metric: StratosSemanticMetric | string,
): DomainCatalogMetric | null {
  return stratosDomainCatalog.tools
    .flatMap((tool) => tool.metrics)
    .find((candidate) => candidate.key === metric) ?? null;
}

export function domainCatalogStatus(): {
  catalog_id: string;
  connected_tools: string[];
  contract_ready_tools: string[];
  relationship_count: number;
} {
  return {
    catalog_id: stratosDomainCatalog.catalog_id,
    connected_tools: stratosDomainCatalog.tools
      .filter((tool) => tool.status === "connected")
      .map((tool) => tool.tool_id),
    contract_ready_tools: stratosDomainCatalog.tools
      .filter((tool) => tool.status === "contract_ready")
      .map((tool) => tool.tool_id),
    relationship_count: stratosDomainCatalog.relationships.length,
  };
}

function parseDomainCatalog(value: unknown): StratosDomainCatalog {
  const catalog = objectValue(value, "catalog");
  if (catalog.schema_version !== STRATOS_DOMAIN_CATALOG_VERSION) {
    throw new Error("Unsupported STRATOS domain catalog schema.");
  }
  if (catalog.owner !== "STRATOS") {
    throw new Error("STRATOS domain catalog owner is invalid.");
  }
  const catalogId = boundedId(catalog.catalog_id, "catalog_id");
  const tools = arrayValue(catalog.tools, "tools").map(parseTool);
  if (new Set(tools.map((tool) => tool.tool_id)).size !== tools.length) {
    throw new Error("STRATOS domain catalog contains duplicate tool ids.");
  }
  if (new Set(tools.map((tool) => tool.application)).size !== tools.length) {
    throw new Error("STRATOS domain catalog contains duplicate applications.");
  }
  for (const application of APPLICATIONS) {
    if (!tools.some((tool) => tool.application === application)) {
      throw new Error(`STRATOS domain catalog is missing ${application}.`);
    }
  }
  const allMetrics = tools.flatMap((tool) => tool.metrics);
  const metricKeys = allMetrics.map((metric) => metric.key);
  for (const metricKey of new Set(metricKeys)) {
    const valueTypes = new Set(
      allMetrics
        .filter((metric) => metric.key === metricKey)
        .map((metric) => metric.value_type),
    );
    if (valueTypes.size > 1) {
      throw new Error(
        `STRATOS domain catalog metric ${metricKey} has conflicting value types.`,
      );
    }
  }
  const relationships = arrayValue(catalog.relationships, "relationships")
    .map((relationship) => parseRelationship(relationship, metricKeys));
  if (
    new Set(relationships.map((relationship) => relationship.relationship_id)).size
    !== relationships.length
  ) {
    throw new Error("STRATOS domain catalog contains duplicate relationship ids.");
  }
  return {
    schema_version: STRATOS_DOMAIN_CATALOG_VERSION,
    catalog_id: catalogId,
    owner: "STRATOS",
    tools,
    relationships,
  };
}

function parseTool(value: unknown): DomainCatalogTool {
  const tool = objectValue(value, "tool");
  const application = boundedId(tool.application, "application") as CatalogApplication;
  if (!APPLICATIONS.has(application)) {
    throw new Error(`Unknown STRATOS domain catalog application: ${application}`);
  }
  const status = boundedId(tool.status, "status") as CatalogToolStatus;
  if (!STATUSES.has(status)) {
    throw new Error(`Unknown STRATOS domain catalog status: ${status}`);
  }
  const metrics = arrayValue(tool.metrics, "metrics").map((metricValue) => {
    const metric = objectValue(metricValue, "metric");
    const valueType = boundedId(metric.value_type, "value_type") as CatalogFactType;
    if (!FACT_TYPES.has(valueType)) {
      throw new Error(`Unknown STRATOS domain metric type: ${valueType}`);
    }
    return {
      key: boundedMetric(metric.key),
      value_type: valueType,
    };
  });
  if (new Set(metrics.map((metric) => metric.key)).size !== metrics.length) {
    throw new Error(`STRATOS domain tool ${application} contains duplicate metrics.`);
  }
  return {
    tool_id: boundedToolId(tool.tool_id),
    application,
    source_system: boundedId(tool.source_system, "source_system"),
    status,
    contract_version: boundedId(tool.contract_version, "contract_version"),
    access_capability: nullableCapability(tool.access_capability),
    read_capabilities: nonEmptyStringArray(tool.read_capabilities, "read_capabilities"),
    scope_types: nonEmptyStringArray(tool.scope_types, "scope_types"),
    entity_type: boundedId(tool.entity_type, "entity_type"),
    canonical_id_prefix: boundedPrefix(tool.canonical_id_prefix, "canonical_id_prefix"),
    context_tag_prefix: boundedPrefix(tool.context_tag_prefix, "context_tag_prefix"),
    metrics,
  };
}

function parseRelationship(
  value: unknown,
  metricKeys: string[],
): DomainCatalogRelationship {
  const relationship = objectValue(value, "relationship");
  const strategy = boundedId(
    relationship.strategy,
    "relationship.strategy",
  ) as DomainCatalogRelationship["strategy"];
  if (!RELATION_STRATEGIES.has(strategy)) {
    throw new Error(`Unknown STRATOS relationship strategy: ${strategy}`);
  }
  const relationMetric = nullableMetric(relationship.relation_metric);
  if (strategy === "declared_relation_fact" && !relationMetric) {
    throw new Error("Declared STRATOS relationships require a relation metric.");
  }
  if (relationMetric && !metricKeys.includes(relationMetric)) {
    throw new Error(`STRATOS relationship references unknown metric ${relationMetric}.`);
  }
  return {
    relationship_id: boundedId(relationship.relationship_id, "relationship_id"),
    from_entity_type: boundedId(relationship.from_entity_type, "from_entity_type"),
    to_entity_type: boundedId(relationship.to_entity_type, "to_entity_type"),
    strategy,
    relation_metric: relationMetric,
    target_canonical_id_prefix: boundedPrefix(
      relationship.target_canonical_id_prefix,
      "target_canonical_id_prefix",
    ),
  };
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`STRATOS domain catalog ${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`STRATOS domain catalog ${name} must be an array.`);
  }
  return value;
}

function boundedId(value: unknown, name: string): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 160
    || !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new Error(`STRATOS domain catalog ${name} is invalid.`);
  }
  return value;
}

function boundedToolId(value: unknown): string {
  const toolId = boundedId(value, "tool_id");
  if (!/^[a-z][a-z0-9_.-]+\.v[1-9][0-9]*$/.test(toolId)) {
    throw new Error("STRATOS domain catalog tool_id is invalid.");
  }
  return toolId;
}

function boundedMetric(value: unknown): string {
  const metric = boundedId(value, "metric");
  if (!/^[a-z][a-z0-9_.-]+$/.test(metric)) {
    throw new Error("STRATOS domain catalog metric is invalid.");
  }
  return metric;
}

function nullableMetric(value: unknown): string | null {
  return value === null ? null : boundedMetric(value);
}

function nullableCapability(value: unknown): string | null {
  if (value === null) return null;
  const capability = boundedId(value, "capability");
  if (!/^[a-z][a-z0-9_-]+:[a-z][a-z0-9_-]+$/.test(capability)) {
    throw new Error("STRATOS domain catalog capability is invalid.");
  }
  return capability;
}

function boundedPrefix(value: unknown, name: string): string {
  if (
    typeof value !== "string"
    || value.length < 2
    || value.length > 160
    || !/^[A-Za-z0-9._:-]+:$/.test(value)
  ) {
    throw new Error(`STRATOS domain catalog ${name} is invalid.`);
  }
  return value;
}

function nonEmptyStringArray(value: unknown, name: string): string[] {
  const items = arrayValue(value, name);
  if (!items.length || items.length > 20) {
    throw new Error(`STRATOS domain catalog ${name} has an invalid item count.`);
  }
  const strings = items.map((item) => boundedId(item, name));
  if (new Set(strings).size !== strings.length) {
    throw new Error(`STRATOS domain catalog ${name} contains duplicates.`);
  }
  return strings;
}
