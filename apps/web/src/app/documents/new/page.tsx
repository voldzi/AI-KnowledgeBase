import { PageHeader } from "@/components/page-header";
import { NewDocumentForm } from "@/features/documents/new-document-form";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage() {
  const clients = getServerApiClients();
  const context = getServerRequestContext();
  const authorization = await clients.registry.getAuthorizationHints(context);

  return (
    <>
      <PageHeader
        title="New document draft"
        description="Create the registry metadata first. Upload and ingestion happen through a signed URI and the Ingestion Service."
      />
      <NewDocumentForm authorization={authorization} />
    </>
  );
}
