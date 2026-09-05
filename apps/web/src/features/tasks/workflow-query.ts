import type { WorkflowDocumentListOptions, WorkflowTaskListOptions } from "@/lib/types";

export type WorkflowView = "approvals" | "mine" | "documents" | "team";
export const WORKFLOW_PAGE_SIZE = 25;

export function workflowQuery(search: Record<string, string | string[] | undefined>, canReadTeam: boolean) {
  const value = (key: string) => typeof search[key] === "string" ? search[key] as string : undefined;
  const member = <T extends string>(key: string, allowed: readonly T[]): T | undefined => {
    const candidate = value(key);
    return allowed.find((item) => item === candidate);
  };
  const requestedView = member("view", ["approvals", "mine", "documents", "team"] as const);
  const view: WorkflowView = requestedView && (requestedView !== "team" || canReadTeam) ? requestedView : "mine";
  const rawPage = value("page") ?? "1";
  const page = /^\d{1,5}$/.test(rawPage) ? Math.max(1, Math.min(10000, Number(rawPage))) : 1;
  const paging = { limit: WORKFLOW_PAGE_SIZE, offset: (page - 1) * WORKFLOW_PAGE_SIZE };
  const tasks: WorkflowTaskListOptions = {
    ...paging, assignedToMe: view !== "team", query: value("q")?.slice(0, 200),
    kind: view === "approvals" ? "review" : member("kind", ["review", "draft", "ingestion", "governance", "audit"] as const),
    status: member("status", ["open", "waiting", "blocked"] as const),
    priority: member("priority", ["critical", "high", "medium", "low"] as const),
  };
  const documents: WorkflowDocumentListOptions = {
    ...paging, query: value("document_q")?.slice(0, 200),
    assignment: member("assignment", ["managed", "approver"] as const),
    versionStatus: member("version_status", ["draft", "review", "approved", "valid", "superseded", "archived", "cancelled"] as const),
    deadline: member("deadline", ["attention", "expired", "review", "missing"] as const),
  };
  return { view, page, tasks, documents };
}
