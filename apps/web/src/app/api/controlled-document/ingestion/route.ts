import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import type { CreateIngestionJobRequest } from "@/lib/types";

import { badRequest, bridgeError } from "../errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = getServerRequestContext();
    const clients = getServerApiClients();
    const documentId = String(body.document_id ?? "").trim();
    const sourceFileUri = String(body.source_file_uri ?? "").trim();

    if (!documentId) {
      return badRequest("document_id is required.");
    }

    if (!sourceFileUri) {
      return badRequest("source_file_uri is required.");
    }

    const version = await clients.registry.createDocumentVersion(
      documentId,
      {
        version_label: String(body.version_label ?? "1.0").trim(),
        valid_from: body.valid_from ? String(body.valid_from) : new Date().toISOString().slice(0, 10),
        valid_to: body.valid_to ? String(body.valid_to) : null,
        source_file_uri: sourceFileUri,
        change_summary: String(body.change_summary ?? "Controlled document workflow upload.").trim()
      },
      context
    );
    const publishedVersion = await clients.registry.publishDocumentVersion(
      documentId,
      version.document_version_id,
      context
    );

    const jobRequest: CreateIngestionJobRequest = {
      document_id: documentId,
      document_version_id: publishedVersion.document_version_id,
      source_file_uri: sourceFileUri,
      parser_profile: body.parser_profile ?? "controlled_document",
      ocr_enabled: body.ocr_enabled !== false,
      chunking_strategy: body.chunking_strategy ?? "legal_structured",
      embedding_profile: String(body.embedding_profile ?? "default")
    };
    const job = await clients.ingestion.createJob(jobRequest, context);

    return NextResponse.json({ version: publishedVersion, job }, { status: 201 });
  } catch (error) {
    return bridgeError(error);
  }
}
