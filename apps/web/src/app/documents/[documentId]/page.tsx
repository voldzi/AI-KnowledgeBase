import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { DocumentDetail } from "@/features/documents/document-detail";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { ApiClientError } from "@/lib/types";

export const dynamic = "force-dynamic";

interface DocumentDetailPageProps {
  params: Promise<{
    documentId: string;
  }>;
}

export default async function DocumentDetailPage({ params }: DocumentDetailPageProps) {
  const { documentId } = await params;
  const clients = getServerApiClients();
  const context = getServerRequestContext();

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
      clients.ingestion.listJobs(context),
      clients.registry.getAuthorizationHints(context),
      clients.registry.listWorkflowTasks(context, { includeResolved: true, documentId }).catch(() => []),
      clients.registry.listAuditEvents(context, { limit: 200 }).catch(() => [])
    ]);

    return (
      <>
        <PageHeader
          title={{ cs: "Detail dokumentu", en: "Document detail" }}
          description={{
            cs: "Metadata dokumentu, aktuální platnost, historie verzí a navázaný stav ingestion pipeline.",
            en: "Document metadata, current validity, version history and linked ingestion pipeline state."
          }}
        />
        <DocumentDetail
          document={document}
          versions={versions}
          jobs={jobs}
          authorization={authorization}
          assignments={assignments}
          workflowTasks={workflowTasks}
          auditEvents={auditEvents}
        />
      </>
    );
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}
