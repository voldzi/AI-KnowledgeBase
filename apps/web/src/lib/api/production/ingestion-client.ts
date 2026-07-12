import type {
  AnalystSearchRequest,
  AnalystSearchResponse,
  ApiRequestContext,
  CreateIngestionJobRequest,
  EntityFacetReport,
  EntityRelationshipRequest,
  EntityRelationshipResponse,
  EntitySearchRequest,
  EntitySearchResponse,
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

  getEntityFacets(
    context: ApiRequestContext,
    options: { limit?: number; valueLimit?: number } = {}
  ): Promise<EntityFacetReport> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    if (options.valueLimit !== undefined) {
      params.set("value_limit", String(options.valueLimit));
    }
    const query = params.toString();
    return requestJson<EntityFacetReport>({
      service: "ingestion-service",
      operation: "getEntityFacets",
      baseUrl: this.baseUrl,
      path: `/intelligence/entities/facets${query ? `?${query}` : ""}`,
      context,
      fetcher: this.fetcher
    });
  }

  searchEntities(request: EntitySearchRequest, context: ApiRequestContext): Promise<EntitySearchResponse> {
    return requestJson<EntitySearchResponse>({
      service: "ingestion-service",
      operation: "searchEntities",
      baseUrl: this.baseUrl,
      path: "/intelligence/entities/search",
      method: "POST",
      body: request,
      context,
      fetcher: this.fetcher
    });
  }

  analystSearch(request: AnalystSearchRequest, context: ApiRequestContext): Promise<AnalystSearchResponse> {
    return requestJson<AnalystSearchResponse>({
      service: "ingestion-service",
      operation: "analystSearch",
      baseUrl: this.baseUrl,
      path: "/intelligence/analyst/search",
      method: "POST",
      body: request,
      context,
      fetcher: this.fetcher
    });
  }

  getEntityRelationships(
    request: EntityRelationshipRequest,
    context: ApiRequestContext
  ): Promise<EntityRelationshipResponse> {
    return requestJson<EntityRelationshipResponse>({
      service: "ingestion-service",
      operation: "getEntityRelationships",
      baseUrl: this.baseUrl,
      path: "/intelligence/entities/relationships",
      method: "POST",
      body: request,
      context,
      fetcher: this.fetcher
    });
  }
}
