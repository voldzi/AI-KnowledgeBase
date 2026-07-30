import { PageHeader } from "@/components/page-header";
import { WorkflowInbox } from "@/features/tasks/workflow-inbox";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";
import { ApiClientError, type AuditEvent, type RegistryWorkflowTask } from "@/lib/types";
import type { AuthorizationHint, IngestionJob } from "@/lib/types";
import { listVisibleIngestionJobs } from "@/lib/ingestion/governed-operations";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/tasks");
  requirePageAccess(context, "knowledge_workspace");
  const documents = await clients.registry.listDocuments(context);
  const [jobs, auditEvents, registryTasks, authorization] = await Promise.all([
    listAvailableIngestionJobs(listVisibleIngestionJobs(clients, documents, context)),
    listVisibleAuditEvents(clients.registry.listAuditEvents(context)),
    listVisibleWorkflowTasks(clients.registry.listWorkflowTasks(context)),
    availableAuthorization(clients.registry.getAuthorizationHints(context))
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
    if (error instanceof ApiClientError && [403, 503].includes(error.status)) {
      return undefined;
    }
    throw error;
  }
}

async function listVisibleAuditEvents(request: Promise<AuditEvent[]>) {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiClientError && [403, 503].includes(error.status)) {
      return [];
    }
    throw error;
  }
}

async function listAvailableIngestionJobs(
  request: Promise<IngestionJob[]>,
): Promise<IngestionJob[]> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 503) {
      return [];
    }
    throw error;
  }
}

async function availableAuthorization(
  request: Promise<AuthorizationHint>,
): Promise<AuthorizationHint> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 503) {
      return {
        can_read: true,
        can_update: false,
        can_ingest: false,
        can_publish: false,
        can_read_audit: false,
        can_manage_admin: false,
      };
    }
    throw error;
  }
}
