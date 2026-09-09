import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients } from "@/lib/api/server";
import { ApiClientError } from "@/lib/types";
import { listApprovedPublicSourceCollections } from "@/lib/public-sources/approved-collections-client";
import { discoverPublicSourceCollection } from "@/lib/public-sources/discovery";
import { officialSourceInternalSecret, officialSourceServiceRequestContext } from "@/lib/public-sources/automation-service-identity";
import { synchronizePublicSource, type PublicSourceSyncRequest } from "@/lib/public-sources/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const HEADERS = { "Cache-Control": "private, no-store" };
const COLLECTION_ID = "czech-law";

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get("X-Correlation-ID")?.trim() || `official-source-${randomUUID()}`;
  try {
    await requireInternalSecret(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body) || typeof body !== "object" || typeof body.action !== "string") {
      throw new ApiClientError("Automation request is invalid.", 422, "OFFICIAL_SOURCE_AUTOMATION_REQUEST_INVALID", correlationId);
    }
    const context = await officialSourceServiceRequestContext(correlationId);
    const clients = getServerApiClients();
    const authorization = await clients.registry.getAuthorizationHints(context);
    if (!authorization.can_update || !authorization.can_ingest || !authorization.can_publish) {
      throw new ApiClientError("Official-source service access is incomplete.", 403, "OFFICIAL_SOURCE_AUTOMATION_FORBIDDEN", correlationId);
    }
    if (body.action === "collections") {
      exactKeys(body, ["action"], correlationId);
      return NextResponse.json({ collections: await listApprovedPublicSourceCollections(context) }, { headers: HEADERS });
    }
    if (body.action === "discover") {
      exactKeys(body, ["action", "collection_id"], correlationId);
      if (body.collection_id !== COLLECTION_ID) invalidCollection(correlationId);
      const collections = await listApprovedPublicSourceCollections(context);
      const approved = collections.find((collection) => collection.collectionId === COLLECTION_ID);
      if (!approved) throw new ApiClientError("The Czech legislation collection is not approved.", 403, "OFFICIAL_SOURCE_COLLECTION_NOT_APPROVED", correlationId);
      const result = await discoverPublicSourceCollection(COLLECTION_ID, fetch, { openDataActLimit: 10 });
      return NextResponse.json({ collectionRevision: approved.revision, ...result }, { headers: HEADERS });
    }
    if (body.action === "sync") {
      exactKeys(body, ["action", "source"], correlationId);
      const source = syncRequest(body.source, correlationId);
      const result = await synchronizePublicSource(source, clients, context);
      return NextResponse.json(result, { status: result.action === "created" ? 201 : 200, headers: HEADERS });
    }
    throw new ApiClientError("Automation action is unsupported.", 422, "OFFICIAL_SOURCE_AUTOMATION_ACTION_INVALID", correlationId);
  } catch (error) {
    const known = error instanceof ApiClientError;
    return NextResponse.json({ error: {
      code: known ? error.code : "OFFICIAL_SOURCE_AUTOMATION_FAILED",
      message: known ? error.message : "Official-source automation failed.",
      trace_id: known ? error.traceId : correlationId,
    } }, { status: known ? error.status : 500, headers: HEADERS });
  }
}

async function requireInternalSecret(request: NextRequest): Promise<void> {
  const supplied = request.headers.get("X-AKB-Official-Source-Automation") ?? "";
  const expected = await officialSourceInternalSecret();
  const left = createHash("sha256").update(supplied).digest();
  const right = createHash("sha256").update(expected).digest();
  if (!supplied || !timingSafeEqual(left, right)) {
    throw new ApiClientError("Internal automation authorization failed.", 401, "OFFICIAL_SOURCE_AUTOMATION_UNAUTHORIZED", "official-source-automation");
  }
}

function exactKeys(body: Record<string, unknown>, expected: string[], correlationId: string): void {
  if (JSON.stringify(Object.keys(body).sort()) !== JSON.stringify([...expected].sort())) {
    throw new ApiClientError("Automation request has unsupported fields.", 422, "OFFICIAL_SOURCE_AUTOMATION_REQUEST_INVALID", correlationId);
  }
}

function invalidCollection(correlationId: string): never {
  throw new ApiClientError("Only the centrally approved Czech legislation collection is supported.", 422, "OFFICIAL_SOURCE_COLLECTION_INVALID", correlationId);
}

function syncRequest(value: unknown, correlationId: string): PublicSourceSyncRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiClientError("Source proposal is invalid.", 422, "OFFICIAL_SOURCE_AUTOMATION_REQUEST_INVALID", correlationId);
  }
  const source = value as Record<string, unknown>;
  const allowed = ["collectionId", "collectionRevision", "sourceUrl", "canonicalUrl", "title", "versionLabel", "effectiveFrom", "effectiveTo"];
  if (Object.keys(source).some((key) => !allowed.includes(key))
      || source.collectionId !== COLLECTION_ID
      || ["collectionRevision", "sourceUrl", "title", "effectiveFrom"].some((key) => typeof source[key] !== "string" || !String(source[key]).trim())
      || (source.canonicalUrl !== undefined && typeof source.canonicalUrl !== "string")
      || (source.versionLabel !== undefined && typeof source.versionLabel !== "string")
      || (source.effectiveTo !== undefined && source.effectiveTo !== null && typeof source.effectiveTo !== "string")) {
    throw new ApiClientError("Source proposal is invalid.", 422, "OFFICIAL_SOURCE_AUTOMATION_REQUEST_INVALID", correlationId);
  }
  return source as unknown as PublicSourceSyncRequest;
}
