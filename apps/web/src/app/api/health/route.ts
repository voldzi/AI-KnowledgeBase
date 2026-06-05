import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    service: "web-frontend",
    status: "ok",
    version: process.env.AKL_SERVICE_VERSION ?? "dev",
    timestamp: new Date().toISOString()
  });
}
