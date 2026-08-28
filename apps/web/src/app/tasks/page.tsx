import { WorkflowWorkspace } from "@/features/tasks/workflow-workspace";
import { workflowQuery } from "@/features/tasks/workflow-query";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { canReadTeamTasks, constrainAuthorizationHintsToContext } from "@/lib/auth/authorization";
import { requireWorkspaceRouteAccess } from "@/lib/auth/server-route-guard";
import { ApiClientError, type AuthorizationHint } from "@/lib/types";

export const dynamic = "force-dynamic";

const noActions: AuthorizationHint = {
  can_read: true, can_update: false, can_ingest: false,
  can_publish: false, can_read_audit: false, can_manage_admin: false,
};

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/tasks");
  requireWorkspaceRouteAccess(context, "/tasks");
  const capabilityMode = Boolean(context.capabilities?.length || context.roles?.some((role) => role === "stratos_user" || role === "stratos_admin"));
  // These are display hints from the freshly verified projection, not action grants.
  // Every decision still requires the task's server-provided allowed_actions.
  const authorization = capabilityMode
    ? { value: constrainAuthorizationHintsToContext(context, {
      can_read: true, can_update: true, can_ingest: true,
      can_publish: true, can_read_audit: true, can_manage_admin: true,
    }), available: true }
    : await available(clients.registry.getAuthorizationHints(context), noActions);
  const canReadTeam = canReadTeamTasks(context);
  const search = await searchParams;
  const query = workflowQuery(search, canReadTeam);
  const empty = { items: [], total: 0, limit: query.tasks.limit!, offset: query.tasks.offset! };
  const documents = query.view === "documents"
    ? await available(clients.registry.listWorkflowDocumentPage(context, query.documents), empty) : null;
  const tasks = query.view !== "documents"
    ? await available(clients.registry.listWorkflowTaskPage(context, query.tasks), empty) : null;
  const result = documents ?? tasks!;
  return <WorkflowWorkspace key={query.view}
    view={query.view} canReadTeam={canReadTeam}
    documents={documents?.value.items ?? []} tasks={tasks?.value.items ?? []}
    authorization={authorization.value} nowIso={new Date().toISOString()}
    total={result.available ? result.value.total : null} limit={result.value.limit} offset={result.value.offset}
    unavailable={!result.available} actionsUnavailable={!authorization.available}
  />;
}

async function available<T>(request: Promise<T>, fallback: T): Promise<{ value: T; available: boolean }> {
  try {
    return { value: await request, available: true };
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 403 || error.status >= 500)) {
      return { value: fallback, available: false };
    }
    throw error;
  }
}
