import "server-only";

import { getDirectorCopilotConfig, type AklConfig } from "@/lib/api/config";
import { withCorrelationDefaults } from "@/lib/api/correlation";
import { logIntegrationEvent } from "@/lib/api/logger";
import type { ApiRequestContext } from "@/lib/types";
import {
  directorCopilotServiceToken,
  type DirectorCopilotServiceTarget,
} from "@/lib/director-copilot/service-identity";
import { DirectorCopilotTransportError } from "@/lib/director-copilot/transport-error";

import {
  DIRECTOR_COPILOT_V2_CONTRACT,
  DIRECTOR_COPILOT_V2_REVISION,
  V2_TOOL_IDS,
  canonicalJson,
  DirectorCopilotV2ContractError,
  parseDirectorCopilotV2Error,
  parseDirectorCopilotV2ManifestEnvelope,
  pinnedDirectorCopilotV2Manifest,
  pinnedDirectorCopilotV2ManifestBundle,
  type ActiveDirectorCopilotV2Application,
  type DirectorCopilotV2Manifest,
  type DirectorCopilotV2ToolId,
} from "./contracts";

const MANIFEST_PATH = "/api/v1/integrations/akb/domain-tools/manifests";

export const DIRECTOR_COPILOT_V2_TARGETS: Record<
  ActiveDirectorCopilotV2Application,
  DirectorCopilotServiceTarget
> = {
  budget: {
    audience: "budget-api",
    scope: "director-copilot-budget-api",
  },
  projectflow: {
    audience: "projectflow-api",
    scope: "director-copilot-projectflow-api",
  },
  archflow: {
    audience: "archflow-api",
    scope: "director-copilot-archflow-api",
  },
};

export const ACTIVE_DIRECTOR_COPILOT_V2_APPLICATIONS = [
  "budget",
  "projectflow",
  "archflow",
] as const satisfies readonly ActiveDirectorCopilotV2Application[];

export interface DirectorCopilotV2ManifestCatalog {
  contractRevision: typeof DIRECTOR_COPILOT_V2_REVISION;
  loadedAt: string;
  manifests: DirectorCopilotV2Manifest[];
  byTool: ReadonlyMap<DirectorCopilotV2ToolId, DirectorCopilotV2Manifest>;
  byApplication: ReadonlyMap<ActiveDirectorCopilotV2Application, DirectorCopilotV2Manifest[]>;
}

export interface DirectorCopilotV2ManifestCatalogOptions {
  config: AklConfig;
  fetcher?: typeof fetch;
  serviceToken?: (
    application: ActiveDirectorCopilotV2Application,
    target: DirectorCopilotServiceTarget,
  ) => Promise<string>;
  context?: Pick<ApiRequestContext, "requestId" | "correlationId">;
  force?: boolean;
}

interface CachedCatalog {
  key: string;
  expiresAt: number;
  catalog: DirectorCopilotV2ManifestCatalog;
}

let cachedCatalog: CachedCatalog | null = null;
let pendingCatalog: Promise<DirectorCopilotV2ManifestCatalog> | null = null;

export async function loadDirectorCopilotV2ManifestCatalog(
  options: DirectorCopilotV2ManifestCatalogOptions,
): Promise<DirectorCopilotV2ManifestCatalog> {
  const config = getDirectorCopilotConfig(options.config);
  const key = [
    config.budgetBaseUrl,
    config.projectflowBaseUrl,
    config.archflowBaseUrl,
    config.clientId,
    DIRECTOR_COPILOT_V2_REVISION,
  ].join("|");
  const now = Date.now();
  if (!options.force && cachedCatalog?.key === key && cachedCatalog.expiresAt > now) {
    return cachedCatalog.catalog;
  }
  if (!options.force && pendingCatalog) return pendingCatalog;
  const pending = fetchCatalog(options);
  pendingCatalog = pending;
  try {
    const catalog = await pending;
    cachedCatalog = {
      key,
      expiresAt: now + (config.v2ManifestCacheTtlMs ?? 300_000),
      catalog,
    };
    return catalog;
  } finally {
    if (pendingCatalog === pending) pendingCatalog = null;
  }
}

export function resetDirectorCopilotV2ManifestCacheForTests(): void {
  cachedCatalog = null;
  pendingCatalog = null;
}

