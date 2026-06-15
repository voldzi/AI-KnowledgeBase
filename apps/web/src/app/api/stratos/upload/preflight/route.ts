import { NextRequest, NextResponse } from "next/server";

import { getServerRequestContextForRequest } from "@/lib/api/server";
import {
  canonicalDocumentUrl,
  getStratosUploadSettings,
  requiredString,
  upsertExternalDocument
} from "@/lib/stratos/document-ai";
import { createUploadPreflightDecision } from "@/lib/upload/preflight";

import { stratosBridgeError } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const context = await getServerRequestContextForRequest(request);
    const external = await upsertExternalDocument(body, context);
    const preflight = createUploadPreflightDecision(
      {
        document_id: external.document.document_id,
        file_name: requiredString(body, "file_name"),
        file_size: Number(body.file_size),
        file_type: body.file_type ? String(body.file_type) : null,
        sha256: requiredString(body, "sha256")
      },
      getStratosUploadSettings()
    );

    return NextResponse.json(
      {
        ...preflight,
        document_id: external.document.document_id,
        external_document_id: external.external_document.external_document_id,
        external_ref: external.external_document.external_ref,
        canonical_open_url: canonicalDocumentUrl({ documentId: external.document.document_id })
      },
      { status: 201 }
    );
  } catch (error) {
    return stratosBridgeError(error);
  }
}
