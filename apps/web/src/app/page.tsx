import { PageHeader } from "@/components/page-header";
import { DashboardOverview } from "@/features/dashboard/dashboard-overview";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { redirectEmployeeChatOnly } from "@/lib/auth/server-route-guard";
import { ApiClientError, type AuditEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContext();
  redirectEmployeeChatOnly(context);
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
        title={{ cs: "Provozní přehled", en: "Operational dashboard" }}
        description={{
          cs: "Přehled dokumentů, zpracování, otevřených úkolů, citací a auditních signálů v jednom pracovním prostoru.",
          en: "Documents, processing, open tasks, citations and audit signals in one workspace."
        }}
      />
      <DashboardOverview
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
