import { PageHeader } from "@/components/page-header";
import { UploadWizard } from "@/features/documents/upload-wizard";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const clients = getServerApiClients();
  const context = getServerRequestContext();
  const [documents, authorization] = await Promise.all([
    clients.registry.listDocuments(context),
    clients.registry.getAuthorizationHints(context)
  ]);

  return (
    <>
      <PageHeader
        title={{ cs: "Průvodce nahráním", en: "Upload wizard" }}
        description={{
          cs: "Ověří soubor, vytvoří podepsanou upload session, uloží zdrojový objekt a zařadí ingestion bez přímého přístupu k databázi, Qdrantu nebo LLM runtime.",
          en: "Validate a file, create a signed upload session, store the source object and queue ingestion without direct database, Qdrant or LLM runtime access."
        }}
      />
      <UploadWizard documents={documents} authorization={authorization} />
    </>
  );
}
