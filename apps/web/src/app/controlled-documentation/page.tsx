import { PageHeader } from "@/components/page-header";
import { ControlledDocumentationWorkbench } from "@/features/controlled-documentation/controlled-documentation-workbench";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";

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
  const [documents, packages, rules] = await Promise.all([
    clients.registry.listDocuments(context),
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
