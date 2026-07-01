import { PageHeader } from "@/components/page-header";
import { UploadWizard } from "@/features/documents/upload-wizard";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";

export const dynamic = "force-dynamic";

interface UploadPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function UploadPage({ searchParams }: UploadPageProps) {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/upload");
  requirePageAccess(context, "knowledge_workspace");
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const requestedDocumentId = firstSearchParamValue(resolvedSearchParams.document_id);
  const [documents, authorization] = await Promise.all([
    clients.registry.listDocuments(context),
    clients.registry.getAuthorizationHints(context)
  ]);
  const requestedDocument = requestedDocumentId
    ? documents.find((document) => document.document_id === requestedDocumentId)
    : null;
  const initialVersions = requestedDocument
    ? await clients.registry
      .listDocumentVersions(requestedDocument.document_id, context)
      .catch(() => [])
    : [];
  const versionsByDocumentId = requestedDocument
    ? { [requestedDocument.document_id]: initialVersions }
    : {};

  return (
    <>
      <PageHeader
        title={{ cs: "Nahrání nové verze", en: "Upload a new version" }}
        description={{
          cs: "Vyberte dokument a originální soubor. AKB soubor ověří, bezpečně uloží, založí verzi a spustí zpracování pro citace.",
          en: "Choose a document and original file. AKB verifies and stores the file securely, creates a version and starts citation processing."
        }}
      />
      <UploadWizard
        documents={documents}
        authorization={authorization}
        initialDocumentId={requestedDocumentId}
        versionsByDocumentId={versionsByDocumentId}
      />
    </>
  );
}

function firstSearchParamValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }
  return value?.trim() || null;
}
