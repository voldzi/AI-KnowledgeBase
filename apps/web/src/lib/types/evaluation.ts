export type EvaluationRole =
  | "employee"
  | "analyst"
  | "document_manager"
  | "auditor"
  | "administrator"
  | "leadership"
  | "service";

export type EvaluationQueryCategory =
  | "exact_title"
  | "exact_identifier"
  | "semantic"
  | "procedural"
  | "comparative"
  | "entity"
  | "negative_control"
  | "authorization";

export type EvaluationJudgmentStatus = "draft" | "silver" | "gold";
export type EvaluationGateStatus = "passed" | "failed" | "not_evaluated";

export interface EvaluationDatasetSummary {
  dataset_id: string;
  name: string;
  description: string;
  tags: string[];
  case_count: number;
  created_at: string;
  visibility: "private" | "shared";
  owner_subject_id: string | null;
  draft_cases: number;
  silver_cases: number;
  gold_cases: number;
  roles: EvaluationRole[];
  query_categories: EvaluationQueryCategory[];
}

export interface EvaluationCaseCreate {
  case_id: string;
  subject_id: string;
  query: string;
  filters: {
    document_types: string[];
    only_valid: boolean;
    classification_max: "public" | "internal" | "restricted" | "confidential";
    tags: string[];
  };
  answer_mode: "normative_with_citations" | "retrieve_only" | "compare";
  max_chunks: number;
  expected_answer_terms: string[];
  forbidden_answer_terms: string[];
  expected_citations: Array<Record<string, unknown>>;
  expected_relevant_chunk_ids: string[];
  expected_relevant_document_ids: string[];
  relevance_judgments: Array<{ chunk_id: string; relevance: number }>;
  expected_forbidden_chunk_ids: string[];
  expected_no_answer: boolean;
  role: EvaluationRole;
  query_category: EvaluationQueryCategory;
  judgment_status: EvaluationJudgmentStatus;
  weight: number;
  metadata: Record<string, unknown>;
}

export interface EvaluationDatasetCreate {
  dataset_id?: string;
  name: string;
  description: string;
  tags: string[];
  visibility: "private" | "shared";
  cases: EvaluationCaseCreate[];
  metadata: Record<string, unknown>;
}

export interface EvaluationDataset extends EvaluationDatasetCreate {
  dataset_id: string;
  owner_subject_id: string | null;
  created_at: string;
}

export interface EvaluationSliceSummary {
  key: string;
  total_cases: number;
  average_score: number;
  retrieval_recall: number;
  retrieval_ndcg: number;
  false_zero_result_rate: number;
  citation_traceability: number;
  retrieval_latency_p95_ms: number;
}

export interface EvaluationSummary {
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  error_cases: number;
  average_score: number;
  average_latency_ms: number;
  retrieval_precision: number;
  retrieval_recall: number;
  citation_correctness: number;
  answer_correctness: number;
  faithfulness: number;
  no_answer_correctness: number;
  retrieval_hit_rate: number;
  retrieval_mrr: number;
  retrieval_ndcg: number;
  zero_result_rate: number;
  false_zero_result_rate: number;
  authorization_leak_rate: number;
  citation_traceability: number;
  retrieval_latency_p50_ms: number;
  retrieval_latency_p95_ms: number;
  total_latency_p95_ms: number;
  full_answer_cases: number;
  retrieval_only_cases: number;
  draft_cases: number;
  silver_cases: number;
  gold_cases: number;
  failure_counts: Record<string, number>;
  role_slices: EvaluationSliceSummary[];
  query_category_slices: EvaluationSliceSummary[];
}

export interface EvaluationQualityGateCheck {
  key: string;
  actual: number;
  operator: ">=" | "<=";
  threshold: number;
  passed: boolean;
  eligible: boolean;
}

export interface EvaluationQualityGate {
  status: EvaluationGateStatus;
  checks: EvaluationQualityGateCheck[];
  eligible_cases: number;
  excluded_draft_cases: number;
}

export interface EvaluationRunComparison {
  baseline_run_id: string;
  average_score_delta: number;
  retrieval_recall_delta: number;
  retrieval_ndcg_delta: number;
  false_zero_result_rate_delta: number;
  citation_traceability_delta: number;
  retrieval_latency_p95_ms_delta: number;
  regressions: string[];
}

export interface EvaluationCaseResult {
  case_id: string;
  status: "passed" | "failed" | "error";
  overall_score: number;
  latency_ms: number;
  retrieval_latency_ms: number;
  answer_latency_ms: number;
  role: EvaluationRole;
  query_category: EvaluationQueryCategory;
  judgment_status: EvaluationJudgmentStatus;
  expected_no_answer: boolean;
  retrieval_only: boolean;
  failure_stage: string;
  warnings: string[];
  error_code: string | null;
  retrieval_metrics: {
    precision: number;
    recall: number;
    hit_rate: number;
    mrr: number;
    ndcg: number;
    retrieved_count: number;
    zero_result: boolean;
    false_zero_result: boolean;
    authorization_leak_rate: number;
  };
}

export interface EvaluationRunSummary {
  run_id: string;
  dataset_id: string;
  dataset_name: string;
  status: "completed" | "completed_with_errors";
  started_at: string;
  finished_at: string;
  summary: EvaluationSummary;
  quality_gate: EvaluationQualityGate | null;
  comparison: EvaluationRunComparison | null;
  actor_subject_id: string | null;
}

export interface EvaluationRun extends EvaluationRunSummary {
  cases: EvaluationCaseResult[];
  settings: Record<string, unknown>;
  actor_roles: string[];
}

export interface EvaluationQualityOverview {
  datasets: EvaluationDatasetSummary[];
  recent_runs: EvaluationRunSummary[];
  latest_run: EvaluationRun | null;
  thresholds: {
    retrieval_recall_min: number;
    retrieval_ndcg_min: number;
    false_zero_result_rate_max: number;
    authorization_leak_rate_max: number;
    citation_traceability_min: number;
    retrieval_latency_p95_ms_max: number;
  };
  generated_at: string;
}

export interface EvaluationRunRequest {
  dataset_id: string;
  subject_id_override?: string;
  max_cases?: number;
}
