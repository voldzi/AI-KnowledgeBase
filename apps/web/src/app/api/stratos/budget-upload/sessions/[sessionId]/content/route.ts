import { NextRequest, NextResponse } from "next/server";

import {
  getStratosBudgetUploadSettings,
  STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE,
} from "@/lib/stratos/document-ai";
import {
  assertUploadTokenPurpose,
  verifyUploadToken,
} from "@/lib/upload/preflight";
import { acceptDocumentIntakeContent } from "@/lib/upload/document-intake";

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
    const payload = verifyUploadToken(token, settings);
    assertUploadTokenPurpose(payload, STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE);
    const accepted = await acceptDocumentIntakeContent({
      request,
      sessionId,
      uploadToken: token,
      payload,
      settings,
    });
    return NextResponse.json(accepted, { status: 201 });
  } catch (error) {
    return stratosBridgeError(error);
  }
}
