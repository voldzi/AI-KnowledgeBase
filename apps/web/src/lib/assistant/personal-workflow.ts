import { randomUUID } from "node:crypto";

import { buildWorkflowTasks } from "@/features/tasks/workflow-task-model";
import { workflowTaskPresentation } from "@/features/tasks/workflow-task-presentation";
import { documentDeadlines, managesDocument, urgentDeadline, workflowToday } from "@/features/tasks/document-deadlines";
import { canAccessWorkspaceRouteForContext, canUseEmployeeChat } from "@/lib/auth/authorization";
import { ApiClientError } from "@/lib/types";
import type { ApiRequestContext, AssistantChatResponse, RegistryApiClient, ResponseLanguage, WorkflowPage } from "@/lib/types";
import type { PersonalWorkflowIntent } from "./personal-workflow-intent";

export const PERSONAL_WORKFLOW_PREVIEW_LIMIT = 5;
type WorkflowStatus = "complete" | "no_data" | "not_authorized" | "unavailable" | "history";

export async function answerPersonalWorkflow(input: {
  intent: PersonalWorkflowIntent;
  context: ApiRequestContext;
  registry: Pick<RegistryApiClient, "listWorkflowTaskPage" | "listWorkflowDocumentPage">;
  language: ResponseLanguage;
  conversationId: string | null;
  workspaceHref?: string;
  refreshContext?: () => Promise<ApiRequestContext>;
  now?: Date;
}): Promise<AssistantChatResponse> {
  const { intent, context, registry, language } = input;
  const now = input.now ?? new Date();
  const en = language === "en";
  const response = baseResponse(intent, input.conversationId, language);
  if (!canReadPersonalWorkflow(context)) return failure(response, "not_authorized", language);
  try {
    if (context.authorizationSource !== "mock" && !input.refreshContext) {
      throw new Error("WORKFLOW_REAUTHORIZATION_REQUIRED");
    }
    const paging = { limit: PERSONAL_WORKFLOW_PREVIEW_LIMIT, offset: 0 };
    let rows: string[];
    let total: number;
    if (intent.view === "documents") {
      const page = await registry.listWorkflowDocumentPage(context, {
        ...paging, assignment: "managed", deadline: intent.deadline,
      });
      assertPage(page, (item) => item.document_id);
      const today = workflowToday(now.toISOString());
      if (page.items.some((item) => !managesDocument(item)
        || typeof item.title !== "string"
        || (intent.deadline && !matchesDeadline(documentDeadlines(item, today), intent.deadline)))) {
        throw new Error("WORKFLOW_RESPONSE_INVALID");
      }
      total = page.total;
      rows = page.items.map((item) => {
        const details = [item.version_label ? `${en ? "version" : "verze"} ${item.version_label}` : null,
          item.review_due_on ? `${en ? "review" : "revize"}: ${formatDate(item.review_due_on, language)}` : null];
        return `- **${plainMarkdown(item.title)}**${details.filter(Boolean).length ? ` · ${details.filter(Boolean).map((value) => plainMarkdown(value!)).join(" · ")}` : ""}`;
      });
    } else {
      const page = await registry.listWorkflowTaskPage(context, {
        ...paging, assignedToMe: true, includeResolved: false,
        ...(intent.view === "approvals" ? { kind: "review" as const } : {}),
      });
      assertPage(page, (item) => item.task_id);
      if (page.items.some((item) => item.assigned_to_me !== true
        || !["open", "waiting", "blocked"].includes(item.status)
        || (intent.view === "approvals" && item.kind !== "review"))) {
        throw new Error("WORKFLOW_RESPONSE_INVALID");
      }
      total = page.total;
      rows = buildWorkflowTasks({ documents: [], jobs: [], auditEvents: [], registryTasks: page.items, preserveRegistryOrder: true })
        .map((item) => {
          const title = workflowTaskPresentation(item, language).title;
          const document = item.document_title ? ` · ${plainMarkdown(item.document_title)}` : "";
          const due = item.due_at ? ` · ${en ? "due" : "termín"}: ${formatDate(item.due_at, language)}` : "";
          return `- **${plainMarkdown(title)}**${document}${due}`;
        });
    }
    const refreshed = input.refreshContext ? await input.refreshContext() : context;
    if (!canReadPersonalWorkflow(refreshed) || accessSnapshot(context) !== accessSnapshot(refreshed)) {
      return failure(response, "not_authorized", language);
    }
    const title = viewTitle(intent, language);
    response.answer = [
      `**${title}**`,
      total === 0
        ? en ? "No matching records are currently assigned to you in AKB." : "V AKB vám nyní nejsou přiřazeny žádné odpovídající záznamy."
        : en ? `Assigned records: **${total}**.${total > rows.length ? ` Showing the first ${rows.length}.` : ""}`
          : `Přiřazené záznamy: **${total}**.${total > rows.length ? ` Zobrazeno prvních ${rows.length}.` : ""}`,
      rows.join("\n"),
      input.workspaceHref ? `[${en ? "Open My workspace" : "Otevřít Moji práci"}](${input.workspaceHref})` : null,
      `${en ? "Verified" : "Ověřeno"}: ${new Intl.DateTimeFormat(en ? "en-GB" : "cs-CZ", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Prague" }).format(now)} (Europe/Prague).`,
    ].filter(Boolean).join("\n\n");
    response.confidence = total ? "high" : null;
    response.current_context.workflow_workspace = {
      ...intent, status: total ? "complete" : "no_data", observed_at: now.toISOString(),
      total, returned_count: rows.length,
    };
    return response;
  } catch (error) {
    return failure(response, error instanceof ApiClientError && [401, 403].includes(error.status)
      ? "not_authorized" : "unavailable", language);
  }
}

