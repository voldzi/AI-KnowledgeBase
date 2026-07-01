import { NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { sourceContextOpenUrls } from "@/lib/stratos/document-ai";

import { stratosBridgeError } from "../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    chunkId: string;
  }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { chunkId } = await context.params;
    const requestContext = await getServerRequestContextForRequest(request);
    const clients = getServerApiClients();
    const sourceContext = await clients.rag.openCitation(chunkId, requestContext);

    return NextResponse.json(sourceContextOpenUrls(sourceContext));
  } catch (error) {
    return stratosBridgeError(error);
  }
}
