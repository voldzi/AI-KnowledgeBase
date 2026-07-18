import { NextRequest, NextResponse } from "next/server";

import {
  getOptionalServerRequestContext,
  getServerApiClients,
} from "@/lib/api/server";

import {
  assistantBridgeError,
  unauthorizedAssistantRequest,
} from "../errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  if (query.length === 1) {
    return NextResponse.json(
      {
        error: {
          code: "assistant_directory_query_too_short",
          message: "Directory query must be empty or contain at least two characters.",
        },
      },
      { status: 400 },
    );
  }
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
    : 50;

  try {
    const requestContext = await getOptionalServerRequestContext(request);
    if (!requestContext) {
      return unauthorizedAssistantRequest();
    }
    const clients = getServerApiClients();
    const users = await clients.registry.searchAssistantDirectoryUsers(
      query,
      requestContext,
      limit,
    );
    return NextResponse.json({ users });
  } catch (error) {
    return assistantBridgeError(error);
  }
}
