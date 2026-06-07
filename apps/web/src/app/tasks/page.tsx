import { PageHeader } from "@/components/page-header";
import { WorkflowInbox } from "@/features/tasks/workflow-inbox";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { ApiClientError, type AuditEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContext();
  const [documents, jobs, auditEvents, registryTasks, authorization] = await Promise.all([
    clients.registry.listDocuments(context),
    clients.ingestion.listJobs(context),
    listVisibleAuditEvents(clients.registry.listAuditEvents(context)),
    clients.registry.listWorkflowTasks(context).catch(() => undefined),
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
