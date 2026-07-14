import { PageHeader } from "@/components/page-header";
import { IntelligenceWorkbench } from "@/features/intelligence/intelligence-workbench";
import {
  getServerApiClients,
  getServerRequestContextForPath,
} from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";
import { authorizeIntelligenceScope } from "@/lib/intelligence/scope-authorization";
import type { AnalystCase, EntityFacetReport } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/intelligence");
  requirePageAccess(context, "intelligence");

  const [documents, summary, readiness, analystCases] = await Promise.all([
    clients.registry.listDocuments(context),
    clients.registry.getDocumentMetadataSummary(context, {
      topics: ["all documents"],
    }),
    clients.registry.getDocumentReadinessReport(context, {
      maxIssues: 24,
    }),
    clients.registry.listAnalystCases(context).catch(() => [] as AnalystCase[]),
  ]);
  const entityFacets = await authorizeIntelligenceScope(
    clients,
    context,
    documents.map((document) => document.document_id),
  )
    .then((scope) =>
      clients.ingestion.getEntityFacets(context, {
        ...scope,
        limit: 8,
        valueLimit: 8,
      }),
    )
    .catch(() => unavailableEntityFacets());

  return (
    <>
      <PageHeader
        title={{
          cs: "Intelligence Workbench",
          en: "Intelligence Workbench",
        }}
        description={{
          cs: "Analytická pracovní plocha nad řízenými dokumenty, metadaty, připraveností korpusu a dohledatelnými zdrojovými vazbami.",
          en: "Analyst work surface over controlled documents, metadata, corpus readiness and traceable source links.",
        }}
      />
      <IntelligenceWorkbench
        documents={documents}
        summary={summary}
        readiness={readiness}
        entityFacets={entityFacets}
        analystCases={analystCases}
        generatedAtIso={readiness.generated_at}
      />
    </>
  );
}

function unavailableEntityFacets(): EntityFacetReport {
  return {
    status: "unavailable",
    index_name: "akl_document_chunks",
    total_chunks: 0,
    chunks_with_entities: 0,
    entity_types: [],
    entity_groups: [],
    generated_at: new Date().toISOString(),
    warnings: [
      {
        code: "ENTITY_FACETS_UNAVAILABLE",
        message: "Entity facets are not available from the ingestion service.",
      },
    ],
  };
}
