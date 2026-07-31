import { PageHeader } from "@/components/page-header";
import { ControlledDocumentationWorkbench } from "@/features/controlled-documentation/controlled-documentation-workbench";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";

export const dynamic = "force-dynamic";

export default async function ControlledDocumentationPage() {
  const clients = getServerApiClients();
  const context =
    await getServerRequestContextForPath("/controlled-documentation");
  requirePageAccess(context, "knowledge_workspace");
  const authorization = await clients.registry.getAuthorizationHints(context);
  const [documents, packages, rules] = await Promise.all([
    clients.registry.listDocuments(context),
    clients.registry.listControlledDocumentPackages(context, {
      domain: "public_procurement",
      includeInactive: authorization.can_update,
    }),
    clients.registry.listControlledRules("public_procurement", context, {
      approvedOnly: false,
      includeInactive: authorization.can_update,
    }),
  ]);

  return (
    <>
      <PageHeader
        title={{ cs: "Řízené předpisy", en: "Controlled documentation" }}
        description={{
          cs: "Jedno místo pro zákony, směrnice, přílohy, historii a ověřená pravidla použitelná dalšími aplikacemi.",
          en: "One place for laws, directives, attachments, history and verified rules consumable by other applications.",
        }}
      />
      <ControlledDocumentationWorkbench
        initialPackages={packages}
        initialRules={rules}
        documents={documents}
        authorization={authorization}
      />
    </>
  );
}
