import { NextRequest, NextResponse } from "next/server";

import { getOptionalServerRequestContext, getServerApiClients } from "@/lib/api/server";
import { isAklLanguage } from "@/lib/language";
import {
  buildRegistryDocumentReport,
  buildRegistryDocumentReportFromSummary,
  extractRegistryDocumentTopics,
  isRegistryDocumentReportQuestion,
  summarizeRegistryReportForAudit
} from "@/lib/reporting/assistant-registry-report";

import { assistantBridgeError, badAssistantRequest, unauthorizedAssistantRequest } from "../errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await getOptionalServerRequestContext(request);
    if (!context) {
      return unauthorizedAssistantRequest();
    }
    const clients = getServerApiClients();
    const message = String(body.message ?? "").trim();

    if (!message) {
      return badAssistantRequest("message is required.");
    }
    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : null;
    const requestContext = _objectContext(body.context);
    const responseLanguage = isAklLanguage(body.response_language) ? body.response_language : "cs";
    const buildRegistryResponseFromMetadata = async () => {
      try {
        const summary = await clients.registry.getDocumentMetadataSummary(context, {
          topics: extractRegistryDocumentTopics(message, responseLanguage)
        });
        return buildRegistryDocumentReportFromSummary({
          message,
          conversationId,
          context: requestContext,
          language: responseLanguage,
          summary
        });
      } catch {
        const documents = await clients.registry.listDocuments(context);
        return buildRegistryDocumentReport({
          message,
          conversationId,
          context: requestContext,
          language: responseLanguage,
          documents
        });
      }
    };

    if (isRegistryDocumentReportQuestion(message)) {
      const registryResponse = await buildRegistryResponseFromMetadata();
      if (registryResponse) {
        const scannedDocumentCount =
          typeof registryResponse.current_context.registry_report_scanned_document_count === "number"
            ? registryResponse.current_context.registry_report_scanned_document_count
            : 0;
        const auditSummary = summarizeRegistryReportForAudit(registryResponse, message, scannedDocumentCount);
        if (auditSummary) {
          await clients.registry.createAuditEvent(
            {
              actor_id: context.subjectId,
              event_type: "assistant.registry_report_returned",
              resource_type: "assistant_conversation",
              resource_id: registryResponse.conversation_id,
              severity: registryResponse.warnings.includes("REGISTRY_SCAN_LIMIT_REACHED") ? "warning" : "info",
              metadata: {
                artifact_id: auditSummary.artifactId,
                document_count: auditSummary.documentCount,
                message_sha256: auditSummary.messageHash,
                scanned_document_count: auditSummary.scannedDocumentCount,
                topic_count: auditSummary.topicCount,
                warning_count: auditSummary.warningCount
              }
            },
            context
          ).catch(() => undefined);
        }
        return NextResponse.json({ response: registryResponse });
      }
    }

    const response = await clients.rag.assistantChat(
      {
        user_id: context.subjectId,
        conversation_id: conversationId,
        message,
        context: requestContext,
        mode: body.mode ?? "it_support_answer",
        response_language: responseLanguage
      },
      context
    );

    return NextResponse.json({ response });
  } catch (error) {
    return assistantBridgeError(error);
  }
}

function _objectContext(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