export function pinnedDirectorCopilotV2Catalog(): DirectorCopilotV2ManifestCatalog {
  const activeAudiences = new Set<string>(
    ACTIVE_DIRECTOR_COPILOT_V2_APPLICATIONS.map(
      (application) => DIRECTOR_COPILOT_V2_TARGETS[application].audience,
    ),
  );
  const manifests = pinnedDirectorCopilotV2ManifestBundle().manifests
    .filter((manifest) => activeAudiences.has(manifest.audience))
    .sort((left, right) => left.tool_id.localeCompare(right.tool_id));
  return {
    contractRevision: DIRECTOR_COPILOT_V2_REVISION,
    loadedAt: "2026-07-25T00:00:00.000Z",
    manifests,
    byTool: new Map(manifests.map((manifest) => [manifest.tool_id, manifest])),
    byApplication: new Map(ACTIVE_DIRECTOR_COPILOT_V2_APPLICATIONS.map((application) => [
      application,
      manifests.filter(
        (manifest) => manifest.audience === DIRECTOR_COPILOT_V2_TARGETS[application].audience,
      ),
    ])),
  };
}

export function pinnedDirectorCopilotV2CatalogForTests(): DirectorCopilotV2ManifestCatalog {
  return pinnedDirectorCopilotV2Catalog();
}

async function fetchCatalog(
  options: DirectorCopilotV2ManifestCatalogOptions,
): Promise<DirectorCopilotV2ManifestCatalog> {
  const config = getDirectorCopilotConfig(options.config);
  const fetcher = options.fetcher ?? fetch;
  const context = withCorrelationDefaults({
    subjectId: "svc-akb-director-copilot",
    ...options.context,
  });
  const manifestsByApplication = await Promise.all(
    ACTIVE_DIRECTOR_COPILOT_V2_APPLICATIONS
      .map(async (application) => {
        const target = DIRECTOR_COPILOT_V2_TARGETS[application];
        const token = options.serviceToken
          ? await options.serviceToken(application, target)
          : await directorCopilotServiceToken(options.config, fetcher, target);
        const baseUrl = baseUrlForApplication(config, application);
        const startedAt = performance.now();
        let response: Response;
        try {
          response = await fetcher(`${baseUrl}${MANIFEST_PATH}`, {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
              "X-AKB-Domain-Tool-Contract": DIRECTOR_COPILOT_V2_CONTRACT,
              "X-Request-ID": context.requestId,
              "X-Correlation-ID": context.correlationId,
            },
            cache: "no-store",
            signal: AbortSignal.timeout(Math.min(config.timeoutMs, 30_000)),
          });
        } catch {
          logManifest(application, 0, startedAt, context, "DIRECTOR_COPILOT_V2_MANIFEST_UNAVAILABLE");
          throw unavailable(application, "DIRECTOR_COPILOT_V2_MANIFEST_UNAVAILABLE");
        }
        const bytes = await readBoundedBody(
          response,
          Math.min(config.maxResponseBytes, 262_144),
        );
        const payload = parseJson(bytes, application);
        if (!response.ok) {
          const envelope = parseDirectorCopilotV2Error(payload, {
            status: response.status,
            manifest: pinnedDirectorCopilotV2Manifest(expectedToolForError(application)),
            toolCallId: null,
          });
          logManifest(application, response.status, startedAt, context, envelope.error_code);
          throw new DirectorCopilotTransportError(
            envelope.error_code,
            `Director Copilot V2 ${application} manifest endpoint rejected the request.`,
            response.status === 401 || response.status === 403
              ? "not_authorized"
              : "unavailable",
            response.status,
          );
        }
        assertJson(response, application);
        let manifests: DirectorCopilotV2Manifest[];
        try {
          manifests = parseDirectorCopilotV2ManifestEnvelope(payload, application);
        } catch (error) {
          const errorCode = error instanceof DirectorCopilotV2ContractError
            ? error.code
            : "DIRECTOR_COPILOT_V2_MANIFEST_INVALID";
          logManifest(application, response.status, startedAt, context, errorCode);
          throw new DirectorCopilotTransportError(
            errorCode,
            `Director Copilot V2 ${application} manifest does not match the pinned contract.`,
            "unavailable",
            response.status,
          );
        }
        logManifest(application, response.status, startedAt, context);
        return [application, manifests] as const;
      }),
  );
  const byApplication = new Map(manifestsByApplication);
  const manifests = manifestsByApplication
    .flatMap(([, applicationManifests]) => applicationManifests)
    .sort((left, right) => left.tool_id.localeCompare(right.tool_id));
  const pinned = pinnedDirectorCopilotV2ManifestBundle().manifests
    .filter((manifest) => manifests.some((candidate) => candidate.audience === manifest.audience))
    .sort((left, right) => left.tool_id.localeCompare(right.tool_id));
  if (canonicalJson(manifests) !== canonicalJson(pinned)) {
    logIntegrationEvent({
      level: "error",
      service: "director-copilot",
      operation: "v2_manifest_catalog",
      status: 200,
      latencyMs: 0,
      requestId: context.requestId,
      correlationId: context.correlationId,
      errorCode: "DIRECTOR_COPILOT_V2_MANIFEST_DRIFT",
    });
    throw new DirectorCopilotTransportError(
      "DIRECTOR_COPILOT_V2_MANIFEST_DRIFT",
      "Runtime Director Copilot V2 manifests differ from the pinned contract.",
      "unavailable",
    );
  }
  return {
    contractRevision: DIRECTOR_COPILOT_V2_REVISION,
    loadedAt: new Date().toISOString(),
    manifests,
    byTool: new Map(manifests.map((manifest) => [manifest.tool_id, manifest])),
    byApplication,
  };
}

