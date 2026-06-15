import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import {
  filterSearchItems,
  latestVersion,
  positiveInteger,
  stringList,
  toSearchItem
} from "@/lib/stratos/document-ai";

import { stratosBridgeError } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const context = await getServerRequestContextForRequest(request);
    const clients = getServerApiClients();
    const documents = await clients.registry.listDocuments(context);
    const requestedTags = new Set(stringList(body.context_tags));
    const limit = positiveInteger(body.limit, 50, 100);
    const offset = positiveInteger(body.offset, 0, 10_000);
    const scopedDocuments = documents.filter((document) => {
      if (requestedTags.size === 0) return true;
      return document.tags.some((tag) => requestedTags.has(tag));
    });

    const jobs = await clients.ingestion.listJobs(context).catch(() => []);
    const items = await Promise.all(
      scopedDocuments.map(async (document) => {
        const versions = await clients.registry.listDocumentVersions(document.document_id, context);
        const version = latestVersion(versions);
        const job = version
          ? jobs.find((candidate) => candidate.document_version_id === version.document_version_id) ?? null
          : null;
        return toSearchItem({ document, version, job });
      })
    );
    const filtered = filterSearchItems(items, body);

    return NextResponse.json({
      items: filtered.slice(offset, offset + limit),
      limit,
      offset,
      total: filtered.length
    });
  } catch (error) {
    return stratosBridgeError(error);
  }
}
