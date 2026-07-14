import { notFound } from "next/navigation";

import { DocumentDetail } from "@/features/documents/document-detail";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import {
  ApiClientError,
  type AuditEvent,
  type RegistryWorkflowTask,
} from "@/lib/types";
import { listVisibleIngestionJobs } from "@/lib/ingestion/governed-operations";

export const dynamic = "force-dynamic";

interface EmbeddedDocumentPageProps {
  params: Promise<{
    documentId: string;
  }>;
}

export default async function EmbeddedDocumentPage({ params }: EmbeddedDocumentPageProps) {
  const { documentId } = await params;
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath(`/embed/documents/${documentId}`);

  try {
    const [document, assignments, versions, jobs, authorization, workflowTasks, auditEvents] = await Promise.all([
      clients.registry.getDocument(documentId, context),
      clients.registry.listDocumentAssignments(documentId, context).catch((error) => {
        if (error instanceof ApiClientError && error.status === 404) {
          return [];
        }
        throw error;
      }),
      clients.registry.listDocumentVersions(documentId, context),
      listVisibleIngestionJobs(clients, [{ document_id: documentId }], context),
      clients.registry.getAuthorizationHints(context),
      listVisibleWorkflowTasks(
        clients.registry.listWorkflowTasks(context, { includeResolved: true, documentId }),
      ),
      listVisibleAuditEvents(clients.registry.listAuditEvents(context, { limit: 200 }))
    ]);

    return (
      <main className="akb-embedded-document">
        <DocumentDetail
          document={document}
          versions={versions}
          jobs={jobs}
          authorization={authorization}
          assignments={assignments}
          workflowTasks={workflowTasks}
          auditEvents={auditEvents}
        />
      </main>
    );
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}

async function listVisibleWorkflowTasks(request: Promise<RegistryWorkflowTask[]>) {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 403) return [];
    throw error;
  }
}

async function listVisibleAuditEvents(request: Promise<AuditEvent[]>) {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 403) return [];
    throw error;
  }
}
