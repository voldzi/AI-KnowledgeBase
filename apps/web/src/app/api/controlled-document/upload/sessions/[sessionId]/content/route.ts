import { NextRequest, NextResponse } from "next/server";

import {
  assertUploadTokenPurpose,
  CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE,
  getUploadSettings,
  verifyUploadToken,
} from "@/lib/upload/preflight";
import { acceptDocumentIntakeContent } from "@/lib/upload/document-intake";
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
    const payload = verifyUploadToken(token);
    assertUploadTokenPurpose(payload, CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE);
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

    const accepted = await acceptDocumentIntakeContent({
      request,
      sessionId,
      uploadToken: token,
      payload,
      settings: getUploadSettings(),
    });
    return NextResponse.json(accepted, { status: 201 });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
