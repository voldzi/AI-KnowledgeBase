import { NextResponse } from "next/server";

import { getAklConfig, getDirectorCopilotConfig } from "@/lib/api/config";
import { loadDirectorCopilotV2ManifestCatalog } from "@/lib/director-copilot-v2/manifest-catalog";
import { contentSecurityReadiness } from "@/lib/upload/content-security";

export const runtime = "nodejs";

export async function GET() {
  try {
    const config = getAklConfig();
    const dependencies = config.apiClientMode === "mock"
      ? Object.fromEntries(Object.keys(config.serviceBaseUrls).map((name) => [name, "mock"]))
      : Object.fromEntries(
          await Promise.all(
            Object.entries(config.serviceBaseUrls).map(async ([name, baseUrl]) => [
              name,
              await dependencyReadiness(name, baseUrl),
            ]),
          ),
        );
    const directorConfig = getDirectorCopilotConfig(config);
    const directorCopilotV2 = !directorConfig.enabled
      ? "disabled"
      : await loadDirectorCopilotV2ManifestCatalog({ config })
          .then(() => "ready" as const)
          .catch(() => "not_ready" as const);
    const documentIntake = await contentSecurityReadiness();
    const dependenciesReady = Object.values(dependencies)
      .every((status) => status === "ready" || status === "mock");
    const isReady = dependenciesReady
      && (!directorConfig.enabled || directorCopilotV2 === "ready")
      && documentIntake !== "not_ready";
    return NextResponse.json(
      {
        service: "web-frontend",
        status: isReady ? "ready" : "not_ready",
        api_client_mode: config.apiClientMode,
        auth_mode: config.authMode,
        dependencies: {
          ...dependencies,
          director_copilot_v2: directorCopilotV2,
          document_intake_content_security: documentIntake,
        }
      },
      {
        status: isReady ? 200 : 503,
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
