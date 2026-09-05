import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { DocumentDetail } from "@/features/documents/document-detail";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requireWorkspaceRouteAccess } from "@/lib/auth/server-route-guard";
import { canReviewControlledDocumentation, controlledDocumentationDomain } from "@/lib/controlled-documentation/contract";
import { selectedDocumentVersion } from "@/lib/documents/review-version";
import {
  ApiClientError,
  type ControlledDocumentPackage,
  type ControlledRule,
} from "@/lib/types";
import { listVisibleIngestionJobs } from "@/lib/ingestion/governed-operations";

export const dynamic = "force-dynamic";

interface DocumentDetailPageProps {
  params: Promise<{
    documentId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DocumentDetailPage({ params, searchParams }: DocumentDetailPageProps) {
  const [{ documentId }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const clients = getServerApiClients();
  const requestPath = documentDetailRequestPath(documentId, resolvedSearchParams);
  const context = await getServerRequestContextForPath(requestPath);
  requireWorkspaceRouteAccess(context, "/documents");

  try {
    const [document, authorization] = await Promise.all([
      clients.registry.getDocument(documentId, context),
      clients.registry.getAuthorizationHints(context),
    ]);
    const controlledDomain = controlledDocumentationDomain(document);
    const [assignments, versions, jobsResult, workflowResult, auditResult, controlledContext] = await Promise.all([
      clients.registry.listDocumentAssignments(documentId, context).catch((error) => {
        if (error instanceof ApiClientError && error.status === 404) {
          return [];
        }
        throw error;
      }),
      clients.registry.listDocumentVersions(documentId, context),
      optionalSection(listVisibleIngestionJobs(clients, [{ document_id: documentId }], context)),
      optionalSection(
        clients.registry.listWorkflowTasks(context, { includeResolved: true, documentId }),
      ),
      authorization.can_read_audit
        ? optionalSection(clients.registry.listAuditEvents(context, { limit: 200 }))
        : Promise.resolve({ items: [], available: false, failed: false }),
      controlledDomain
        ? listControlledDocumentContext(clients, context, controlledDomain, documentId, authorization)
        : Promise.resolve({
            packages: [] as ControlledDocumentPackage[],
            rules: [] as ControlledRule[],
            available: true,
          }),
    ]);
    const requestedVersion = resolvedSearchParams.version;
    if (Array.isArray(requestedVersion)) notFound();
    const currentVersion = selectedDocumentVersion(versions, requestedVersion);
    if (requestedVersion && !currentVersion) notFound();
    const unavailableSections = [
      ...(jobsResult.failed ? ["processing"] : []),
      ...(workflowResult.failed ? ["workflow"] : []),
      ...(auditResult.failed ? ["audit"] : []),
    ];
    const publication = currentVersion
      ? await clients.registry
          .getDocumentPublication(documentId, currentVersion.document_version_id, context)
          .catch((error) => {
            if (error instanceof ApiClientError && error.status === 404) {
              return null;
            }
            if (error instanceof ApiClientError && error.status === 403) {
              return undefined;
            }
            throw error;
          })
      : undefined;

    return (
      <>
        <PageHeader
          title={{ cs: "Detail dokumentu", en: "Document detail" }}
          description={{
            cs: "Metadata dokumentu, aktuální platnost, historie verzí, zpracování, citace a schvalovací kroky.",
            en: "Document metadata, current validity, version history, processing, citations and approval steps."
          }}
        />
        <DocumentDetail
          key={`${documentId}:${currentVersion?.document_version_id ?? "none"}`}
          document={document}
          versions={versions}
          jobs={jobsResult.items}
          authorization={authorization}
          assignments={assignments}
          workflowTasks={workflowResult.items}
          workflowAvailable={workflowResult.available}
          auditEvents={auditResult.items}
          unavailableSections={unavailableSections}
          publication={publication}
          controlledDomain={controlledDomain}
          controlledPackages={controlledContext.packages}
          controlledRules={controlledContext.rules}
          controlledDataAvailable={controlledContext.available}
        />
      </>
    );
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}

function documentDetailRequestPath(
  documentId: string,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
    } else if (value !== undefined) {
      query.set(key, value);
    }
  }
  const serialized = query.toString();
  return `/documents/${encodeURIComponent(documentId)}${serialized ? `?${serialized}` : ""}`;
}

async function listControlledDocumentContext(
  clients: ReturnType<typeof getServerApiClients>,
  context: Awaited<ReturnType<typeof getServerRequestContextForPath>>,
  domain: string,
  documentId: string,
  authorization: { can_update: boolean; can_publish: boolean },
) {
  try {
    const [packages, rules] = await Promise.all([
      clients.registry.listControlledDocumentPackages(context, {
        domain,
        includeInactive: authorization.can_update,
      }),
      clients.registry.listControlledRules(domain, context, {
        approvedOnly: !canReviewControlledDocumentation(authorization),
      }),
    ]);
    const relatedPackages = packages.items.filter(
      (item) =>
        item.primary_document_id === documentId ||
        item.members.some((member) => member.document_id === documentId),
    );
    const packageIds = new Set(relatedPackages.map((item) => item.package_id));
    return {
      packages: relatedPackages,
      rules: rules.rules.filter(
        (rule) =>
          packageIds.has(rule.package_id) ||
          rule.proposal.citation.document_id === documentId,
      ),
      available: true,
    };
  } catch (error) {
    if (error instanceof ApiClientError) {
      return {
        packages: [] as ControlledDocumentPackage[],
        rules: [] as ControlledRule[],
        available: false,
      };
    }
    throw error;
  }
}

async function optionalSection<T>(request: Promise<T[]>) {
  try {
    return { items: await request, available: true, failed: false };
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 403 || error.status >= 500)) {
      return { items: [] as T[], available: false, failed: error.status >= 500 };
    }
    throw error;
  }
}