// Personal queues are live, not shareable evidence. Persist only a neutral refresh receipt.
export function personalWorkflowHistoryResponse(response: AssistantChatResponse, language: ResponseLanguage): AssistantChatResponse {
  const receipt = baseResponse({ view: "mine" }, response.conversation_id, language);
  receipt.answer = language === "en"
    ? "Personal workspace overview. Refresh to see your currently assigned records."
    : "Osobní pracovní přehled. Obnovte jej pro zobrazení aktuálně přiřazených záznamů.";
  receipt.current_context.workflow_workspace = { status: "history" };
  return receipt;
}

export async function persistPersonalWorkflowTurn(input: {
  message: string;
  title: string;
  response: AssistantChatResponse;
  language: ResponseLanguage;
  context: ApiRequestContext;
  registry: Pick<RegistryApiClient, "appendAssistantConversationMessages">;
}): Promise<{ response: AssistantChatResponse; message_id: string | null; persistence_status: "persisted" | "failed" }> {
  const receipt = personalWorkflowHistoryResponse(input.response, input.language);
  const persisted = await input.registry.appendAssistantConversationMessages(input.response.conversation_id, {
    user_id: input.context.subjectId, title: input.title,
    messages: [
      { role: "user", content: input.message, citations: [], metadata: {} },
      { role: "assistant", content: receipt.answer!, response_type: receipt.response_type, citations: [], metadata: {
        assistant_tool: "workflow_workspace", assistant_tool_reason: "personal_workflow_intent",
        current_context: receipt.current_context, follow_up_questions: receipt.follow_up_questions,
      } },
    ],
  }, input.context).catch(() => undefined);
  return {
    response: persisted ? input.response : {
      ...input.response, warnings: [...new Set([...input.response.warnings, "CONVERSATION_HISTORY_NOT_PERSISTED"])],
    },
    message_id: persisted?.messages.filter((item) => item.role === "assistant").at(-1)?.message_id ?? null,
    persistence_status: persisted ? "persisted" : "failed",
  };
}

function baseResponse(intent: PersonalWorkflowIntent, conversationId: string | null, language: ResponseLanguage): AssistantChatResponse {
  return {
    response_type: "answer", conversation_id: conversationId ?? `conv_${randomUUID().replaceAll("-", "")}`,
    answer: null, message: null, questions: [], why_needed: null,
    current_context: {
      answer_source: "akb_workflow", workflow_workspace: { ...intent, status: "complete" },
      stratos_query_state: null, active_source_application: null, live_sources: null, mixed_evidence: null,
      controlled_rule_domain: null, controlled_rule_valid_on: null,
      controlled_rule_source_scope: null, document_id: null, document_version_id: null,
      document_knowledge_state: null, registry_report_kind: null, clarification_kind: null,
    },
    citations: [], report_artifacts: [], suggested_actions: [], warnings: [], confidence: null,
    missing_information: null, recommended_action: null,
    follow_up_questions: [language === "en" ? "Show my current tasks in AKB." : "Zobraz mé aktuální úkoly v AKB."],
  };
}

