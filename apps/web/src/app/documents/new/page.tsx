import { PageHeader } from "@/components/page-header";
import { NewDocumentForm } from "@/features/documents/new-document-form";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/documents/new");
  requirePageAccess(context, "knowledge_workspace");
  const authorization = await clients.registry.getAuthorizationHints(context);

  return (
    <>
      <PageHeader
        title={{ cs: "Nový koncept dokumentu", en: "New document draft" }}
        description={{
          cs: "Nejdřív založte srozumitelná metadata. Potom nahrajte originální soubor jako první verzi a předejte dokument ke kontrole.",
          en: "Create clear metadata first. Then upload the original file as the first version and send the document for review."
        }}
      />
      <NewDocumentForm authorization={authorization} />
    </>
  );
}
