import { PageHeader } from "@/components/page-header";
import { RetrievalQualityLab } from "@/features/intelligence/retrieval-quality-lab";
import {
  getServerApiClients,
  getServerRequestContextForPath
} from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";
import type { DocumentReadinessReport, EvaluationQualityOverview } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RetrievalQualityPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/intelligence/quality");
  requirePageAccess(context, "intelligence");

  const [qualityResult, readinessResult] = await Promise.allSettled([
    clients.evaluation.getQualityOverview(context, { limit: 20 }),
    clients.registry.getDocumentReadinessReport(context, { maxIssues: 12 })
  ]);
  const quality =
    qualityResult.status === "fulfilled"
      ? qualityResult.value
      : unavailableQualityOverview();
  const readiness =
    readinessResult.status === "fulfilled"
      ? readinessResult.value
      : unavailableReadiness();

  return (
    <>
      <PageHeader
        title={{ cs: "Kvalita vyhledávání", en: "Retrieval Quality" }}
        description={{
          cs: "Měřitelné ověřování retrievalu, citací, nulových výsledků a připravenosti dokumentového korpusu.",
          en: "Measurable validation of retrieval, citations, zero results and corpus readiness."
        }}
      />
      <RetrievalQualityLab
        initialOverview={quality}
        readiness={readiness}
        serviceAvailable={qualityResult.status === "fulfilled"}
      />
    </>
  );
}

function unavailableQualityOverview(): EvaluationQualityOverview {
  return {
    datasets: [],
    recent_runs: [],
    latest_run: null,
    thresholds: {
      retrieval_recall_min: 0.95,
      retrieval_ndcg_min: 0.85,
      false_zero_result_rate_max: 0.02,
      authorization_leak_rate_max: 0,
      citation_traceability_min: 1,
      retrieval_latency_p95_ms_max: 3000
    },
    generated_at: new Date().toISOString()
  };
}

function unavailableReadiness(): DocumentReadinessReport {
  return {
    generated_at: new Date().toISOString(),
    total_visible_documents: 0,
    ready_documents: 0,
    review_documents: 0,
    blocked_documents: 0,
    readiness_score: 0,
    issue_counts: [],
    by_severity: [],
    by_document_type: [],
    by_classification: [],
    by_status: [],
    issues: [],
    warnings: ["CORPUS_READINESS_UNAVAILABLE"]
  };
}
