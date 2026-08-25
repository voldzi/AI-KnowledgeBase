import { PageHeader } from "@/components/page-header";
import { ControlledDocumentationWorkbench } from "@/features/controlled-documentation/controlled-documentation-workbench";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";
import type { ControlledDocumentPackageList, Document } from "@/lib/types";

export const dynamic = "force-dynamic";

interface ControlledDocumentationPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ControlledDocumentationPage({ searchParams }: ControlledDocumentationPageProps) {
  const resolvedSearchParams = await searchParams;
  const domain = controlledDomain(resolvedSearchParams.domain);
  const validOn = controlledDate(resolvedSearchParams.valid_on);
  const clients = getServerApiClients();
  const context =
    await getServerRequestContextForPath(controlledRequestPath(domain, validOn));
  requirePageAccess(context, "knowledge_workspace");
  const authorization = await clients.registry.getAuthorizationHints(context);
  const [packages, rules] = await Promise.all([
    clients.registry.listControlledDocumentPackages(context, {
      domain,
      validOn,
      includeInactive: authorization.can_update,
    }),
    clients.registry.listControlledRules(domain, context, {
      validOn,
      approvedOnly: false,
      includeInactive: authorization.can_update,
    }),
  ]);
  const documents = await loadReferencedDocuments(packages, clients.registry, context);

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

async function loadReferencedDocuments(
  packages: ControlledDocumentPackageList,
  registry: ReturnType<typeof getServerApiClients>["registry"],
  context: Awaited<ReturnType<typeof getServerRequestContextForPath>>,
): Promise<Document[]> {
  // Package labels already carry the human title. Resolve only legacy members
  // without a label and keep the initial request bounded.
  const documentIds = [...new Set(
    packages.items.flatMap((item) => item.members
      .filter((member) => !member.label)
      .map((member) => member.document_id)),
  )].slice(0, 50);
  const results = await Promise.allSettled(
    documentIds.map((documentId) => registry.getDocument(documentId, context)),
  );
  return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

function controlledDomain(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[a-z][a-z0-9_]{0,63}$/.test(candidate)
    ? candidate
    : "public_procurement";
}

function controlledDate(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return undefined;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== candidate
    ? undefined
    : candidate;
}

function controlledRequestPath(domain: string, validOn?: string): string {
  const params = new URLSearchParams({ domain });
  if (validOn) params.set("valid_on", validOn);
  return `/controlled-documentation?${params.toString()}`;
}
