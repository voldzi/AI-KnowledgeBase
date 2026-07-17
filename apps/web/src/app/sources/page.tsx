import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { PublicSourcesWorkbench } from "@/features/public-sources/public-sources-workbench";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";
import { PUBLIC_SOURCE_COLLECTIONS, publicSourceTargetTotal } from "@/lib/public-sources/catalog";

export const dynamic = "force-dynamic";

export default async function PublicSourcesPage() {
  const context = await getServerRequestContextForPath("/sources");
  requirePageAccess(context, "knowledge_workspace");
  const clients = getServerApiClients();
  const [authorization, documents] = await Promise.all([
    clients.registry.getAuthorizationHints(context),
    clients.registry.listDocuments(context, { tag: "official-public-reference" }),
  ]);
  if (!authorization.can_update || !authorization.can_ingest || !authorization.can_publish) {
    redirect("/documents");
  }
  const importedByCollection = Object.fromEntries(
    PUBLIC_SOURCE_COLLECTIONS.map((collection) => [
      collection.id,
      documents.filter((document) => document.metadata?.collection_id === collection.id).length,
    ]),
  );
  const validDocuments = documents.filter((document) => document.status === "valid").length;

  return (
    <>
      <PageHeader
        title={{ cs: "Veřejné zdroje", en: "Public sources" }}
        description={{
          cs: "Schválené kolekce oficiálních veřejných dokumentů. AKB kontroluje původ, změny obsahu, verze a automaticky připravuje citace.",
          en: "Approved collections of official public documents. AKB verifies origin, content changes, versions and prepares citations automatically.",
        }}
      />
      <PublicSourcesWorkbench
        collections={PUBLIC_SOURCE_COLLECTIONS.map((collection) => ({ ...collection }))}
        importedByCollection={importedByCollection}
        importedTotal={documents.length}
        validTotal={validDocuments}
        targetTotal={publicSourceTargetTotal()}
      />
    </>
  );
}
