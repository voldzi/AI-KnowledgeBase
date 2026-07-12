import { NextRequest } from "next/server";

import { handleAiipApplicationRequest } from "@/lib/aiip/application-api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleAiipApplicationRequest(request, "harmonize");
}
