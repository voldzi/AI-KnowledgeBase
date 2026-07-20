import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import {
  CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE,
  createUploadPreflightDecision,
} from "@/lib/upload/preflight";
import { parseInformationPolicy, policyHash } from "@/lib/stratos/information-policy";

import { uploadErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await getServerRequestContextForRequest(request);
    const forbidden = requireApiAccess(context, "knowledge_workspace");
    if (forbidden) return forbidden;
    const body = await request.json();
    const documentId = String(body.document_id ?? "");
    const document = await getServerApiClients().registry.getDocument(documentId, context);
    const informationPolicy = parseInformationPolicy(document.policy_summary);
    const preflight = createUploadPreflightDecision({
      document_id: documentId,
      file_name: String(body.file_name ?? ""),
      file_size: Number(body.file_size),
      file_type: body.file_type ? String(body.file_type) : null,
      sha256: String(body.sha256 ?? ""),
      policy_binding_id: informationPolicy.policyBindingId,
      policy_version: informationPolicy.policyVersion,
      policy_hash: policyHash(informationPolicy),
      purpose: CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE,
    });

    return NextResponse.json({ preflight }, { status: 201 });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
