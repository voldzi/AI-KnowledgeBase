import { PageHeader } from "@/components/page-header";
import { DocumentRegistry } from "@/features/documents/document-registry";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requireWorkspaceRouteAccess } from "@/lib/auth/server-route-guard";
import { buildReturnTarget } from "@/lib/navigation/document-navigation";
import type { Classification, DocumentStatus, DocumentType } from "@/lib/types";

export const dynamic = "force-dynamic";

interface DocumentsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const documentStatuses: DocumentStatus[] = [
  "draft",
  "review",
  "approved",
  "valid",
  "superseded",
  "archived",
  "cancelled",
];
const classifications: Classification[] = [
  "public",
  "internal",
  "restricted",
  "confidential",
];

export default async function DocumentsPage({ searchParams }: DocumentsPageProps) {
  const clients = getServerApiClients();
  const resolvedSearchParams = await searchParams;
  const context = await getServerRequestContextForPath(buildReturnTarget("/documents", resolvedSearchParams));
  requireWorkspaceRouteAccess(context, "/documents");
  const view = firstValue(resolvedSearchParams?.view);
  const statuses = selectedValues(resolvedSearchParams?.status, documentStatuses);
  const selectedClassifications = selectedValues(
    resolvedSearchParams?.classification,
    classifications,
  );
  const [documents, authorization] = await Promise.all([
    clients.registry.listDocumentPage(context, {
      query: firstValue(resolvedSearchParams?.q),
      statuses: statuses.length > 0 ? statuses : viewStatuses(view),
      classifications: selectedClassifications.length > 0
        ? selectedClassifications
        : viewClassifications(view),
      documentTypes: selectedValues<DocumentType>(resolvedSearchParams?.type),
      limit: 50,
      offset: 0,
    }),
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
      <DocumentRegistry initialPage={documents} authorization={authorization} />
    </>
  );
}

function firstValue(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = candidate?.trim();
  return normalized || undefined;
}

function selectedValues<Value extends string>(
  value: string | string[] | undefined,
  allowed?: readonly Value[],
): Value[] {
  const candidates = (Array.isArray(value) ? value : value ? [value] : [])
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const allowedValues = allowed ? new Set<string>(allowed) : null;
  return [...new Set(candidates.filter((candidate) => (
    !allowedValues || allowedValues.has(candidate)
  )))] as Value[];
}

function viewStatuses(view: string | undefined): DocumentStatus[] {
  if (view === "review") return ["draft", "review"];
  if (view === "valid") return ["valid"];
  if (view === "archive") return ["archived", "superseded", "cancelled"];
  return [];
}

function viewClassifications(view: string | undefined): Classification[] {
  return view === "restricted" ? ["restricted", "confidential"] : [];
}
