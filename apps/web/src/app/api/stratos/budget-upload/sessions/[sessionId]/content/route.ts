import { NextRequest, NextResponse } from "next/server";

import {
  getStratosBudgetUploadSettings,
  STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE,
} from "@/lib/stratos/document-ai";
import {
  assertUploadTokenPurpose,
  createUploadReceipt,
  persistUploadedObject,
  readBoundedUploadContent,
  verifyUploadToken,
} from "@/lib/upload/preflight";

import { stratosBridgeError } from "../../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    const settings = getStratosBudgetUploadSettings();
    const token = request.headers.get("X-AKL-Upload-Token") ?? "";
    const declaredSha256 = request.headers.get("X-AKL-Content-SHA256") ?? "";
    const declaredContentType = request.headers.get("Content-Type")?.trim().toLowerCase() ?? "";
    const payload = verifyUploadToken(token, settings);
    assertUploadTokenPurpose(payload, STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE);

    if (payload.session_id !== sessionId) {
      return uploadError(400, "UPLOAD_SESSION_MISMATCH", "Upload session does not match the signed token.");
    }
    if (!declaredSha256) {
      return uploadError(400, "UPLOAD_HASH_HEADER_REQUIRED", "X-AKL-Content-SHA256 is required.");
    }
    if (declaredSha256.toLowerCase() !== payload.sha256) {
      return uploadError(400, "UPLOAD_HASH_HEADER_MISMATCH", "Content hash does not match the signed token.");
    }
    if (!declaredContentType || declaredContentType !== payload.file_type) {
      return uploadError(415, "UPLOAD_CONTENT_TYPE_MISMATCH", "Content-Type must match the signed token.");
    }

    const bytes = await readBoundedUploadContent(request, payload, settings);
    const persisted = await persistUploadedObject(payload, bytes, settings);
    const uploadReceipt = createUploadReceipt(token, payload, persisted, settings);
    return NextResponse.json(
      {
        uploaded: true,
        upload_receipt: uploadReceipt,
        upload_session_id: payload.session_id,
        source_file_uri: payload.source_file_uri,
        file: {
          filename: payload.file_name,
          mime_type: payload.file_type,
          size_bytes: persisted.size_bytes,
          sha256: persisted.sha256,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return stratosBridgeError(error);
  }
}

function uploadError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message, trace_id: "web-stratos-budget-upload" } },
    { status },
  );
}
