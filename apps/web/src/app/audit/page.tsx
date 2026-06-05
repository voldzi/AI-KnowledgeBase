import { PageHeader } from "@/components/page-header";
import { AuditViewer } from "@/features/audit/audit-viewer";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const clients = getServerApiClients();
  const context = getServerRequestContext();
  const [events, authorization] = await Promise.all([
    clients.registry.listAuditEvents(context),
    clients.registry.getAuthorizationHints(context)
  ]);

  return (
    <>
      <PageHeader
        title="Audit viewer"
        description="Review metadata-level audit activity without leaking document content, prompts, tokens or full answers into technical logs."
      />
      <AuditViewer events={events} authorization={authorization} />
    </>
  );
}
