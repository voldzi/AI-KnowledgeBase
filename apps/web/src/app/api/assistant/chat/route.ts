import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { getOptionalServerRequestContext, getServerApiClients } from "@/lib/api/server";
import { getAklConfig, getDirectorCopilotConfig } from "@/lib/api/config";
import { contextFromStratosAccessProjection } from "@/lib/auth/access-projection";
import { normalizeAssistantChatResponse } from "@/lib/assistant/assistant-response-normalizer";
import {
  assistantConversationContextFromMessages,
  hasAssistantContinuityContext,
  mergeAssistantConversationContext,
  safeAssistantConversationContext,
} from "@/lib/assistant/conversation-context";
import {
  answerModeForAssistantRequest,
  ragContextForAssistantRoute,
  routeAssistantMessage,
  routeAssistantMessageForRag,
} from "@/lib/assistant/assistant-tool-router";
import {
  buildControlledRuleAssistantResponse,
  currentControlledRuleDate,
} from "@/lib/assistant/controlled-rule-answer";
import { composeMixedEvidenceAssistantResponse } from "@/lib/assistant/mixed-evidence-answer";
import {
  isAnalyticalAssistantGoal,
  queryStateForAssistantGoal,
} from "@/lib/assistant/user-goal";
import { resolveConversationQuery } from "@/lib/director-copilot/query-state";
import {
  auditDirectorCopilotV2Failure,
  directorCopilotV2FailureResponse,
  runDirectorCopilotV2Chat,
} from "@/lib/director-copilot-v2/chat";
import { classifyDirectorCopilotV2Intent } from "@/lib/director-copilot-v2/intent-router";
import {
  directorCopilotV2PersistenceMetadata,
  persistedDirectorCopilotV2Response,
} from "@/lib/director-copilot-v2/history";
import { isAklLanguage } from "@/lib/language";
import { withServerSpan } from "@/lib/observability/server-tracing";
import {
  buildRegistryDocumentReport,
  buildRegistryDocumentReportFromSummary,
  registryDocumentTypeFilterForReport,
  registrySummaryOptionsFromMessage,
  registryTopicsForDocumentListRequest,
  summarizeRegistryReportForAudit
} from "@/lib/reporting/assistant-registry-report";
import type {
  AssistantChatResponse,
  AssistantConversationDetail,
  Classification,
  Document,
  DocumentMetadataSummaryOptions,
  DocumentStatus,
  DocumentType,
} from "@/lib/types";

import { assistantBridgeError, badAssistantRequest, unauthorizedAssistantRequest } from "../errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return withServerSpan(
    "akb.assistant.chat",
    {
      "akb.operation": "assistant_chat",
      "akb.channel": process.env.AKL_WEB_PROFILE === "chat" ? "chat" : "workspace",
    },
    async (span) => {
      const response = await handlePost(request);
      span.setAttribute("http.response.status_code", response.status);
      return response;
    },
  );
}

