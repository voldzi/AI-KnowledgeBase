import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  domainCatalogMetric,
  domainCatalogStatus,
  domainCatalogToolForApplication,
  stratosDomainCatalog,
} from "../src/lib/director-copilot/domain-catalog";
import {
  STRATOS_SEMANTIC_METRICS,
  pendingSemanticSources,
} from "../src/lib/director-copilot/semantic-catalog";

describe("STRATOS domain tool catalog", () => {
  it("defines every source once and keeps pending tools fail closed", () => {
    assert.deepEqual(
      stratosDomainCatalog.tools.map((tool) => tool.application).sort(),
      ["aiip", "akb", "archflow", "budget", "projectflow"],
    );
    assert.deepEqual(pendingSemanticSources(["budget", "archflow", "aiip"]), [
      "archflow",
      "aiip",
    ]);
    assert.equal(domainCatalogToolForApplication("budget").status, "connected");
    assert.equal(domainCatalogToolForApplication("archflow").status, "contract_ready");
  });

  it("covers every semantic metric with a source-owned fact contract", () => {
    for (const metric of STRATOS_SEMANTIC_METRICS) {
      const catalogMetric = domainCatalogMetric(metric.id);
      assert.ok(catalogMetric, metric.id);
    }
    assert.equal(
      domainCatalogMetric("relation.archflow_need_canonical_id")?.value_type,
      "text",
    );
  });

  it("declares only governed cross-application join strategies", () => {
    const status = domainCatalogStatus();
    assert.equal(status.relationship_count, 5);
    assert.ok(status.connected_tools.includes("budget.project_financial_snapshot.v1"));
    assert.ok(status.contract_ready_tools.includes("aiip.idea_portfolio_snapshot.v1"));
    assert.ok(
      stratosDomainCatalog.relationships.every((relationship) => (
        relationship.strategy === "shared_canonical_id"
        || relationship.strategy === "context_tag"
        || (
          relationship.strategy === "declared_relation_fact"
          && relationship.relation_metric !== null
        )
      )),
    );
  });

  it("keeps the machine-readable catalog aligned with the published schema", () => {
    const schema = JSON.parse(readFileSync(
      new URL(
        "../../../contracts/stratos-domain-catalog/v1/catalog.schema.json",
        import.meta.url,
      ),
      "utf8",
    )) as { properties?: { schema_version?: { const?: string } } };
    assert.equal(
      schema.properties?.schema_version?.const,
      stratosDomainCatalog.schema_version,
    );
  });
});
