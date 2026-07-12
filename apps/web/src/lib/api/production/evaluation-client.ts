import type {
  ApiRequestContext,
  EvaluationApiClient,
  EvaluationDataset,
  EvaluationDatasetCreate,
  EvaluationQualityOverview,
  EvaluationRun,
  EvaluationRunRequest
} from "@/lib/types";

import type { AklFetch } from "../http-client";
import { requestJson } from "../http-client";

export class ProductionEvaluationClient implements EvaluationApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher?: AklFetch
  ) {}

  getQualityOverview(
    context: ApiRequestContext,
    options: { datasetId?: string; limit?: number } = {}
  ): Promise<EvaluationQualityOverview> {
    const query = new URLSearchParams();
    if (options.datasetId) query.set("dataset_id", options.datasetId);
    if (options.limit) query.set("limit", String(options.limit));
    const suffix = query.size ? `?${query.toString()}` : "";
    return requestJson<EvaluationQualityOverview>({
      service: "evaluation-service",
      operation: "getQualityOverview",
      baseUrl: this.baseUrl,
      path: `/evaluations/quality/overview${suffix}`,
      context,
      fetcher: this.fetcher
    });
  }

  createDataset(
    request: EvaluationDatasetCreate,
    context: ApiRequestContext
  ): Promise<EvaluationDataset> {
    return requestJson<EvaluationDataset>({
      service: "evaluation-service",
      operation: "createEvaluationDataset",
      baseUrl: this.baseUrl,
      path: "/evaluations/datasets",
      method: "POST",
      body: request,
      context,
      fetcher: this.fetcher
    });
  }

  runEvaluation(
    request: EvaluationRunRequest,
    context: ApiRequestContext
  ): Promise<EvaluationRun> {
    return requestJson<EvaluationRun>({
      service: "evaluation-service",
      operation: "runEvaluation",
      baseUrl: this.baseUrl,
      path: "/evaluations/runs",
      method: "POST",
      body: request,
      context,
      fetcher: this.fetcher
    });
  }
}
