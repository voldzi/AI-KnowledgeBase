import { PageHeader } from "@/components/page-header";
import { DashboardOverview } from "@/features/dashboard/dashboard-overview";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const clients = getServerApiClients();
  const context = getServerRequestContext();
  const [documents, jobs, auditEvents, authorization] = await Promise.all([
    clients.registry.listDocuments(context),
    clients.ingestion.listJobs(context),
    clients.registry.listAuditEvents(context),
    clients.registry.getAuthorizationHints(context)
  ]);

  return (
    <>
      <PageHeader
        title="Operational dashboard"
        description="Controlled documentation, ingestion jobs, citation-backed RAG readiness and audit signals in one workspace."
      />
      <DashboardOverview documents={documents} jobs={jobs} auditEvents={auditEvents} authorization={authorization} />
    </>
  );
}
