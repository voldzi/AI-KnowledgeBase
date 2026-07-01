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
        title={{ cs: "Založit dokument a první verzi", en: "Create document and first version" }}
        description={{
          cs: "Vyplňte metadata, přidejte originální soubor a AKB v jednom kroku založí dokument, verzi 1.0 a spustí zpracování pro citace.",
          en: "Enter metadata, attach the original file and AKB creates the document, version 1.0 and citation processing in one flow."
        }}
      />
      <NewDocumentForm authorization={authorization} />
    </>
  );
}
