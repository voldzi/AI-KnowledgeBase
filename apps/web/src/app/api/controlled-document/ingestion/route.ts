import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import type { CreateIngestionJobRequest } from "@/lib/types";
import { assertUploadMatchesIngestionPayload, UploadPreflightError } from "@/lib/upload/preflight";

import { badRequest, bridgeError } from "../errors";
import { uploadErrorResponse } from "../upload/errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = getServerRequestContext();
    const clients = getServerApiClients();
    const documentId = String(body.document_id ?? "").trim();
    const sourceFileUri = String(body.source_file_uri ?? "").trim();
    const uploadToken = body.upload_token ? String(body.upload_token).trim() : "";
    const uploadSessionId = body.upload_session_id ? String(body.upload_session_id).trim() : "";

    if (!documentId) {
      return badRequest("document_id is required.");
    }

    if (!sourceFileUri) {
      return badRequest("source_file_uri is required.");
    }

    if (uploadToken) {
      assertUploadMatchesIngestionPayload(uploadToken, {
        document_id: documentId,
        upload_session_id: uploadSessionId,
        source_file_uri: sourceFileUri,
        file_hash: body.file_hash ? String(body.file_hash).trim() : null,
        file_name: body.file_name ? String(body.file_name).trim() : null,
        file_size: Number.isFinite(Number(body.file_size)) ? Number(body.file_size) : null,
        file_type: body.file_type ? String(body.file_type).trim() : null
      });
    }

    const version = await clients.registry.createDocumentVersion(
      documentId,
      {
        version_label: String(body.version_label ?? "1.0").trim(),
        valid_from: body.valid_from ? String(body.valid_from) : new Date().toISOString().slice(0, 10),
        valid_to: body.valid_to ? String(body.valid_to) : null,
        source_file_uri: sourceFileUri,
        file_hash: body.file_hash ? String(body.file_hash).trim() : null,
        change_summary: String(body.change_summary ?? "Controlled document workflow upload.").trim(),
        file: body.file_name
          ? {
              filename: String(body.file_name).trim(),
              mime_type: body.file_type ? String(body.file_type).trim() : null,
              size_bytes: Number.isFinite(Number(body.file_size)) ? Number(body.file_size) : null,
              sha256: body.file_hash ? String(body.file_hash).trim() : null,
              uploaded_by: context.subjectId
            }
          : null
      },
      context
    );
    const jobRequest: CreateIngestionJobRequest = {
      document_id: documentId,
      document_version_id: version.document_version_id,
      source_file_uri: sourceFileUri,
      parser_profile: body.parser_profile ?? "controlled_document",
      ocr_enabled: body.ocr_enabled !== false,
      chunking_strategy: body.chunking_strategy ?? "legal_structured",
      embedding_profile: String(body.embedding_profile ?? "default")
    };
    const job = await clients.ingestion.createJob(jobRequest, context);

    return NextResponse.json({ version, job }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadPreflightError) {
      return uploadErrorResponse(error);
    }
    return bridgeError(error);
  }
}
