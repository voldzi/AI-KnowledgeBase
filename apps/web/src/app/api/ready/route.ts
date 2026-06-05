import { NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";

export const runtime = "nodejs";

export function GET() {
  try {
    const config = getAklConfig();
    return NextResponse.json({
      service: "web-frontend",
      status: "ready",
      api_client_mode: config.apiClientMode,
      auth_mode: config.authMode
    });
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
