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
  IngestionCreateOptions,
  IngestionAuthorizationOptions,
  IntelligenceScopeAuthorizationOptions,
  IngestionApiClient,
  IngestionJob,
  IngestionReport
} from "@/lib/types";
import { ApiClientError } from "@/lib/types";
import {
  assertIntelligenceAuthorizationOptions,
  bindAuthorizedDocumentScope,
} from "@/lib/intelligence/authorization-contract";

import type { AklFetch } from "../http-client";
import { requestJson } from "../http-client";

export class ProductionIngestionClient implements IngestionApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher?: AklFetch
  ) {}

  listJobs(context: ApiRequestContext): Promise<IngestionJob[]> {
    return Promise.reject(new ApiClientError(
      "The AKB web application must project ingestion jobs through Registry-visible documents.",
      403,
      "INGESTION_GLOBAL_LIST_FORBIDDEN",
      context.correlationId ?? context.requestId ?? "registry-ingestion-projection",
    ));
  }

  getJob(
    jobId: string,
    context: ApiRequestContext,
    options: IngestionAuthorizationOptions,
  ): Promise<IngestionJob> {
    return requestJson<IngestionJob>({
      service: "ingestion-service",
      operation: "getJob",
      baseUrl: this.baseUrl,
      path: `/ingestion/jobs/${encodeURIComponent(jobId)}`,
      context,
      fetcher: this.fetcher,
      extraHeaders: exactIngestionAuthorizationHeaders(context, options),
    });
  }

  createJob(
    request: CreateIngestionJobRequest,
    context: ApiRequestContext,
    options: IngestionCreateOptions,
  ): Promise<IngestionJob> {
    return requestJson<IngestionJob>({
      service: "ingestion-service",
      operation: "createJob",
      baseUrl: this.baseUrl,
      path: "/ingestion/jobs",
      method: "POST",
      body: request,
      context,
      fetcher: this.fetcher,
      extraHeaders: exactIngestionAuthorizationHeaders(context, options),
    });
  }

  getReport(
    jobId: string,
    context: ApiRequestContext,
    options: IngestionAuthorizationOptions,
  ): Promise<IngestionReport> {
    return requestJson<IngestionReport>({
      service: "ingestion-service",
      operation: "getReport",
      baseUrl: this.baseUrl,
      path: `/ingestion/jobs/${encodeURIComponent(jobId)}/report`,
      context,
      fetcher: this.fetcher,
      extraHeaders: exactIngestionAuthorizationHeaders(context, options),
    });
  }

  cancelJob(
    jobId: string,
    context: ApiRequestContext,
    options: IngestionAuthorizationOptions,
  ): Promise<IngestionJob> {
    return requestJson<IngestionJob>({
      service: "ingestion-service",
      operation: "cancelJob",
      baseUrl: this.baseUrl,
      path: `/ingestion/jobs/${encodeURIComponent(jobId)}/cancel`,
      method: "POST",
      context,
      fetcher: this.fetcher,
      extraHeaders: exactIngestionAuthorizationHeaders(context, options),
    });
  }

  getEntityFacets(
    context: ApiRequestContext,
    options: IntelligenceScopeAuthorizationOptions & { limit?: number; valueLimit?: number }
  ): Promise<EntityFacetReport> {
    return requestJson<EntityFacetReport>({
      service: "ingestion-service",
      operation: "getEntityFacets",
      baseUrl: this.baseUrl,
      path: "/intelligence/entities/facets/query",
      method: "POST",
      body: {
        authorized_documents: options.authorizedDocuments,
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.valueLimit !== undefined
          ? { value_limit: options.valueLimit }
          : {}),
      },
      context: intelligenceAuthorizationContext(context, options),
      fetcher: this.fetcher,
      extraHeaders: intelligenceAuthorizationHeaders(options),
    });
  }

  searchEntities(
    request: EntitySearchRequest,
    context: ApiRequestContext,
    options: IntelligenceScopeAuthorizationOptions,
  ): Promise<EntitySearchResponse> {
    return requestJson<EntitySearchResponse>({
      service: "ingestion-service",
      operation: "searchEntities",
      baseUrl: this.baseUrl,
      path: "/intelligence/entities/search",
      method: "POST",
      body: bindAuthorizedDocuments(request, options),
      context: intelligenceAuthorizationContext(context, options),
      fetcher: this.fetcher,
      extraHeaders: intelligenceAuthorizationHeaders(options),
    });
  }

  analystSearch(
    request: AnalystSearchRequest,
    context: ApiRequestContext,
    options: IntelligenceScopeAuthorizationOptions,
  ): Promise<AnalystSearchResponse> {
    return requestJson<AnalystSearchResponse>({
      service: "ingestion-service",
      operation: "analystSearch",
      baseUrl: this.baseUrl,
      path: "/intelligence/analyst/search",
      method: "POST",
      body: bindAuthorizedDocuments(request, options),
      context: intelligenceAuthorizationContext(context, options),
      fetcher: this.fetcher,
      extraHeaders: intelligenceAuthorizationHeaders(options),
    });
  }

  getEntityRelationships(
    request: EntityRelationshipRequest,
    context: ApiRequestContext,
    options: IntelligenceScopeAuthorizationOptions,
  ): Promise<EntityRelationshipResponse> {
    return requestJson<EntityRelationshipResponse>({
      service: "ingestion-service",
      operation: "getEntityRelationships",
      baseUrl: this.baseUrl,
      path: "/intelligence/entities/relationships",
      method: "POST",
      body: bindAuthorizedDocuments(request, options),
      context: intelligenceAuthorizationContext(context, options),
      fetcher: this.fetcher,
      extraHeaders: intelligenceAuthorizationHeaders(options),
    });
  }
}

