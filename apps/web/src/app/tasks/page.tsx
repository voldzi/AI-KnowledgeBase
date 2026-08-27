import { WorkflowWorkspace } from "@/features/tasks/workflow-workspace";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requireWorkspaceRouteAccess } from "@/lib/auth/server-route-guard";
import { ApiClientError, type AuthorizationHint, type RegistryWorkflowTask } from "@/lib/types";

export const dynamic = "force-dynamic";

const noActions: AuthorizationHint = {
  can_read: true, can_update: false, can_ingest: false,
  can_publish: false, can_read_audit: false, can_manage_admin: false,
};

export default async function TasksPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/tasks");
  requireWorkspaceRouteAccess(context, "/tasks");
  const [authorization, documents, tasks] = await Promise.all([
    available(clients.registry.getAuthorizationHints(context), noActions),
    available(clients.registry.listWorkflowDocuments(context), []),
    available(clients.registry.listWorkflowTasks(context, { assignedToMe: true }), []),
  ]);
  const team = authorization.value.can_manage_admin
    ? await available(clients.registry.listWorkflowTasks(context), [])
    : { value: [] as RegistryWorkflowTask[], available: true };

  return <WorkflowWorkspace
    documents={documents.value} tasks={tasks.value} teamTasks={team.value}
    authorization={authorization.value} nowIso={new Date().toISOString()}
    unavailable={[
      ...(!authorization.available ? ["authorization"] : []),
      ...(!documents.available ? ["documents"] : []),
      ...(!tasks.available ? ["tasks"] : []),
      ...(!team.available ? ["team"] : []),
    ]}
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
