import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SNAPSHOT_VERSION = "stratos-semantic-registry-snapshot-1";
const BINDINGS_VERSION = "stratos-semantic-registry-bindings-1";
const ENDPOINT = "https://xn--slovnk-7va.gov.cz/sparql";
const PAGE_SIZE = 500;
const MAX_CONCEPTS = 20_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const SOURCE_IDS = new Set(["budget", "projectflow", "archflow", "aiip"]);
const METRIC_IDS = new Set([
  "budget.plan_amount",
  "budget.actual_amount",
  "budget.forecast_amount",
  "budget.commitments_amount",
  "budget.variance_amount",
  "project.status",
  "project.schedule_status",
  "milestone.max_delay_days",
  "milestone.next_due_date",
  "archflow.need.status",
  "archflow.need.readiness_score",
  "archflow.need.impact_score",
  "archflow.need.decision",
  "archflow.need.budget_handoff_status",
  "aiip.idea.status",
  "aiip.idea.value_score",
  "aiip.idea.risk_score",
  "aiip.idea.expected_benefit",
  "aiip.idea.handoff_status",
]);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = resolve(
  SCRIPT_DIR,
  "../src/lib/director-copilot/data/ssp-cs.snapshot.json",
);
const DEFAULT_BINDINGS = resolve(
  SCRIPT_DIR,
  "../src/lib/director-copilot/data/semantic-registry-bindings.json",
);

const args = parseArgs(process.argv.slice(2));
const outputPath = resolve(args.output ?? DEFAULT_OUTPUT);
const bindingsPath = resolve(args.bindings ?? DEFAULT_BINDINGS);

if (args.check) {
  const snapshot = JSON.parse(await readFile(outputPath, "utf8"));
  verifySnapshot(snapshot);
  process.stdout.write(
    `Semantic registry snapshot ${snapshot.snapshot_id} is valid `
    + `(${snapshot.concept_count} concepts, ${snapshot.binding_count} bindings).\n`,
  );
  process.exit(0);
}

const bindingsDocument = JSON.parse(await readFile(bindingsPath, "utf8"));
const bindings = validateBindings(bindingsDocument);
const conceptsByUri = new Map();

for (let offset = 0; offset < MAX_CONCEPTS; offset += PAGE_SIZE) {
  const page = await fetchConceptPage(offset, PAGE_SIZE);
  for (const binding of page) {
    const concept = parseConcept(binding);
    if (!concept) continue;
    const existing = conceptsByUri.get(concept.uri);
    conceptsByUri.set(concept.uri, existing ? mergeConcepts(existing, concept) : concept);
  }
  process.stderr.write(`SSP sync: ${conceptsByUri.size} concepts loaded.\n`);
  if (page.length < PAGE_SIZE) break;
}

const concepts = [...conceptsByUri.values()]
  .sort((left, right) => left.uri.localeCompare(right.uri, "cs"));
if (concepts.length === 0 || concepts.length >= MAX_CONCEPTS) {
  throw new Error("SSP_CONCEPT_COUNT_OUT_OF_RANGE");
}

const conceptUris = new Set(concepts.map((concept) => concept.uri));
for (const binding of bindings) {
  if (!conceptUris.has(binding.concept_uri)) {
    throw new Error(`SSP_BINDING_CONCEPT_MISSING: ${binding.concept_uri}`);
  }
}

const hashInput = stableStringify({ concepts, bindings });
const contentSha256 = createHash("sha256").update(hashInput).digest("hex");
const snapshot = {
  schema_version: SNAPSHOT_VERSION,
  snapshot_id: `ssp-cz-${contentSha256.slice(0, 16)}`,
  generated_at: new Date().toISOString(),
  source: {
    id: "ssp-cz",
    name: "Sémantický slovník pojmů veřejné správy",
    endpoint: ENDPOINT,
    documentation: "https://datagov-cz.github.io/ssp/",
    license: "CC-BY-4.0",
    attribution: "Sémantický slovník pojmů, Digitální a informační agentura",
  },
  concept_count: concepts.length,
  binding_count: bindings.length,
  content_sha256: contentSha256,
  concepts,
  bindings,
};

