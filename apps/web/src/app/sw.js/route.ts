import { NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import { createChatServiceWorker } from "@/lib/pwa/service-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const config = getAklConfig();
  if (config.webProfile !== "chat") {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(
    createChatServiceWorker({
      version: process.env.AKL_SERVICE_VERSION ?? "development",
    }),
    {
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "application/javascript; charset=utf-8",
        "service-worker-allowed": "/",
      },
    },
  );
}
