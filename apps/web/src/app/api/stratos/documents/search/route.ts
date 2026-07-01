import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import {
  filterSearchItems,
  latestVersion,
  optionalString,
  positiveInteger,
  stringList,
  toSearchItem
} from "@/lib/stratos/document-ai";
import type { Classification, Document, DocumentType, DocumentVersion } from "@/lib/types";

import { stratosBridgeError } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const context = await getServerRequestContextForRequest(request);
    const clients = getServerApiClients();
    const documents = await clients.registry.listDocuments(context, documentSearchOptions(body));
    const limit = positiveInteger(body.limit, 50, 100);
    const offset = positiveInteger(body.offset, 0, 10_000);
    const matchingDocuments = filterDocumentsByQuery(documents, body);
    const pageDocuments = matchingDocuments.slice(offset, offset + limit);

    const jobs = await clients.ingestion.listJobs(context).catch(() => []);
    const items = await mapWithConcurrency(pageDocuments, 4, async (document) => {
      const versions = await clients.registry
        .listDocumentVersions(document.document_id, context)
        .catch((): DocumentVersion[] => []);
      const version = latestVersion(versions);
      const job = version
        ? jobs.find((candidate) => candidate.document_version_id === version.document_version_id) ?? null
        : null;
      return toSearchItem({ document, version, job });
    });
    const filtered = filterSearchItems(items, body);

    return NextResponse.json({
      items: filtered,
      limit,
      offset,
      total: matchingDocuments.length
    });
  } catch (error) {
    return stratosBridgeError(error);
  }
}

function documentSearchOptions(body: Record<string, unknown>) {
  const classification = optionalString(body, "classification") as Classification | null;
  const documentType = optionalString(body, "document_type") as DocumentType | null;
  return {
    classification: classification ?? undefined,
    documentType: documentType ?? undefined,
    tenantId: optionalString(body, "tenant_id") ?? undefined,
    externalSystem: optionalString(body, "external_system") ?? undefined,
    entityType: optionalString(body, "entity_type") ?? undefined,
    entityId: optionalString(body, "entity_id") ?? undefined,
    contextTags: stringList(body.context_tags)
  };
}

function filterDocumentsByQuery(documents: Document[], body: Record<string, unknown>): Document[] {
  const query = optionalString(body, "query")?.toLowerCase() ?? "";
  if (!query) return documents;
  return documents.filter((document) => {
    const external = recordValue(document.metadata?.external);
    const stratos = recordValue(document.metadata?.stratos);
    const haystack = [
      document.title,
      document.document_type,
      document.classification,
      document.owner,
      document.gestor_unit,
      ...document.tags,
      external?.external_ref,
      stratos?.external_ref,
      stratos?.entity_type,
      stratos?.entity_id
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];
      if (item !== undefined) {
        results[currentIndex] = await mapper(item);
      }
    }
  }));

  return results;
}
