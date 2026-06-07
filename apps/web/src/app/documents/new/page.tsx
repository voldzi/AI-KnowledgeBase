import { PageHeader } from "@/components/page-header";
import { NewDocumentForm } from "@/features/documents/new-document-form";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContext();
  const authorization = await clients.registry.getAuthorizationHints(context);

  return (
    <>
      <PageHeader
        title={{ cs: "Nový koncept dokumentu", en: "New document draft" }}
        description={{
          cs: "Nejprve vytvoří metadata v registru. Nahrání a ingestion probíhá přes podepsané URI a Ingestion Service.",
          en: "Create the registry metadata first. Upload and ingestion happen through a signed URI and the Ingestion Service."
        }}
      />
      <NewDocumentForm authorization={authorization} />
    </>
  );
}
