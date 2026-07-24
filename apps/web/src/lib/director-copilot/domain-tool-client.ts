import "server-only";

import { getDirectorCopilotConfig, type AklConfig } from "@/lib/api/config";
import { withCorrelationDefaults } from "@/lib/api/correlation";
import { logIntegrationEvent } from "@/lib/api/logger";
import type { ApiRequestContext } from "@/lib/types";

import {
  DIRECTOR_COPILOT_CONTRACT_VERSION,
  DirectorCopilotContractError,
  parseDomainToolResponse,
  type DomainApplication,
  type DomainToolRequest,
  type DomainToolResponse,
} from "./contracts";
import { directorCopilotServiceToken } from "./service-identity";
import { DirectorCopilotTransportError } from "./transport-error";

const EXECUTE_PATH = "/api/v1/integrations/akb/domain-tools/execute";

export interface DomainToolClientOptions {
  config: AklConfig;
  fetcher?: typeof fetch;
  serviceToken?: () => Promise<string>;
}

export class DirectorDomainToolClient {
  private readonly fetcher: typeof fetch;
  private readonly serviceToken: () => Promise<string>;

  constructor(private readonly options: DomainToolClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.serviceToken = options.serviceToken
      ?? (() => directorCopilotServiceToken(options.config, this.fetcher));
  }

  async execute(
    application: DomainApplication,
    request: DomainToolRequest,
    actorContext: ApiRequestContext,
  ): Promise<DomainToolResponse> {
    if (actorContext.authorizationSource !== "stratos_projection" || !actorContext.accessToken) {
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_ACTOR_PROJECTION_REQUIRED",
        "A fresh projected actor bearer is required.",
        "not_authorized",
        401,
      );
    }
    const config = getDirectorCopilotConfig(this.options.config);
    const baseUrl = application === "budget"
      ? config.budgetBaseUrl
      : config.projectflowBaseUrl;
    if (!baseUrl) {
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_SOURCE_UNCONFIGURED",
        `Director Copilot ${application} source is not configured.`,
        "unavailable",
      );
    }
    const serviceToken = await this.serviceToken();
    if (!serviceToken || serviceToken === actorContext.accessToken) {
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_TOKEN_SEPARATION_REQUIRED",
        "Director Copilot service and actor credentials must be independent.",
        "unavailable",
      );
    }
    const context = withCorrelationDefaults(actorContext);
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.fetcher(`${baseUrl}${EXECUTE_PATH}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${serviceToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": request.tool_call_id,
          "X-Request-ID": context.requestId,
          "X-Correlation-ID": context.correlationId,
          "X-STRATOS-Actor-Authorization": `Bearer ${actorContext.accessToken}`,
          "X-AKB-Domain-Tool-Contract": DIRECTOR_COPILOT_CONTRACT_VERSION,
        },
        body: JSON.stringify(request),
        cache: "no-store",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch {
      this.log("error", application, 0, startedAt, context, "DIRECTOR_COPILOT_SOURCE_UNAVAILABLE");
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_SOURCE_UNAVAILABLE",
        `Director Copilot ${application} source is unavailable.`,
        "unavailable",
      );
    }
    let responseBytes: Uint8Array;
    try {
      responseBytes = await readBoundedBody(response, config.maxResponseBytes);
    } catch (error) {
      if (error instanceof DirectorCopilotTransportError) {
        this.log("error", application, response.status, startedAt, context, error.code);
      }
      throw error;
    }
    if (!response.ok) {
      const outcome = response.status === 401 || response.status === 403 ? "not_authorized" : "unavailable";
      const code = upstreamErrorCode(responseBytes)
        ?? (outcome === "not_authorized"
          ? "DIRECTOR_COPILOT_SOURCE_DENIED"
          : response.status === 503
            ? "DIRECTOR_COPILOT_SOURCE_UNAVAILABLE"
            : "DIRECTOR_COPILOT_SOURCE_FAILED");
      this.log("error", application, response.status, startedAt, context, code);
      throw new DirectorCopilotTransportError(
        code,
        `Director Copilot ${application} source rejected the request.`,
        outcome,
        response.status,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_SOURCE_CONTENT_TYPE_INVALID",
        `Director Copilot ${application} source did not return JSON.`,
        "unavailable",
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(responseBytes));
    } catch {
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_SOURCE_JSON_INVALID",
        `Director Copilot ${application} source returned malformed JSON.`,
        "unavailable",
      );
    }
    let parsed: DomainToolResponse;
    try {
      parsed = parseDomainToolResponse(payload, {
        toolId: request.tool_id,
        toolCallId: request.tool_call_id,
        requestedScopes: request.requested_scopes,
        maxItems: request.parameters.limit,
      });
    } catch (error) {
      if (error instanceof DirectorCopilotContractError) {
        this.log(
          "error",
          application,
          response.status,
          startedAt,
          context,
          "DIRECTOR_COPILOT_SOURCE_CONTRACT_INVALID",
        );
        throw new DirectorCopilotTransportError(
          "DIRECTOR_COPILOT_SOURCE_CONTRACT_INVALID",
          `Director Copilot ${application} source violated the binding contract.`,
          "unavailable",
          response.status,
        );
      }
      throw error;
    }
    this.log("info", application, response.status, startedAt, context);
    return parsed;
  }

  private log(
    level: "info" | "error",
    application: DomainApplication,
    status: number,
    startedAt: number,
    context: Required<Pick<ApiRequestContext, "requestId" | "correlationId">>,
    errorCode?: string,
  ): void {
    logIntegrationEvent({
      level,
      service: "director-copilot",
      operation: `execute_${application}`,
      status,
      latencyMs: Math.round(performance.now() - startedAt),
      requestId: context.requestId,
      correlationId: context.correlationId,
      errorCode,
    });
  }
}

function upstreamErrorCode(responseBytes: Uint8Array): string | null {
  try {
    const payload = JSON.parse(new TextDecoder().decode(responseBytes)) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const code = (payload as Record<string, unknown>).error;
    return typeof code === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(code)
      ? code
      : null;
  } catch {
    return null;
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new DirectorCopilotTransportError(
      "DIRECTOR_COPILOT_SOURCE_RESPONSE_TOO_LARGE",
      "Director Copilot source response exceeds the configured limit.",
      "unavailable",
      response.status,
    );
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        try {
          await reader.cancel("director copilot response exceeds its limit");
        } catch {
          // The bounded-size decision remains authoritative if cancellation fails.
        }
        throw new DirectorCopilotTransportError(
          "DIRECTOR_COPILOT_SOURCE_RESPONSE_TOO_LARGE",
          "Director Copilot source response exceeds the configured limit.",
          "unavailable",
          response.status,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
