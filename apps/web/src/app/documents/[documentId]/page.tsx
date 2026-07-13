import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { DocumentDetail } from "@/features/documents/document-detail";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";
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
  const context = await getServerRequestContextForPath(`/documents/${documentId}`);
  requirePageAccess(context, "knowledge_workspace");

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
    const currentVersion = versions.find((version) => version.status === "valid") ?? versions[0];
    const publication = currentVersion
      ? await clients.registry
          .getDocumentPublication(documentId, currentVersion.document_version_id, context)
          .catch((error) => {
            if (error instanceof ApiClientError && error.status === 404) {
              return null;
            }
            if (error instanceof ApiClientError && error.status === 403) {
              return undefined;
            }
            throw error;
          })
      : undefined;

    return (
      <>
        <PageHeader
          title={{ cs: "Detail dokumentu", en: "Document detail" }}
          description={{
            cs: "Metadata dokumentu, aktuální platnost, historie verzí, zpracování, citace a schvalovací kroky.",
            en: "Document metadata, current validity, version history, processing, citations and approval steps."
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
          publication={publication}
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
