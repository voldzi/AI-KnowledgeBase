import type {
  ApiRequestContext,
  CreateIngestionJobRequest,
  IngestionApiClient,
  IngestionJob,
  IngestionReport
} from "@/lib/types";

import type { AklFetch } from "../http-client";
import { requestJson } from "../http-client";

export class ProductionIngestionClient implements IngestionApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher?: AklFetch
  ) {}

  listJobs(context: ApiRequestContext): Promise<IngestionJob[]> {
    return requestJson<IngestionJob[]>({
      service: "ingestion-service",
      operation: "listJobs",
      baseUrl: this.baseUrl,
      path: "/ingestion/jobs",
      context,
      fetcher: this.fetcher
    });
  }

  getJob(jobId: string, context: ApiRequestContext): Promise<IngestionJob> {
    return requestJson<IngestionJob>({
      service: "ingestion-service",
      operation: "getJob",
      baseUrl: this.baseUrl,
      path: `/ingestion/jobs/${jobId}`,
      context,
      fetcher: this.fetcher
    });
  }

  createJob(request: CreateIngestionJobRequest, context: ApiRequestContext): Promise<IngestionJob> {
    return requestJson<IngestionJob>({
      service: "ingestion-service",
      operation: "createJob",
      baseUrl: this.baseUrl,
      path: "/ingestion/jobs",
      method: "POST",
      body: request,
      context,
      fetcher: this.fetcher
    });
  }

  getReport(jobId: string, context: ApiRequestContext): Promise<IngestionReport> {
    return requestJson<IngestionReport>({
      service: "ingestion-service",
      operation: "getReport",
      baseUrl: this.baseUrl,
      path: `/ingestion/jobs/${jobId}/report`,
      context,
      fetcher: this.fetcher
    });
  }

  cancelJob(jobId: string, context: ApiRequestContext): Promise<IngestionJob> {
    return requestJson<IngestionJob>({
      service: "ingestion-service",
      operation: "cancelJob",
      baseUrl: this.baseUrl,
      path: `/ingestion/jobs/${jobId}/cancel`,
      method: "POST",
      context,
      fetcher: this.fetcher
    });
  }
}