const WEB_INGESTION_CLIENT_ID = "svc-akb-web-ingestion";
const WEB_INGESTION_SUBJECT = `service-account-${WEB_INGESTION_CLIENT_ID}`;
const WEB_INGESTION_ROLE = "service_akb_web_ingestion";
const ACTOR_SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,127}$/;

function exactIngestionAuthorizationHeaders(
  context: ApiRequestContext,
  options: IngestionAuthorizationOptions,
): Record<string, string> {
  if (
    context.serviceClientId !== WEB_INGESTION_CLIENT_ID
    || context.subjectId !== WEB_INGESTION_SUBJECT
    || !context.roles?.includes(WEB_INGESTION_ROLE)
  ) {
    throw new ApiClientError(
      "Exact ingestion operations require the dedicated web ingestion transport.",
      503,
      "INGESTION_TRANSPORT_AUTH_REQUIRED",
      context.correlationId ?? context.requestId ?? "web-ingestion-transport",
    );
  }
  if (
    typeof options?.delegatedActorSubjectId !== "string"
    || !ACTOR_SUBJECT_PATTERN.test(options.delegatedActorSubjectId)
  ) {
    throw new ApiClientError(
      "Exact ingestion operations require a bounded delegated actor.",
      400,
      "INGESTION_DELEGATED_ACTOR_INVALID",
      context.correlationId ?? context.requestId ?? "web-ingestion-transport",
    );
  }
  if (
    typeof options?.authorizationToken !== "string"
    || options.authorizationToken.length < 32
    || options.authorizationToken.length > 4096
    || /\s/.test(options.authorizationToken)
  ) {
    throw new ApiClientError(
      "Exact ingestion operations require a bounded Registry authorization proof.",
      401,
      "INGESTION_AUTHORIZATION_REQUIRED",
      context.correlationId ?? context.requestId ?? "web-ingestion-transport",
    );
  }
  return {
    "X-AKL-On-Behalf-Of": options.delegatedActorSubjectId,
    "X-AKL-Ingestion-Authorization": options.authorizationToken,
  };
}

function intelligenceAuthorizationHeaders(
  options: IntelligenceScopeAuthorizationOptions,
): Record<string, string> {
  assertIntelligenceAuthorizationOptions(options, options.correlationId);
  return {
    "X-AKL-Intelligence-Authorization": options.authorizationToken,
    "X-AKL-Intelligence-Idempotency-Key": options.idempotencyKey,
  };
}

function intelligenceAuthorizationContext(
  context: ApiRequestContext,
  options: IntelligenceScopeAuthorizationOptions,
): ApiRequestContext {
  return {
    ...context,
    requestId: options.correlationId,
    correlationId: options.correlationId,
  };
}

function bindAuthorizedDocuments<
  T extends EntitySearchRequest | AnalystSearchRequest | EntityRelationshipRequest,
>(request: T, options: IntelligenceScopeAuthorizationOptions): T {
  return bindAuthorizedDocumentScope(request, options);
}
