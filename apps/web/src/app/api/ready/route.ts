import { NextResponse } from "next/server";

import { getAklConfig, getDirectorCopilotConfig } from "@/lib/api/config";
import { evaluateWebReadiness } from "@/lib/api/readiness";
import { loadDirectorCopilotV2ManifestCatalog } from "@/lib/director-copilot-v2/manifest-catalog";
import { DirectorCopilotTransportError } from "@/lib/director-copilot/transport-error";
import { contentSecurityReadiness } from "@/lib/upload/content-security";
import { checkObjectStorageReadiness } from "@/lib/storage/object-storage";
import { getUploadSettings } from "@/lib/upload/preflight";

export const runtime = "nodejs";

export async function GET() {
  try {
    const config = getAklConfig();
    const serviceDependencies = config.apiClientMode === "mock"
      ? Object.fromEntries(Object.keys(config.serviceBaseUrls).map((name) => [name, "mock"]))
      : Object.fromEntries(
          await Promise.all(
            Object.entries(config.serviceBaseUrls).map(async ([name, baseUrl]) => [
              name,
              await dependencyReadiness(name, baseUrl),
            ]),
          ),
        );
    const objectStorage = config.apiClientMode === "mock"
      ? "mock" as const
      : await checkObjectStorageReadiness(getUploadSettings())
          .then(() => "ready" as const)
          .catch(() => "not_ready" as const);
    const dependencies = { ...serviceDependencies, object_storage: objectStorage };
    const directorConfig = getDirectorCopilotConfig(config);
    const directorCopilotV2 = !directorConfig.enabled
      ? { status: "disabled" as const, reason: null }
      : await loadDirectorCopilotV2ManifestCatalog({ config })
          .then(() => ({ status: "ready" as const, reason: null }))
          .catch((error: unknown) => ({
            status: "degraded" as const,
            reason: directorCopilotReadinessReason(error),
          }));
    const documentIntake = await contentSecurityReadiness();
    const readiness = evaluateWebReadiness({
      dependencies,
      directorCopilotV2: directorCopilotV2.status,
      documentIntake,
    });
    return NextResponse.json(
      {
        service: "web-frontend",
        status: readiness.ready ? "ready" : "not_ready",
        api_client_mode: config.apiClientMode,
        auth_mode: config.authMode,
        degraded_dependencies: readiness.degradedDependencies,
        dependencies: {
          ...dependencies,
          director_copilot_v2: directorCopilotV2.status,
          director_copilot_v2_reason: directorCopilotV2.reason,
          document_intake_content_security: documentIntake,
        }
      },
      {
        status: readiness.ready ? 200 : 503,
        headers: {
          "cache-control": "no-store, max-age=0"
        }
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        service: "web-frontend",
        status: "not_ready",
        error: error instanceof Error ? error.message : "Unknown readiness error"
      },
      {
        status: 503,
        headers: {
          "cache-control": "no-store, max-age=0"
        }
      }
    );
  }
}

function directorCopilotReadinessReason(error: unknown): string {
  if (error instanceof DirectorCopilotTransportError) {
    return error.code === "DIRECTOR_COPILOT_V2_MANIFEST_DRIFT"
      ? error.code
      : "DIRECTOR_COPILOT_V2_MANIFEST_UNAVAILABLE";
  }
  return "DIRECTOR_COPILOT_V2_MANIFEST_UNAVAILABLE";
}

async function dependencyReadiness(name: string, baseUrl: string): Promise<"ready" | "not_ready"> {
  try {
    const url = new URL(baseUrl);
    const probePath = name === "ingestion" ? "health" : "ready";
    url.pathname = `${url.pathname.replace(/\/api\/v1\/?$/, "").replace(/\/$/, "")}/${probePath}`;
    url.search = "";
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    return response.ok ? "ready" : "not_ready";
  } catch {
    return "not_ready";
  }
}
