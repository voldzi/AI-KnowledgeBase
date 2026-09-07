import { NextRequest, NextResponse } from "next/server";

import {
  getStratosBudgetUploadSettings,
  STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE,
} from "@/lib/stratos/document-ai";
import {
  getServerApiClients,
  getOptionalServerRequestContext,
} from "@/lib/api/server";
import { authenticateStratosDocumentServiceRequest } from "@/lib/stratos/document-service-auth";
import { acceptAuthorizedDocumentIntakeContent } from "@/lib/upload/document-intake-authorization";
import {
  assertDocumentIntakePurpose,
} from "@/lib/upload/document-intake";
import {
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
    const accepted = await acceptAuthorizedDocumentIntakeContent({
      request,
      sessionId,
      uploadToken,
      payload,
      settings: settingsForPurpose(payload),
    }, {
      registry: getServerApiClients().registry,
      getUserContext: async (currentRequest) => {
        const currentContext = await getOptionalServerRequestContext(currentRequest);
        if (!currentContext) {
          throw new UploadPreflightError(401, "UPLOAD_ACTOR_REQUIRED", "An authenticated upload actor is required.");
        }
        return currentContext;
      },
      getBudgetService: authenticateStratosDocumentServiceRequest,
    });
    return NextResponse.json(accepted, { status: 201, headers: { "Cache-Control": "private, no-store" } });
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