function baseUrlForApplication(
  config: ReturnType<typeof getDirectorCopilotConfig>,
  application: ActiveDirectorCopilotV2Application,
): string {
  const baseUrl = {
    budget: config.budgetBaseUrl,
    projectflow: config.projectflowBaseUrl,
    archflow: config.archflowBaseUrl,
  }[application];
  if (!baseUrl) {
    throw unavailable(application, "DIRECTOR_COPILOT_V2_SOURCE_UNCONFIGURED");
  }
  return baseUrl;
}

function expectedToolForError(
  application: ActiveDirectorCopilotV2Application,
): DirectorCopilotV2ToolId {
  return {
    budget: V2_TOOL_IDS.budgetOrganization,
    projectflow: V2_TOOL_IDS.projectflow,
    archflow: V2_TOOL_IDS.archflow,
  }[application];
}

function unavailable(
  application: ActiveDirectorCopilotV2Application,
  code: string,
): DirectorCopilotTransportError {
  return new DirectorCopilotTransportError(
    code,
    `Director Copilot V2 ${application} source is unavailable.`,
    "unavailable",
    503,
  );
}

function parseJson(
  bytes: Uint8Array,
  application: ActiveDirectorCopilotV2Application,
): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw unavailable(application, "DIRECTOR_COPILOT_V2_MANIFEST_JSON_INVALID");
  }
}

function assertJson(
  response: Response,
  application: ActiveDirectorCopilotV2Application,
): void {
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw unavailable(application, "DIRECTOR_COPILOT_V2_MANIFEST_CONTENT_TYPE_INVALID");
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw responseTooLarge(response.status);
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
        await reader.cancel("director copilot v2 manifest exceeds its limit").catch(() => undefined);
        throw responseTooLarge(response.status);
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

function responseTooLarge(status: number): DirectorCopilotTransportError {
  return new DirectorCopilotTransportError(
    "DIRECTOR_COPILOT_V2_RESPONSE_TOO_LARGE",
    "Director Copilot V2 response exceeds the configured limit.",
    "unavailable",
    status,
  );
}

function logManifest(
  application: ActiveDirectorCopilotV2Application,
  status: number,
  startedAt: number,
  context: Required<Pick<ApiRequestContext, "requestId" | "correlationId">>,
  errorCode?: string,
): void {
  logIntegrationEvent({
    level: errorCode ? "error" : "info",
    service: "director-copilot",
    operation: `v2_manifest_${application}`,
    status,
    latencyMs: Math.round(performance.now() - startedAt),
    requestId: context.requestId,
    correlationId: context.correlationId,
    errorCode,
  });
}
