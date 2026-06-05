import { FilePlus2 } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { DocumentRegistry } from "@/features/documents/document-registry";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const clients = getServerApiClients();
  const context = getServerRequestContext();
  const [documents, authorization] = await Promise.all([
    clients.registry.listDocuments(context),
    clients.registry.getAuthorizationHints(context)
  ]);

  return (
    <>
      <PageHeader
        actions={
          authorization.can_update ? (
            <Link className="button button--primary" href="/documents/new">
              <FilePlus2 size={16} aria-hidden="true" />
              New draft
            </Link>
          ) : null
        }
        title="Document registry"
        description="Registry UI for controlled documents, classifications, workflow states and ownership metadata."
      />
      <DocumentRegistry documents={documents} authorization={authorization} />
    </>
  );
}
