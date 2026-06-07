import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import type { Classification, DocumentType } from "@/lib/types";

import { badRequest, bridgeError } from "../errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await getServerRequestContext();
    const clients = getServerApiClients();
    const classification = String(body.classification ?? "internal") as Classification;
    const title = String(body.title ?? "").trim();

    if (!title) {
      return badRequest("Document title is required.");
    }

    const document = await clients.registry.createDocument(
      {
        title,
        document_type: String(body.document_type ?? "directive") as DocumentType,
        owner_id: String(body.owner_id ?? context.subjectId).trim(),
        gestor_unit: String(body.gestor_unit ?? "").trim(),
        classification,
        tags: _csv(String(body.tags ?? "controlled-document,phase02")),
        metadata: {
          source: "web-controlled-document-workflow"
        },
        access_policies: [
          {
            subjects: [`user:${context.subjectId}`, "role:reader"],
            actions: ["document.read", "rag.query"],
            constraints: { classification_max: classification }
          },
          {
            subjects: ["role:service_ingestion", "role:document_manager", "role:admin"],
            actions: [
              "document.read",
              "document.ingest",
              "document.reindex",
              "document.version.create",
              "document.version.publish",
              "document.version.archive"
            ],
            constraints: { classification_max: classification }
          }
        ]
      },
      context
    );

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return bridgeError(error);
  }
}

function _csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
