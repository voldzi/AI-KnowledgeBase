import { NextRequest, NextResponse } from "next/server";

import { getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { createUploadPreflightDecision } from "@/lib/upload/preflight";

import { uploadErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await getServerRequestContext();
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const body = await request.json();
    const preflight = createUploadPreflightDecision({
      document_id: String(body.document_id ?? ""),
      file_name: String(body.file_name ?? ""),
      file_size: Number(body.file_size),
      file_type: body.file_type ? String(body.file_type) : null,
      sha256: String(body.sha256 ?? "")
    });

    return NextResponse.json({ preflight }, { status: 201 });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
