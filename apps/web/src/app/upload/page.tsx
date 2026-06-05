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
        title="Upload wizard"
        description="Prepare a new document version and queue ingestion without direct database, Qdrant or LLM runtime access."
      />
      <UploadWizard documents={documents} authorization={authorization} />
    </>
  );
}
