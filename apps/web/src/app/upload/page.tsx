import { PageHeader } from "@/components/page-header";
import { UploadWizard } from "@/features/documents/upload-wizard";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";
import { redirect } from "next/navigation";

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
  if (!requestedDocumentId) {
    redirect("/documents");
  }
  const [documents, authorization] = await Promise.all([
    clients.registry.listDocuments(context),
    clients.registry.getAuthorizationHints(context)
  ]);
  const requestedDocument = requestedDocumentId
    ? documents.find((document) => document.document_id === requestedDocumentId)
    : null;
  if (!requestedDocument) {
    redirect("/documents");
  }
  const initialVersions = await clients.registry
    .listDocumentVersions(requestedDocument.document_id, context)
    .catch(() => []);

  return (
    <>
      <PageHeader
        title={{ cs: "Nahrání nové verze", en: "Upload a new version" }}
        description={{
          cs: `Nahrajte novou verzi dokumentu ${requestedDocument.title}. AKB soubor ověří, bezpečně uloží a spustí zpracování pro citace.`,
          en: `Upload a new version of ${requestedDocument.title}. AKB verifies and stores the file securely and starts citation processing.`
        }}
      />
      <UploadWizard
        document={requestedDocument}
        authorization={authorization}
        versions={initialVersions}
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