async function handlePost(request: NextRequest) {
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
    let requestContext = safeAssistantConversationContext(_objectContext(body.context));
    if (conversationId && !hasAssistantContinuityContext(requestContext)) {
      const persistedConversation = await clients.registry
        .getAssistantConversation(conversationId, context)
        .catch(() => undefined);
      if (persistedConversation) {
        requestContext = mergeAssistantConversationContext(
          assistantConversationContextFromMessages(persistedConversation.messages),
          requestContext,
        );
      }
    }
    const responseLanguage = isAklLanguage(body.response_language) ? body.response_language : "cs";
    const config = getAklConfig();
    const directorConfig = getDirectorCopilotConfig(config);
    const assistantRoute = routeAssistantMessage(message, responseLanguage, requestContext);
    const documentationRequest = assistantRoute.documentKnowledge.applicationDocumentation;
    const assistantGoal = assistantRoute.queryPlan.goal;
    const directorQuery = resolveConversationQuery({
      message,
      context: requestContext,
    });
    const directorQueryState = queryStateForAssistantGoal(
      directorQuery.state,
      assistantGoal,
    );
    const directorIntent = assistantRoute.tool === "controlled_rule_answer"
      ? null
      : classifyDirectorCopilotV2Intent(message, requestContext);
    if (directorIntent && directorQuery.clarification?.kind === "plan_meaning") {
      const clarificationResponse = directorPlanClarificationResponse({
        conversationId,
        language: responseLanguage,
        queryState: directorQuery.state,
      });
      const persistedConversation = await clients.registry
        .appendAssistantConversationMessages(
          clarificationResponse.conversation_id,
          {
            user_id: context.subjectId,
            title: titleFromMessage(message),
            messages: assistantTurnMessages(message, clarificationResponse, {
              assistant_tool: "director_copilot_v2_clarification",
              clarification_kind: "director_plan_meaning",
              current_context: clarificationResponse.current_context,
              questions: clarificationResponse.questions,
              why_needed: clarificationResponse.why_needed,
            }),
          },
          context,
        )
        .catch(() => undefined);
      return NextResponse.json({
        response: persistedConversation
          ? clarificationResponse
          : withHistoryPersistenceWarning(clarificationResponse),
        message_id: latestAssistantMessageId(persistedConversation),
        persistence_status: persistedConversation ? "persisted" : "failed",
      });
    }
    if (directorIntent) {
      const refreshActorContext = context.accessToken
        ? () => contextFromStratosAccessProjection(context.accessToken!, config, fetch, Date.now(), true)
        : undefined;
      const directorPromise: Promise<AssistantChatResponse> = directorConfig.enabled
        ? runDirectorCopilotV2Chat({
            message: documentationRequest?.liveMessage ?? message,
            conversationId,
            responseLanguage,
            actorContext: context,
            clients,
            config,
            intent: directorIntent,
            queryState: directorQueryState,
            refreshActorContext,
            mode: "active",
          }).catch(async (error: unknown) => {
            await auditDirectorCopilotV2Failure({
              conversationId,
              actorContext: context,
              clients,
              config,
              mode: "active",
              error,
            }).catch(() => undefined);
            return directorCopilotV2FailureResponse({
              conversationId,
              language: responseLanguage,
              error,
              queryState: directorQueryState,
            });
          })
        : Promise.resolve(directorCopilotV2FailureResponse({
            conversationId,
            language: responseLanguage,
            error: new Error("DIRECTOR_COPILOT_V2_DISABLED"),
            queryState: directorQueryState,
          }));
      const includeDocumentEvidence = isAnalyticalAssistantGoal(assistantGoal)
        || Boolean(documentationRequest?.liveMessage);
      const documentResultPromise: Promise<{
        response: AssistantChatResponse | null;
        unavailable: boolean;
      }> = includeDocumentEvidence
        ? (async () => {
            const documentRoute = routeAssistantMessageForRag(
              documentationRequest?.documentMessage ?? message,
              responseLanguage,
              requestContext,
            );
            try {
              const rawResponse = await clients.rag.assistantChat(
                {
                  user_id: context.subjectId,
                  conversation_id: conversationId,
                  message: documentationRequest?.documentMessage ?? message,
                  context: ragContextForAssistantRoute({
                    ...requestContext,
                    assistant_goal: assistantGoal,
                    mixed_evidence_role: "document_guidance",
                  }, documentRoute),
                  mode: documentRoute.answerMode,
                  response_language: responseLanguage,
                  persist_conversation: false,
                },
                context,
              );
              return {
                response: normalizeAssistantChatResponse({
                  response: rawResponse,
                  message,
                  language: responseLanguage,
                  route: documentRoute,
                }),
                unavailable: false,
              };
            } catch {
              return { response: null, unavailable: true };
            }
          })()
        : Promise.resolve({ response: null, unavailable: false });
      const [directorResponse, documentResult] = await Promise.all([
        directorPromise,
        documentResultPromise,
      ]);
      const composedResponse = includeDocumentEvidence
        ? composeMixedEvidenceAssistantResponse({
            directorResponse,
            documentResponse: documentResult.response,
            documentUnavailable: documentResult.unavailable,
            goal: assistantGoal,
            language: responseLanguage,
          })
        : directorResponse;
      const response = persistedDirectorCopilotV2Response(composedResponse);
      const persistedConversation = await clients.registry
        .appendAssistantConversationMessages(
          response.conversation_id,
          {
            user_id: context.subjectId,
            title: titleFromMessage(message),
            messages: assistantTurnMessages(
              message,
              response,
              {
                ...directorCopilotV2PersistenceMetadata(composedResponse, context),
                assistant_goal: assistantGoal,
                answer_composition: includeDocumentEvidence
                  ? "live_and_document_evidence"
                  : "live_data",
              },
            ),
          },
          context,
        )
        .catch(() => undefined);
      return NextResponse.json({
        response: persistedConversation
          ? response
          : withHistoryPersistenceWarning(response),
        message_id: latestAssistantMessageId(persistedConversation),
        persistence_status: persistedConversation ? "persisted" : "failed",
      });
    }
    if (assistantRoute.tool === "controlled_rule_answer" && assistantRoute.controlledRuleIntent) {
      const validOn = assistantRoute.controlledRuleIntent.validOn ?? currentControlledRuleDate();
      const controlledRules = await clients.registry.listControlledRules(
        assistantRoute.controlledRuleIntent.domain,
        context,
        { validOn, approvedOnly: true, consumerView: true },
      );
      const controlledResponse = normalizeAssistantChatResponse({
        response: buildControlledRuleAssistantResponse({
          message,
          conversationId,
          context: requestContext,
          language: responseLanguage,
          result: controlledRules,
        }),
        message,
        language: responseLanguage,
        route: assistantRoute,
      });
      const persistedConversation = await clients.registry
        .appendAssistantConversationMessages(
          controlledResponse.conversation_id,
          {
            user_id: context.subjectId,
            title: titleFromMessage(message),
            messages: assistantTurnMessages(message, controlledResponse, {
              assistant_tool: assistantRoute.tool,
              assistant_tool_reason: assistantRoute.reason,
              confidence: controlledResponse.confidence,
              current_context: controlledResponse.current_context,
              warnings: controlledResponse.warnings,
            }),
          },
          context,
        )
        .catch(() => undefined);
      return NextResponse.json({
        response: persistedConversation
          ? controlledResponse
          : withHistoryPersistenceWarning(controlledResponse),
        message_id: latestAssistantMessageId(persistedConversation),
        persistence_status: persistedConversation ? "persisted" : "failed",
      });
    }

    const registrySummaryFilters = {
      ...registrySummaryOptionsFromAssistantContext(requestContext),
      ...registrySummaryOptionsFromMessage(message),
    };
    const registryReportKind = assistantRoute.registryReportKind ?? "document_inventory_summary";
    const inferredDocumentType = registryDocumentTypeFilterForReport(message, registryReportKind);
    if (!registrySummaryFilters.documentType && inferredDocumentType) {
      registrySummaryFilters.documentType = inferredDocumentType;
    }
    const registryTopics = inferredDocumentType
      ? registryTopicsForDocumentListRequest(message, assistantRoute.registryTopics, responseLanguage)
      : assistantRoute.registryTopics;
    const buildRegistryResponseFromMetadata = async () => {
      if (registryReportKind === "document_list") {
        const documents = await clients.registry.listDocuments(context, {
          topics: registryTopics,
          ...registrySummaryFilters
        });
        return buildRegistryDocumentReport({
          message,
          conversationId,
          context: requestContext,
          language: responseLanguage,
          kind: registryReportKind,
          documents
        });
      }
      try {
        const summary = await clients.registry.getRagDocumentMetadataSummary(context, {
          topics: registryTopics,
          ...registrySummaryFilters
        });
        return buildRegistryDocumentReportFromSummary({
          message,
          conversationId,
          context: requestContext,
          language: responseLanguage,
          kind: registryReportKind,
          summary
        });
      } catch {
        const documents = await clients.registry.listDocuments(context, {
          topics: registryTopics,
          ...registrySummaryFilters
        });
        return buildRegistryDocumentReport({
          message,
          conversationId,
          context: requestContext,
          language: responseLanguage,
          kind: registryReportKind,
          documents: filterDocumentsForSummaryOptions(documents, registrySummaryFilters)
        });
      }
    };

    if (assistantRoute.tool === "registry_document_report") {
      const registryResponse = await buildRegistryResponseFromMetadata();
      if (registryResponse) {
        const normalizedRegistryResponse = normalizeAssistantChatResponse({
          response: registryResponse,
          message,
          language: responseLanguage,
          route: assistantRoute
        });
        const persistedConversation = await clients.registry.appendAssistantConversationMessages(
          normalizedRegistryResponse.conversation_id,
          {
            user_id: context.subjectId,
            title: titleFromMessage(message),
            messages: [
              {
                role: "user",
                content: message,
                citations: [],
                metadata: {}
              },
              {
                role: "assistant",
                content: normalizedRegistryResponse.answer ?? normalizedRegistryResponse.message ?? normalizedRegistryResponse.recommended_action ?? "(empty)",
                response_type: normalizedRegistryResponse.response_type,
                citations: normalizedRegistryResponse.citations,
                metadata: {
                  assistant_tool: assistantRoute.tool,
                  assistant_tool_reason: assistantRoute.reason,
                  confidence: normalizedRegistryResponse.confidence,
                  current_context: normalizedRegistryResponse.current_context,
                  report_artifacts: normalizedRegistryResponse.report_artifacts,
                  warnings: normalizedRegistryResponse.warnings
                }
              }
            ]
          },
          context
        ).catch(() => undefined);
        const scannedDocumentCount =
          typeof normalizedRegistryResponse.current_context.registry_report_scanned_document_count === "number"
            ? normalizedRegistryResponse.current_context.registry_report_scanned_document_count
            : 0;
        const auditSummary = summarizeRegistryReportForAudit(normalizedRegistryResponse, message, scannedDocumentCount);
        if (auditSummary) {
          await clients.registry.createAuditEvent(
            {
              actor_id: context.subjectId,
              event_type: "assistant.registry_report_returned",
              resource_type: "assistant_conversation",
              resource_id: normalizedRegistryResponse.conversation_id,
              severity: normalizedRegistryResponse.warnings.includes("REGISTRY_SCAN_LIMIT_REACHED") ? "warning" : "info",
              metadata: {
                artifact_id: auditSummary.artifactId,
                assistant_tool: assistantRoute.tool,
                assistant_tool_reason: assistantRoute.reason,
                document_count: auditSummary.documentCount,
                message_sha256: auditSummary.messageHash,
                registry_report_kind: registryReportKind,
                scanned_document_count: auditSummary.scannedDocumentCount,
                topic_count: auditSummary.topicCount,
                warning_count: auditSummary.warningCount
              }
            },
            context
          ).catch(() => undefined);
        }
        return NextResponse.json({
          response: persistedConversation
            ? normalizedRegistryResponse
            : withHistoryPersistenceWarning(normalizedRegistryResponse),
          message_id: latestAssistantMessageId(persistedConversation),
          persistence_status: persistedConversation ? "persisted" : "failed",
        });
      }
    }

    const response = await clients.rag.assistantChat(
      {
        user_id: context.subjectId,
        conversation_id: conversationId,
        message,
        context: ragContextForAssistantRoute(requestContext, assistantRoute),
        mode: answerModeForAssistantRequest(assistantRoute, body.mode),
        response_language: responseLanguage
      },
      context
    );

    const normalizedResponse = normalizeAssistantChatResponse({
        response,
        message,
        language: responseLanguage,
        route: assistantRoute
      });
    let persistedConversation = normalizedResponse.warnings.includes(
      "CONVERSATION_HISTORY_NOT_PERSISTED",
    )
      ? undefined
      : await clients.registry
          .getAssistantConversation(normalizedResponse.conversation_id, context)
          .catch(() => undefined);
    if (!conversationId && persistedConversation && !persistedConversation.title) {
      persistedConversation = await clients.registry
        .updateAssistantConversation(
          normalizedResponse.conversation_id,
          { title: titleFromMessage(message) },
          context,
        )
        .catch(() => persistedConversation);
    }
    return NextResponse.json({
      response: persistedConversation
        ? normalizedResponse
        : withHistoryPersistenceWarning(normalizedResponse),
      message_id: latestAssistantMessageId(persistedConversation),
      persistence_status: persistedConversation ? "persisted" : "failed",
    });
  } catch (error) {
    return assistantBridgeError(error);
  }
}

