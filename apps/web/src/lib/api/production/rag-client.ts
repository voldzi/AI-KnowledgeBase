import type { ApiRequestContext, RagAnswer, RagApiClient, RagQueryRequest } from "@/lib/types";

import type { AklFetch } from "../http-client";
import { requestJson } from "../http-client";

export class ProductionRagClient implements RagApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher?: AklFetch
  ) {}

  query(request: RagQueryRequest, context: ApiRequestContext): Promise<RagAnswer> {
    return requestJson<RagAnswer>({
      service: "rag-retrieval-service",
      operation: "query",
      baseUrl: this.baseUrl,
      path: "/rag/query",
      method: "POST",
      body: request,
      context,
      fetcher: this.fetcher
    });
  }
}
