import { NextRequest, NextResponse } from "next/server";

import {
  getStratosUploadSettings
} from "@/lib/stratos/document-ai";
import {
  createUploadReceipt,
  persistUploadedObject,
  readBoundedUploadContent,
  verifyUploadToken
} from "@/lib/upload/preflight";

import { stratosBridgeError } from "../../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    sessionId: string;
  }>;
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    const settings = getStratosUploadSettings();
    const token = request.headers.get("X-AKL-Upload-Token") ?? "";
    const declaredSha256 = request.headers.get("X-AKL-Content-SHA256") ?? "";
    const payload = verifyUploadToken(token, settings);
    const declaredContentType = request.headers.get("Content-Type")?.trim().toLowerCase() ?? "";

    if (payload.session_id !== sessionId) {
      return NextResponse.json(
        {
          error: {
            code: "UPLOAD_SESSION_MISMATCH",
            message: "Upload session id does not match the signed upload token.",
            trace_id: "web-stratos-upload"
          }
        },
        { status: 400 }
      );
    }

    if (!declaredSha256) {
      return NextResponse.json(
        {
          error: {
            code: "UPLOAD_HASH_HEADER_REQUIRED",
            message: "X-AKL-Content-SHA256 is required.",
            trace_id: "web-stratos-upload"
          }
        },
        { status: 400 }
      );
    }

    if (declaredSha256.toLowerCase() !== payload.sha256) {
      return NextResponse.json(
        {
          error: {
            code: "UPLOAD_HASH_HEADER_MISMATCH",
            message: "X-AKL-Content-SHA256 does not match the signed upload token.",
            trace_id: "web-stratos-upload"
          }
        },
        { status: 400 }
      );
    }

    if (!declaredContentType || declaredContentType !== payload.file_type) {
      return NextResponse.json(
        {
          error: {
            code: "UPLOAD_CONTENT_TYPE_MISMATCH",
            message: "Content-Type must exactly match the signed upload decision.",
            trace_id: "web-stratos-upload"
          }
        },
        { status: 415 }
      );
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
          sha256: persisted.sha256
        }
      },
      { status: 201 }
    );
  } catch (error) {
    return stratosBridgeError(error);
  }
}
