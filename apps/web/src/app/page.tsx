import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { DashboardOverview } from "@/features/dashboard/dashboard-overview";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const clients = getServerApiClients();
  const context = getServerRequestContext();
  if (_shouldUseEmployeeAssistant(context.roles ?? [])) {
    redirect("/assistant");
  }
  const [documents, jobs, auditEvents, registryTasks, authorization] = await Promise.all([
    clients.registry.listDocuments(context),
    clients.ingestion.listJobs(context),
    clients.registry.listAuditEvents(context),
    clients.registry.listWorkflowTasks(context).catch(() => undefined),
    clients.registry.getAuthorizationHints(context)
  ]);

  return (
    <>
      <PageHeader
        title={{ cs: "Provozní přehled", en: "Operational dashboard" }}
        description={{
          cs: "Řízená dokumentace, ingestion úlohy, připravenost RAG s citacemi a auditní signály v jednom pracovním prostoru.",
          en: "Controlled documentation, ingestion jobs, citation-backed RAG readiness and audit signals in one workspace."
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

function _shouldUseEmployeeAssistant(roles: string[]) {
  const normalized = new Set(roles.map((role) => role.trim().toLowerCase()).filter(Boolean));
  const adminRoles = new Set([
    "admin",
    "global_admin",
    "knowledge_admin",
    "document_manager",
    "it_manager",
    "auditor"
  ]);
  return normalized.size > 0 && [...normalized].every((role) => !adminRoles.has(role));
}
