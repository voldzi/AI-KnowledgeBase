import "server-only";

import { getDirectorCopilotConfig, type AklConfig } from "@/lib/api/config";
import { withCorrelationDefaults } from "@/lib/api/correlation";
import { logIntegrationEvent } from "@/lib/api/logger";
import type { ApiRequestContext } from "@/lib/types";
import { directorCopilotServiceToken } from "@/lib/director-copilot/service-identity";
import { DirectorCopilotTransportError } from "@/lib/director-copilot/transport-error";

import {
  DIRECTOR_COPILOT_V2_CONTRACT,
  DirectorCopilotV2ContractError,
  assertDirectorCopilotV2Request,
  parseDirectorCopilotV2Error,
  parseDirectorCopilotV2Response,
  type ActiveDirectorCopilotV2Application,
  type DirectorCopilotV2Request,
  type DirectorCopilotV2Response,
} from "./contracts";
import {
  DIRECTOR_COPILOT_V2_TARGETS,
  type DirectorCopilotV2ManifestCatalog,
} from "./manifest-catalog";

const EXECUTE_PATH = "/api/v1/integrations/akb/domain-tools/execute";

export interface DirectorCopilotV2DomainToolClientOptions {
  config: AklConfig;
  catalog: DirectorCopilotV2ManifestCatalog;
  fetcher?: typeof fetch;
  serviceToken?: (application: ActiveDirectorCopilotV2Application) => Promise<string>;
}

export class DirectorCopilotV2DomainToolClient {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: DirectorCopilotV2DomainToolClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async execute(
    application: ActiveDirectorCopilotV2Application,
    request: DirectorCopilotV2Request,
    actorContext: ApiRequestContext,
  ): Promise<DirectorCopilotV2Response> {
    assertDirectorCopilotV2Request(request);
    if (actorContext.authorizationSource !== "stratos_projection" || !actorContext.accessToken) {
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_V2_ACTOR_PROJECTION_REQUIRED",
        "A fresh projected actor bearer is required.",
        "not_authorized",
        401,
      );
    }
    const manifest = this.options.catalog.byTool.get(request.tool_id);
    if (!manifest || manifest.audience !== DIRECTOR_COPILOT_V2_TARGETS[application].audience) {
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_V2_MANIFEST_BINDING_INVALID",
        "The requested tool does not belong to the selected source.",
        "unavailable",
      );
    }
    const config = getDirectorCopilotConfig(this.options.config);
    const baseUrl = {
      budget: config.budgetBaseUrl,
      projectflow: config.projectflowBaseUrl,
      archflow: config.archflowBaseUrl,
    }[application];
    if (!baseUrl) {
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_V2_SOURCE_UNCONFIGURED",
        `Director Copilot V2 ${application} source is not configured.`,
        "unavailable",
      );
    }
    const serviceToken = this.options.serviceToken
      ? await this.options.serviceToken(application)
      : await directorCopilotServiceToken(
          this.options.config,
          this.fetcher,
          DIRECTOR_COPILOT_V2_TARGETS[application],
        );
    if (!serviceToken || serviceToken === actorContext.accessToken) {
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_V2_TOKEN_SEPARATION_REQUIRED",
        "Director Copilot V2 service and actor credentials must be independent.",
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
          "X-AKB-Domain-Tool-Contract": DIRECTOR_COPILOT_V2_CONTRACT,
        },
        body: JSON.stringify(request),
        cache: "no-store",
        signal: AbortSignal.timeout(
          Math.min(config.timeoutMs, manifest.timeout_ms, 30_000),
        ),
      });
    } catch {
      this.log(application, request.tool_id, 0, startedAt, context, "DIRECTOR_COPILOT_V2_SOURCE_UNAVAILABLE");
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_V2_SOURCE_UNAVAILABLE",
        `Director Copilot V2 ${application} source is unavailable.`,
        "unavailable",
        503,
      );
    }
    const bytes = await readBoundedBody(
      response,
      Math.min(config.maxResponseBytes, manifest.limits.max_response_bytes),
    );
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      this.log(application, request.tool_id, response.status, startedAt, context, "DIRECTOR_COPILOT_V2_CONTENT_TYPE_INVALID");
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_V2_CONTENT_TYPE_INVALID",
        `Director Copilot V2 ${application} source did not return JSON.`,
        "unavailable",
        response.status,
      );
    }
    const payload = parseJson(bytes, application, response.status);
    if (!response.ok) {
      const envelope = parseDirectorCopilotV2Error(payload, {
        status: response.status,
        manifest,
        toolCallId: request.tool_call_id,
      });
      this.log(application, request.tool_id, response.status, startedAt, context, envelope.error_code);
      throw new DirectorCopilotTransportError(
        envelope.error_code,
        `Director Copilot V2 ${application} source rejected the request.`,
        response.status === 401 || response.status === 403
          ? "not_authorized"
          : "unavailable",
        response.status,
      );
    }
    try {
      const parsed = parseDirectorCopilotV2Response(payload, {
        manifest,
        toolCallId: request.tool_call_id,
      });
      this.log(application, request.tool_id, response.status, startedAt, context);
      return parsed;
    } catch (error) {
      const contractError = error instanceof DirectorCopilotV2ContractError
        ? error
        : null;
      this.log(
        application,
        request.tool_id,
        response.status,
        startedAt,
        context,
        "DIRECTOR_COPILOT_V2_SOURCE_CONTRACT_INVALID",
        contractError?.code,
        contractError?.diagnosticPaths,
      );
      throw new DirectorCopilotTransportError(
        "DIRECTOR_COPILOT_V2_SOURCE_CONTRACT_INVALID",
        `Director Copilot V2 ${application} source violated the pinned contract.`,
        "unavailable",
        response.status,
        contractError?.code,
        contractError?.diagnosticPaths,
      );
    }
  }

  private log(
    application: ActiveDirectorCopilotV2Application,
    toolId: string,
    status: number,
    startedAt: number,
    context: Required<Pick<ApiRequestContext, "requestId" | "correlationId">>,
    errorCode?: string,
    diagnosticCode?: string,
    diagnosticPaths?: string[],
  ): void {
    logIntegrationEvent({
      level: errorCode ? "error" : "info",
      service: "director-copilot",
      operation: `v2_execute_${application}_${toolId}`,
      status,
      latencyMs: Math.round(performance.now() - startedAt),
      requestId: context.requestId,
      correlationId: context.correlationId,
      errorCode,
      diagnosticCode,
      diagnosticPaths,
    });
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw tooLarge(response.status);
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
        await reader.cancel("director copilot v2 response exceeds its limit").catch(() => undefined);
        throw tooLarge(response.status);
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

function tooLarge(status: number): DirectorCopilotTransportError {
  return new DirectorCopilotTransportError(
    "DIRECTOR_COPILOT_V2_RESPONSE_TOO_LARGE",
    "Director Copilot V2 response exceeds the configured limit.",
    "unavailable",
    status,
  );
}

function parseJson(
  bytes: Uint8Array,
  application: ActiveDirectorCopilotV2Application,
  status: number,
): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new DirectorCopilotTransportError(
      "DIRECTOR_COPILOT_V2_SOURCE_JSON_INVALID",
      `Director Copilot V2 ${application} source returned malformed JSON.`,
      "unavailable",
      status,
    );
  }
}
