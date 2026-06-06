import type {
  ApiRequestContext,
  CompareVersionsRequest,
  CompareVersionsResponse,
  ComplianceCheckRequest,
  ComplianceCheckResponse,
  ConflictDetectionRequest,
  ConflictDetectionResponse,
  GovernanceApiClient
} from "@/lib/types";

import type { AklFetch } from "../http-client";
import { requestJson } from "../http-client";

export class ProductionGovernanceClient implements GovernanceApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher?: AklFetch
  ) {}

  compareVersions(request: CompareVersionsRequest, context: ApiRequestContext): Promise<CompareVersionsResponse> {
    return this.post<CompareVersionsResponse>("/governance/compare-versions", request, "compareVersions", context);
  }

  checkCompliance(request: ComplianceCheckRequest, context: ApiRequestContext): Promise<ComplianceCheckResponse> {
    return this.post<ComplianceCheckResponse>("/governance/check-compliance", request, "checkCompliance", context);
  }

  detectConflicts(request: ConflictDetectionRequest, context: ApiRequestContext): Promise<ConflictDetectionResponse> {
    return this.post<ConflictDetectionResponse>("/governance/detect-conflicts", request, "detectConflicts", context);
  }

  private post<T>(path: string, body: unknown, operation: string, context: ApiRequestContext): Promise<T> {
    return requestJson<T>({
      service: "governance-service",
      operation,
      baseUrl: this.baseUrl,
      path,
      method: "POST",
      body,
      context,
      fetcher: this.fetcher
    });
  }
}
