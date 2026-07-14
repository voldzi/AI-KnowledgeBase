import { PageHeader } from "@/components/page-header";
import { WorkflowInbox } from "@/features/tasks/workflow-inbox";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";
import { ApiClientError, type AuditEvent, type RegistryWorkflowTask } from "@/lib/types";
import { listVisibleIngestionJobs } from "@/lib/ingestion/governed-operations";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/tasks");
  requirePageAccess(context, "knowledge_workspace");
  const documents = await clients.registry.listDocuments(context);
  const [jobs, auditEvents, registryTasks, authorization] = await Promise.all([
    listVisibleIngestionJobs(clients, documents, context),
    listVisibleAuditEvents(clients.registry.listAuditEvents(context)),
    listVisibleWorkflowTasks(clients.registry.listWorkflowTasks(context)),
    clients.registry.getAuthorizationHints(context)
  ]);

  return (
    <>
      <PageHeader
        title={{ cs: "Workflow úkoly", en: "Workflow tasks" }}
        description={{
          cs: "Organizační fronta pro revize dokumentů, governance kontroly, ingestion varování a auditní signály.",
          en: "Organizational queue for document reviews, governance checks, ingestion warnings and audit signals."
        }}
      />
      <WorkflowInbox
        documents={documents}
        jobs={jobs}
        auditEvents={auditEvents}
        registryTasks={registryTasks}
        authorization={authorization}
        nowIso={new Date().toISOString()}
      />
    </>
  );
}

async function listVisibleWorkflowTasks(request: Promise<RegistryWorkflowTask[]>) {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 403) {
      return undefined;
    }
    throw error;
  }
}

async function listVisibleAuditEvents(request: Promise<AuditEvent[]>) {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 403) {
      return [];
    }
    throw error;
  }
}