verifySnapshot(snapshot);
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
process.stdout.write(
  `Wrote ${snapshot.snapshot_id} to ${outputPath} `
  + `(${snapshot.concept_count} concepts, ${snapshot.binding_count} bindings).\n`,
);

async function fetchConceptPage(offset, limit) {
  const query = `
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?concept ?label
       (GROUP_CONCAT(DISTINCT ?alt;separator="||") AS ?aliases)
       (GROUP_CONCAT(DISTINCT STR(?definition);separator="||") AS ?definitions)
       (GROUP_CONCAT(DISTINCT STR(?broader);separator="||") AS ?broaderUris)
       (GROUP_CONCAT(DISTINCT STR(?related);separator="||") AS ?relatedUris)
WHERE {
  ?concept skos:prefLabel ?label .
  FILTER(LANG(?label) = "cs")
  FILTER(CONTAINS(STR(?concept), "/pojem/"))
  OPTIONAL {
    ?concept skos:altLabel ?alt .
    FILTER(LANG(?alt) = "cs" || LANG(?alt) = "")
  }
  OPTIONAL {
    ?concept skos:definition ?definition .
    FILTER(LANG(?definition) = "cs" || LANG(?definition) = "")
  }
  OPTIONAL { ?concept skos:broader ?broader }
  OPTIONAL { ?concept skos:related ?related }
}
GROUP BY ?concept ?label
ORDER BY ?concept
LIMIT ${limit}
OFFSET ${offset}`;
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "application/sparql-results+json");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": "AKB-Semantic-Registry-Sync/1.0",
      },
      signal: AbortSignal.timeout(45_000),
    });
    if (
      !response.ok
      && (response.status === 429 || response.status >= 500)
      && attempt < 3
    ) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1_000));
      continue;
    }
    if (!response.ok) {
      throw new Error(`SSP_UPSTREAM_${response.status}`);
    }
    const finalUrl = new URL(response.url);
    if (
      finalUrl.protocol !== "https:"
      || finalUrl.hostname !== "xn--slovnk-7va.gov.cz"
    ) {
      throw new Error("SSP_REDIRECT_NOT_ALLOWED");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error("SSP_RESPONSE_TOO_LARGE");
    }
    const body = await response.text();
    if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
      throw new Error("SSP_RESPONSE_TOO_LARGE");
    }
    const parsed = JSON.parse(body);
    const rows = parsed?.results?.bindings;
    if (!Array.isArray(rows)) throw new Error("SSP_RESPONSE_INVALID");
    return rows;
  }
  throw new Error("SSP_UPSTREAM_UNAVAILABLE");
}

function parseConcept(binding) {
  const uri = boundedUri(binding?.concept?.value);
  const prefLabel = boundedText(binding?.label?.value, 500);
  if (!uri || !prefLabel) return null;
  return {
    uri,
    pref_label: prefLabel,
    alt_labels: splitValues(binding?.aliases?.value, 500),
    definition: splitValues(binding?.definitions?.value, 4_000)[0] ?? null,
    broader_uris: splitUris(binding?.broaderUris?.value),
    related_uris: splitUris(binding?.relatedUris?.value),
  };
}

function mergeConcepts(left, right) {
  const prefLabel = [left.pref_label, right.pref_label]
    .sort((first, second) => first.localeCompare(second, "cs"))[0];
  const definition = [left.definition, right.definition]
    .filter(Boolean)
    .sort((first, second) => first.localeCompare(second, "cs"))[0] ?? null;
  return {
    uri: left.uri,
    pref_label: prefLabel,
    alt_labels: unique([...left.alt_labels, ...right.alt_labels]).sort(),
    definition,
    broader_uris: unique([...left.broader_uris, ...right.broader_uris]).sort(),
    related_uris: unique([...left.related_uris, ...right.related_uris]).sort(),
  };
}

