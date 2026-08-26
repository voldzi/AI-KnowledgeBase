import { NextRequest, NextResponse } from "next/server";

import {
  getStratosBudgetUploadSettings,
  STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE,
} from "@/lib/stratos/document-ai";
import {
  getServerApiClients,
  getServerRequestContextForRequest,
} from "@/lib/api/server";
import {
  acceptDocumentIntakeContent,
  assertDocumentIntakePurpose,
} from "@/lib/upload/document-intake";
import {
  CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE,
  getUploadSettings,
  UploadPreflightError,
  verifyUploadToken,
  type UploadSettings,
  type UploadTokenPayload,
} from "@/lib/upload/preflight";

import { uploadErrorResponse } from "@/app/api/controlled-document/upload/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    const uploadToken = request.headers.get("X-AKL-Upload-Token") ?? "";
    const payload = verifyUploadToken(uploadToken);
    assertDocumentIntakePurpose(payload);
    await revalidateInteractivePolicy(request, payload);
    const accepted = await acceptDocumentIntakeContent({
      request,
      sessionId,
      uploadToken,
      payload,
      settings: settingsForPurpose(payload),
    });
    return NextResponse.json(accepted, { status: 201 });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}

function settingsForPurpose(payload: UploadTokenPayload): UploadSettings {
  if (payload.purpose === STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE) {
    return getStratosBudgetUploadSettings();
  }
  return getUploadSettings();
}

async function revalidateInteractivePolicy(
  request: NextRequest,
  payload: UploadTokenPayload,
): Promise<void> {
  if (payload.purpose !== CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE) return;
  const requestContext = await getServerRequestContextForRequest(request);
  const document = await getServerApiClients().registry.getDocument(
    payload.document_id,
    requestContext,
  );
  if (
    document.policy_binding_id !== payload.policy_binding_id
    || document.policy_version !== payload.policy_version
    || document.policy_hash !== payload.policy_hash
  ) {
    throw new UploadPreflightError(
      409,
      "UPLOAD_POLICY_BINDING_STALE",
      "Document policy changed after preflight.",
    );
  }
}
