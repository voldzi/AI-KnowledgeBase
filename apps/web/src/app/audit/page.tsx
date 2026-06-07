import { PageHeader } from "@/components/page-header";
import { AuditViewer } from "@/features/audit/audit-viewer";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { ApiClientError, type AuditEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContext();
  const [events, authorization] = await Promise.all([
    listVisibleAuditEvents(clients.registry.listAuditEvents(context)),
    clients.registry.getAuthorizationHints(context)
  ]);

  return (
    <>
      <PageHeader
        title={{ cs: "Auditní prohlížeč", en: "Audit viewer" }}
        description={{
          cs: "Kontrola auditních událostí na úrovni metadat bez ukládání obsahu dokumentů, promptů, tokenů nebo plných odpovědí do technických logů.",
          en: "Review metadata-level audit activity without leaking document content, prompts, tokens or full answers into technical logs."
        }}
      />
      <AuditViewer events={events} authorization={authorization} />
    </>
  );
}

async function listVisibleAuditEvents(request: Promise<AuditEvent[]>) {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 403) {
      return [];
    }
    throw error;
  }
}