function validateBindings(document) {
  if (
    document?.schema_version !== BINDINGS_VERSION
    || !Array.isArray(document.bindings)
  ) {
    throw new Error("SEMANTIC_REGISTRY_BINDINGS_INVALID");
  }
  const bindings = document.bindings.map((binding) => {
    const conceptUri = boundedUri(binding?.concept_uri);
    if (
      !conceptUri
      || !Array.isArray(binding?.targets)
      || binding.targets.length === 0
      || binding.targets.length > 8
    ) {
      throw new Error("SEMANTIC_REGISTRY_BINDING_INVALID");
    }
    const targets = binding.targets.map((target) => {
      if (
        (target?.kind !== "source" && target?.kind !== "metric")
        || typeof target?.id !== "string"
        || target.id.length > 100
        || (target.kind === "source" && !SOURCE_IDS.has(target.id))
        || (target.kind === "metric" && !METRIC_IDS.has(target.id))
      ) {
        throw new Error("SEMANTIC_REGISTRY_BINDING_TARGET_INVALID");
      }
      return { kind: target.kind, id: target.id };
    });
    return {
      concept_uri: conceptUri,
      targets,
      approved_at: boundedText(binding.approved_at, 40) ?? "",
      approved_by: boundedText(binding.approved_by, 120) ?? "",
      note: boundedText(binding.note, 500) ?? "",
    };
  });
  return bindings.sort((left, right) => left.concept_uri.localeCompare(right.concept_uri, "cs"));
}

function verifySnapshot(snapshot) {
  if (
    snapshot?.schema_version !== SNAPSHOT_VERSION
    || !Array.isArray(snapshot?.concepts)
    || !Array.isArray(snapshot?.bindings)
    || snapshot.concept_count !== snapshot.concepts.length
    || snapshot.binding_count !== snapshot.bindings.length
    || !/^[a-f0-9]{64}$/.test(snapshot.content_sha256)
  ) {
    throw new Error("SEMANTIC_REGISTRY_SNAPSHOT_INVALID");
  }
  const expected = createHash("sha256")
    .update(stableStringify({
      concepts: snapshot.concepts,
      bindings: snapshot.bindings,
    }))
    .digest("hex");
  if (expected !== snapshot.content_sha256) {
    throw new Error("SEMANTIC_REGISTRY_SNAPSHOT_CHECKSUM_MISMATCH");
  }
  if (snapshot.snapshot_id !== `ssp-cz-${expected.slice(0, 16)}`) {
    throw new Error("SEMANTIC_REGISTRY_SNAPSHOT_ID_MISMATCH");
  }
  const conceptUris = new Set(snapshot.concepts.map((concept) => concept.uri));
  for (const binding of snapshot.bindings) {
    if (!conceptUris.has(binding.concept_uri)) {
      throw new Error("SEMANTIC_REGISTRY_BINDING_CONCEPT_MISSING");
    }
    for (const target of binding.targets) {
      if (
        (target.kind === "source" && !SOURCE_IDS.has(target.id))
        || (target.kind === "metric" && !METRIC_IDS.has(target.id))
      ) {
        throw new Error("SEMANTIC_REGISTRY_BINDING_TARGET_INVALID");
      }
    }
  }
}

function splitValues(value, maxLength) {
  if (typeof value !== "string" || value.length === 0) return [];
  return unique(value.split("||")
    .map((item) => boundedText(item, maxLength))
    .filter(Boolean))
    .sort();
}

function splitUris(value) {
  if (typeof value !== "string" || value.length === 0) return [];
  return unique(value.split("||").map(boundedUri).filter(Boolean)).sort();
}

function boundedText(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function boundedUri(value) {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "xn--slovnk-7va.gov.cz"
      ? value
      : null;
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values)];
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseArgs(values) {
  const parsed = { check: false, output: null, bindings: null };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--check") {
      parsed.check = true;
      continue;
    }
    if (value === "--output" || value === "--bindings") {
      const next = values[index + 1];
      if (!next) throw new Error(`Missing value for ${value}`);
      parsed[value.slice(2)] = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
}
