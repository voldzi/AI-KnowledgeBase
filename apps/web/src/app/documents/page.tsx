import { PageHeader } from "@/components/page-header";
import { DocumentRegistry } from "@/features/documents/document-registry";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/documents");
  requirePageAccess(context, "knowledge_workspace");
  const [documents, authorization] = await Promise.all([
    clients.registry.listDocuments(context),
    clients.registry.getAuthorizationHints(context)
  ]);

  return (
    <>
      <PageHeader
        title={{ cs: "Registr dokumentů", en: "Document registry" }}
        description={{
          cs: "Rozhraní registru pro řízené dokumenty, klasifikace, workflow stavy a vlastnická metadata.",
          en: "Registry UI for controlled documents, classifications, workflow states and ownership metadata."
        }}
      />
      <DocumentRegistry documents={documents} authorization={authorization} />
    </>
  );
}