function directorPlanClarificationResponse(input: {
  conversationId: string | null;
  language: "cs" | "en";
  queryState: ReturnType<typeof resolveConversationQuery>["state"];
}): AssistantChatResponse {
  const english = input.language === "en";
  return {
    response_type: "clarification_needed",
    conversation_id: input.conversationId
      ?? `conv_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    answer: null,
    message: english
      ? "Please clarify what kind of plan you mean."
      : "Upřesněte prosím, jaký druh plánu máte na mysli.",
    questions: [{
      id: "director_plan_meaning",
      question: english
        ? "Which plan should AKB use?"
        : "Který plán má AKB použít?",
      type: "single_choice",
      options: english
        ? ["Financial plan and budget", "Project schedule and deadlines"]
        : ["Finanční plán a rozpočet", "Projektový harmonogram a termíny"],
    }],
    why_needed: english
      ? "The word plan can refer to financial data in Budget or delivery dates in ProjectFlow."
      : "Slovo plán může znamenat finanční údaje v Budgetu nebo termíny realizace v ProjectFlow.",
    current_context: {
      answer_source: "director_copilot_v2_clarification",
      clarification_kind: "director_plan_meaning",
      stratos_query_state: input.queryState,
    },
    citations: [],
    follow_up_questions: [],
    suggested_actions: [],
    report_artifacts: [],
    confidence: "high",
    warnings: [],
    missing_information: english ? "Plan meaning" : "Význam plánu",
    recommended_action: null,
  };
}

function assistantTurnMessages(
  message: string,
  response: AssistantChatResponse,
  metadata: Record<string, unknown>,
) {
  return [
    {
      role: "user" as const,
      content: message,
      citations: [],
      metadata: {},
    },
    {
      role: "assistant" as const,
      content:
        response.answer
        ?? response.message
        ?? response.recommended_action
        ?? "(empty)",
      response_type: response.response_type,
      citations: response.citations,
      metadata,
    },
  ];
}

function withHistoryPersistenceWarning(
  response: AssistantChatResponse,
): AssistantChatResponse {
  return {
    ...response,
    warnings: [...new Set([
      ...response.warnings,
      "CONVERSATION_HISTORY_NOT_PERSISTED",
    ])],
  };
}

function latestAssistantMessageId(
  conversation: AssistantConversationDetail | undefined,
): string | null {
  if (!conversation) {
    return null;
  }
  return [...conversation.messages]
    .reverse()
    .find((message) => message.role === "assistant")
    ?.message_id ?? null;
}

function _objectContext(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const DOCUMENT_TYPES: readonly DocumentType[] = [
  "directive",
  "regulation",
  "methodology",
  "policy",
  "procedure",
  "manual",
  "knowledge_base_article",
  "project_documentation",
  "meeting_record",
  "contract",
  "attachment",
  "ai_intake",
  "ai_requirement_card",
  "ai_security_appendix",
  "ai_governance_evidence",
  "other"
];

const DOCUMENT_STATUSES: readonly DocumentStatus[] = [
  "draft",
  "review",
  "approved",
  "valid",
  "superseded",
  "archived",
  "cancelled"
];

const CLASSIFICATIONS: readonly Classification[] = ["public", "internal", "restricted", "confidential"];

function registrySummaryOptionsFromAssistantContext(
  context: Record<string, unknown>
): Omit<DocumentMetadataSummaryOptions, "topics"> {
  const status = contextString(context, "status", "document_status", "documentStatus");
  const classification = contextString(context, "classification");
  const documentType = contextString(context, "document_type", "documentType");
  const contextTags = dedupeStrings(
    contextStringList(context, "context_tags", "contextTags", "context_tag", "contextTag", "tags")
  );
  const options: Omit<DocumentMetadataSummaryOptions, "topics"> = {
    tenantId: contextString(context, "tenant_id", "tenantId", "tenant"),
    externalSystem: contextString(context, "external_system", "externalSystem"),
    entityType: contextString(context, "entity_type", "entityType"),
    entityId: contextString(context, "entity_id", "entityId"),
    externalRef: contextString(context, "external_ref", "externalRef"),
    ownerId: contextString(context, "owner_id", "ownerId"),
    tag: contextString(context, "tag")
  };
  if (isAllowedValue(status, DOCUMENT_STATUSES)) {
    options.status = status;
  }
  if (isAllowedValue(classification, CLASSIFICATIONS)) {
    options.classification = classification;
  }
  if (isAllowedValue(documentType, DOCUMENT_TYPES)) {
    options.documentType = documentType;
  }
  if (contextTags.length) {
    options.contextTags = contextTags;
  }
  return compactSummaryOptions(options);
}

function contextString(context: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const source of contextSources(context)) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return undefined;
}

function contextStringList(context: Record<string, unknown>, ...keys: string[]): string[] {
  const values: string[] = [];
  for (const source of contextSources(context)) {
    for (const key of keys) {
      const value = source[key];
      if (Array.isArray(value)) {
        values.push(...value.filter((candidate): candidate is string => typeof candidate === "string"));
      } else if (typeof value === "string" && value.trim()) {
        values.push(value);
      }
    }
  }
  return values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
}

function contextSources(context: Record<string, unknown>): Array<Record<string, unknown>> {
  const sources = [context];
  for (const key of ["stratos", "akb", "document", "entity"]) {
    const value = context[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      sources.push(value as Record<string, unknown>);
    }
  }
  return sources;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isAllowedValue<T extends string>(value: string | undefined, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function compactSummaryOptions(
  options: Omit<DocumentMetadataSummaryOptions, "topics">
): Omit<DocumentMetadataSummaryOptions, "topics"> {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== "";
    })
  ) as Omit<DocumentMetadataSummaryOptions, "topics">;
}

function filterDocumentsForSummaryOptions(
  documents: Document[],
  options: Omit<DocumentMetadataSummaryOptions, "topics">
): Document[] {
  return documents.filter((document) => {
    if (options.status && document.status !== options.status) {
      return false;
    }
    if (options.classification && document.classification !== options.classification) {
      return false;
    }
    if (options.documentType && document.document_type !== options.documentType) {
      return false;
    }
    if (options.ownerId && document.owner_id !== options.ownerId) {
      return false;
    }
    if (options.tag && !document.tags.includes(options.tag)) {
      return false;
    }
    if (options.tenantId && documentMetadataString(document, "tenant_id") !== options.tenantId) {
      return false;
    }
    if (options.externalSystem && documentMetadataString(document, "external_system") !== options.externalSystem) {
      return false;
    }
    if (options.entityType && documentMetadataString(document, "entity_type") !== options.entityType) {
      return false;
    }
    if (options.entityId && documentMetadataString(document, "entity_id") !== options.entityId) {
      return false;
    }
    if (options.externalRef && documentMetadataString(document, "external_ref") !== options.externalRef) {
      return false;
    }
    if (options.contextTags?.length && !options.contextTags.every((tag) => documentMatchesContextTag(document, tag))) {
      return false;
    }
    return true;
  });
}

function titleFromMessage(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized || "AKB chat";
}

function documentMetadataString(document: Document, key: string): string | null {
  const metadata = document.metadata;
  const direct = metadata?.[key];
  if (typeof direct === "string") {
    return direct;
  }
  for (const nestedKey of ["stratos", "external"]) {
    const nested = metadata?.[nestedKey];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const value = (nested as Record<string, unknown>)[key];
      if (typeof value === "string") {
        return value;
      }
    }
  }
  return null;
}

function documentMatchesContextTag(document: Document, contextTag: string): boolean {
  const normalized = normalizeDocumentContextValue(contextTag);
  if (!normalized) {
    return true;
  }
  if (document.tags.some((tag) => normalizeDocumentContextValue(tag) === normalized)) {
    return true;
  }
  return documentMetadataValues(document.metadata).some((value) => normalizeDocumentContextValue(value).includes(normalized));
}

function documentMetadataValues(metadata: Record<string, unknown> | undefined): string[] {
  if (!metadata) {
    return [];
  }
  return Object.entries(metadata).flatMap(([key, value]) => metadataEntryValues(key, value));
}

function metadataEntryValues(key: string, value: unknown): string[] {
  if (value === null || value === undefined) {
    return [key];
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [key, String(value)];
  }
  if (Array.isArray(value)) {
    return [key, ...value.filter((item) => ["string", "number", "boolean"].includes(typeof item)).map(String)];
  }
  if (typeof value === "object") {
    return [
      key,
      ...Object.entries(value as Record<string, unknown>).flatMap(([nestedKey, nestedValue]) =>
        metadataEntryValues(nestedKey, nestedValue)
      )
    ];
  }
  return [key];
}

function normalizeDocumentContextValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, " ")
    .trim();
}
