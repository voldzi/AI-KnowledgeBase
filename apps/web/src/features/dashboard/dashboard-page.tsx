import { PageHeader } from "@/components/page-header";
import {
  getServerApiClients,
  getServerRequestContextForPath,
} from "@/lib/api/server";
import { redirectEmployeeChatOnly } from "@/lib/auth/server-route-guard";
import {
  ApiClientError,
  type AuditEvent,
  type AuthorizationHint,
  type RegistryWorkflowTask,
} from "@/lib/types";
import { listVisibleIngestionJobs } from "@/lib/ingestion/governed-operations";

import { DashboardOverview } from "./dashboard-overview";

export const dynamic = "force-dynamic";

interface DashboardPageProps {
  returnTo?: string;
}

export async function DashboardPage({
  returnTo = "/dashboard",
}: DashboardPageProps = {}) {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath(returnTo);
  redirectEmployeeChatOnly(context);
  const documents = await clients.registry.listDocuments(context, { recentLimit: 12 });
  const [jobsResult, auditEventsResult, registryTasksResult, authorizationResult] = await Promise.allSettled([
    listVisibleIngestionJobs(clients, documents, context),
    listVisibleAuditEvents(clients.registry.listAuditEvents(context)),
    listVisibleWorkflowTasks(clients.registry.listWorkflowTasks(context)),
    clients.registry.getAuthorizationHints(context)
  ]);
  const unavailableSources = [
    jobsResult.status === "rejected" ? "processing" : null,
    auditEventsResult.status === "rejected" ? "audit" : null,
    registryTasksResult.status === "rejected" ? "tasks" : null,
    authorizationResult.status === "rejected" ? "authorization" : null,
  ].filter((source): source is "processing" | "audit" | "tasks" | "authorization" => source !== null);

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
        jobs={jobsResult.status === "fulfilled" ? jobsResult.value : []}
        auditEvents={auditEventsResult.status === "fulfilled" ? auditEventsResult.value : []}
        registryTasks={registryTasksResult.status === "fulfilled" ? registryTasksResult.value : undefined}
        authorization={authorizationResult.status === "fulfilled" ? authorizationResult.value : denyAllAuthorization}
        unavailableSources={unavailableSources}
        nowIso={new Date().toISOString()}
      />
    </>
  );
}

const denyAllAuthorization: AuthorizationHint = {
  can_read: false,
  can_update: false,
  can_ingest: false,
  can_publish: false,
  can_read_audit: false,
  can_manage_admin: false,
};

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
