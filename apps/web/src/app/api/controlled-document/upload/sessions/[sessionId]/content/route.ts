import { NextRequest, NextResponse } from "next/server";

import { persistUploadedObject, verifyUploadToken } from "@/lib/upload/preflight";
import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";

import { uploadErrorResponse } from "../../../errors";

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
    const token = request.headers.get("X-AKL-Upload-Token") ?? "";
    const declaredSha256 = request.headers.get("X-AKL-Content-SHA256") ?? "";
    const payload = verifyUploadToken(token);
    const requestContext = await getServerRequestContextForRequest(request);
    const document = await getServerApiClients().registry.getDocument(payload.document_id, requestContext);
    if (
      document.policy_binding_id !== payload.policy_binding_id ||
      document.policy_version !== payload.policy_version ||
      document.policy_hash !== payload.policy_hash
    ) {
      return NextResponse.json(
        { error: { code: "UPLOAD_POLICY_BINDING_STALE", message: "Document policy changed after preflight." } },
        { status: 409 }
      );
    }

    if (payload.session_id !== sessionId) {
      return NextResponse.json(
        {
          error: {
            code: "UPLOAD_SESSION_MISMATCH",
            message: "Upload session id does not match the signed upload token."
          }
        },
        { status: 400 }
      );
    }

    if (declaredSha256 && declaredSha256.toLowerCase() !== payload.sha256) {
      return NextResponse.json(
        {
          error: {
            code: "UPLOAD_HASH_HEADER_MISMATCH",
            message: "X-AKL-Content-SHA256 does not match the signed upload token."
          }
        },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    const persisted = await persistUploadedObject(payload, bytes);

    return NextResponse.json(
      {
        uploaded: true,
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
    return uploadErrorResponse(error);
  }
}