function canReadPersonalWorkflow(context: ApiRequestContext): boolean {
  return Boolean(context.subjectId) && !context.serviceClientId && canUseEmployeeChat(context)
    && canAccessWorkspaceRouteForContext(context, "/tasks");
}

function accessSnapshot(context: ApiRequestContext): string {
  const sorted = (values: string[] | undefined) => [...new Set(values ?? [])].sort();
  return JSON.stringify({
    subject: context.subjectId, organization: context.organizationId,
    roles: sorted(context.roles), groups: sorted(context.groups), capabilities: sorted(context.capabilities), scopes: sorted(context.scopes),
    grants: (context.applicationAccess ?? []).filter((grant) => grant.application === "akb").map((grant) => ({
      capabilities: sorted(grant.capabilities), scopes: sorted(grant.scopes), effectiveScopes: sorted(grant.effectiveScopes), validUntil: grant.validUntil,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
}

function assertPage<T>(page: WorkflowPage<T>, id: (item: T) => string): void {
  if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0
    || page.offset !== 0 || page.limit !== PERSONAL_WORKFLOW_PREVIEW_LIMIT
    || page.items.length !== Math.min(page.total, PERSONAL_WORKFLOW_PREVIEW_LIMIT)) throw new Error("WORKFLOW_PAGE_INCOMPLETE");
  const ids = page.items.map(id);
  if (ids.some((value) => typeof value !== "string" || !value) || new Set(ids).size !== ids.length) {
    throw new Error("WORKFLOW_PAGE_DUPLICATE");
  }
}

function failure(response: AssistantChatResponse, status: Extract<WorkflowStatus, "not_authorized" | "unavailable">, language: ResponseLanguage): AssistantChatResponse {
  const en = language === "en";
  return {
    ...response, response_type: status === "not_authorized" ? "restricted" : "no_answer",
    answer: status === "not_authorized"
      ? en ? "Your current access does not allow this personal workspace overview. No records were disclosed." : "Vaše aktuální oprávnění neumožňuje zobrazit tento osobní přehled. Žádné záznamy nebyly zpřístupněny."
      : en ? "The personal workspace could not be verified right now. Try again later; this is not an empty task list." : "Osobní přehled se nyní nepodařilo ověřit. Zkuste to později; nejde o prázdný seznam úkolů.",
    confidence: "insufficient_source", current_context: { ...response.current_context, workflow_workspace: { status } },
    warnings: [status === "not_authorized" ? "WORKFLOW_ACCESS_DENIED" : "WORKFLOW_UNAVAILABLE"],
  };
}

function viewTitle(intent: PersonalWorkflowIntent, language: ResponseLanguage): string {
  const labels = language === "en"
    ? { mine: "My open tasks in AKB", approvals: "My pending reviews in AKB", documents: "Documents I manage in AKB" }
    : { mine: "Moje otevřené úkoly v AKB", approvals: "Moje úkoly ke schválení v AKB", documents: "Dokumenty, které spravuji v AKB" };
  const deadlines = language === "en"
    ? { attention: "deadlines within 30 days or overdue", expired: "expired", review: "review within 30 days, overdue or invalid", missing: "missing review date" }
    : { attention: "termíny do 30 dnů nebo po lhůtě", expired: "po platnosti", review: "revize do 30 dnů, po lhůtě nebo s chybným datem", missing: "chybějící termín revize" };
  return `${labels[intent.view]}${intent.deadline ? `: ${deadlines[intent.deadline]}` : ""}`;
}

function matchesDeadline(values: ReturnType<typeof documentDeadlines>, deadline: NonNullable<PersonalWorkflowIntent["deadline"]>): boolean {
  if (deadline === "attention") return urgentDeadline(values);
  if (deadline === "expired") return values.includes("expired");
  if (deadline === "review") return values.some((value) => ["review_overdue", "review_soon", "review_invalid"].includes(value));
  return values.some((value) => ["review_missing", "review_invalid"].includes(value));
}

function plainMarkdown(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 280).replace(/[\\`*_{}\[\]()<>#!|~]/g, "\\$&");
}

function formatDate(value: string, language: ResponseLanguage): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(language === "en" ? "en-GB" : "cs-CZ", { dateStyle: "short", timeZone: "Europe/Prague" }).format(date)
    : language === "en" ? "not specified" : "neuveden";
}
