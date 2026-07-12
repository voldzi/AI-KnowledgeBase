import type {
  ApiRequestContext,
  EvaluationApiClient,
  EvaluationDataset,
  EvaluationDatasetCreate,
  EvaluationDatasetSummary,
  EvaluationQualityOverview,
  EvaluationRun,
  EvaluationRunRequest,
  EvaluationSummary
} from "@/lib/types";

const now = "2026-07-10T10:00:00Z";

const seedDataset: EvaluationDatasetSummary = {
  dataset_id: "sample_rag_eval",
  name: "Sample RAG Evaluation",
  description: "Deterministický smoke dataset pro retrieval a citace.",
  tags: ["smoke", "rag"],
  case_count: 2,
  created_at: now,
  visibility: "shared",
  owner_subject_id: null,
  draft_cases: 0,
  silver_cases: 0,
  gold_cases: 2,
  roles: ["employee"],
  query_categories: ["procedural", "negative_control"]
};

const perfectSummary: EvaluationSummary = {
  total_cases: 2,
  passed_cases: 2,
  failed_cases: 0,
  error_cases: 0,
  average_score: 1,
  average_latency_ms: 180,
  retrieval_precision: 1,
  retrieval_recall: 1,
  citation_correctness: 1,
  answer_correctness: 1,
  faithfulness: 1,
  no_answer_correctness: 1,
  retrieval_hit_rate: 1,
  retrieval_mrr: 1,
  retrieval_ndcg: 1,
  zero_result_rate: 0.5,
  false_zero_result_rate: 0,
  authorization_leak_rate: 0,
  citation_traceability: 1,
  retrieval_latency_p50_ms: 55,
  retrieval_latency_p95_ms: 72,
  total_latency_p95_ms: 250,
  full_answer_cases: 2,
  retrieval_only_cases: 0,
  draft_cases: 0,
  silver_cases: 0,
  gold_cases: 2,
  failure_counts: {},
  role_slices: [
    {
      key: "employee",
      total_cases: 2,
      average_score: 1,
      retrieval_recall: 1,
      retrieval_ndcg: 1,
      false_zero_result_rate: 0,
      citation_traceability: 1,
      retrieval_latency_p95_ms: 72
    }
  ],
  query_category_slices: []
};

const mockEvaluationDatasets: EvaluationDatasetSummary[] = [seedDataset];
let mockEvaluationRuns: EvaluationRun[] = [];

export class MockEvaluationClient implements EvaluationApiClient {
  async getQualityOverview(
    _context: ApiRequestContext,
    options: { datasetId?: string; limit?: number } = {}
  ): Promise<EvaluationQualityOverview> {
    const filtered = options.datasetId
      ? mockEvaluationRuns.filter((run) => run.dataset_id === options.datasetId)
      : mockEvaluationRuns;
    return {
      datasets: mockEvaluationDatasets,
      recent_runs: filtered.slice(0, options.limit ?? 20),
      latest_run: filtered[0] ?? null,
      thresholds: {
        retrieval_recall_min: 0.95,
        retrieval_ndcg_min: 0.85,
        false_zero_result_rate_max: 0.02,
        authorization_leak_rate_max: 0,
        citation_traceability_min: 1,
        retrieval_latency_p95_ms_max: 3000
      },
      generated_at: now
    };
  }

  async createDataset(
    request: EvaluationDatasetCreate,
    context: ApiRequestContext
  ): Promise<EvaluationDataset> {
    const datasetId = request.dataset_id ?? `dataset_${mockEvaluationDatasets.length + 1}`;
    const dataset: EvaluationDataset = {
      ...request,
      dataset_id: datasetId,
      owner_subject_id: context.subjectId,
      created_at: now
    };
    mockEvaluationDatasets.unshift({
      dataset_id: datasetId,
      name: request.name,
      description: request.description,
      tags: request.tags,
      case_count: request.cases.length,
      created_at: now,
      visibility: request.visibility,
      owner_subject_id: context.subjectId,
      draft_cases: request.cases.filter((item) => item.judgment_status === "draft").length,
      silver_cases: request.cases.filter((item) => item.judgment_status === "silver").length,
      gold_cases: request.cases.filter((item) => item.judgment_status === "gold").length,
      roles: [...new Set(request.cases.map((item) => item.role))],
      query_categories: [...new Set(request.cases.map((item) => item.query_category))]
    });
    return dataset;
  }

  async runEvaluation(
    request: EvaluationRunRequest,
    context: ApiRequestContext
  ): Promise<EvaluationRun> {
    const dataset = mockEvaluationDatasets.find((item) => item.dataset_id === request.dataset_id) ?? seedDataset;
    const roleSlices = dataset.roles.map((role) => ({
      key: role,
      total_cases: dataset.case_count,
      average_score: 1,
      retrieval_recall: 1,
      retrieval_ndcg: 1,
      false_zero_result_rate: 0,
      citation_traceability: 1,
      retrieval_latency_p95_ms: 72
    }));
    const summary = {
      ...perfectSummary,
      total_cases: dataset.case_count,
      passed_cases: dataset.case_count,
      role_slices: roleSlices
    };
    const run: EvaluationRun = {
      run_id: `eval_run_mock_${mockEvaluationRuns.length + 1}`,
      dataset_id: dataset.dataset_id,
      dataset_name: dataset.name,
      status: "completed",
      started_at: now,
      finished_at: now,
      summary,
      quality_gate: {
        status: "passed",
        eligible_cases: dataset.case_count,
        excluded_draft_cases: dataset.draft_cases,
        checks: [
          { key: "retrieval_recall", actual: 1, operator: ">=", threshold: 0.95, passed: true, eligible: true },
          { key: "retrieval_ndcg", actual: 1, operator: ">=", threshold: 0.85, passed: true, eligible: true },
          { key: "false_zero_result_rate", actual: 0, operator: "<=", threshold: 0.02, passed: true, eligible: true },
          { key: "authorization_leak_rate", actual: 0, operator: "<=", threshold: 0, passed: true, eligible: false },
          { key: "citation_traceability", actual: 1, operator: ">=", threshold: 1, passed: true, eligible: true },
          { key: "retrieval_latency_p95_ms", actual: 72, operator: "<=", threshold: 3000, passed: true, eligible: true }
        ]
      },
      comparison: null,
      actor_subject_id: context.subjectId,
      actor_roles: context.roles ?? [],
      cases: [],
      settings: {}
    };
    mockEvaluationRuns = [run, ...mockEvaluationRuns];
    return run;
  }
}
