import { NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";

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
              await dependencyReadiness(baseUrl),
            ]),
          ),
        );
    const isReady = Object.values(dependencies).every((status) => status === "ready" || status === "mock");
    return NextResponse.json({
      service: "web-frontend",
      status: isReady ? "ready" : "not_ready",
      api_client_mode: config.apiClientMode,
      auth_mode: config.authMode,
      dependencies
    }, { status: isReady ? 200 : 503 });
  } catch (error) {
    return NextResponse.json(
      {
        service: "web-frontend",
        status: "not_ready",
        error: error instanceof Error ? error.message : "Unknown readiness error"
      },
      { status: 503 }
    );
  }
}

async function dependencyReadiness(baseUrl: string): Promise<"ready" | "not_ready"> {
  try {
    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/api\/v1\/?$/, "").replace(/\/$/, "")}/ready`;
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
