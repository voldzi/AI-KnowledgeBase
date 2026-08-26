import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { DocumentDetail } from "@/features/documents/document-detail";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requireWorkspaceRouteAccess } from "@/lib/auth/server-route-guard";
import { controlledDocumentationDomain } from "@/lib/controlled-documentation/contract";
import {
  ApiClientError,
  type AuditEvent,
  type ControlledDocumentPackage,
  type ControlledRule,
  type RegistryWorkflowTask,
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
    const document = await clients.registry.getDocument(documentId, context);
    const controlledDomain = controlledDocumentationDomain(document);
    const [assignments, versions, jobs, authorization, workflowTasks, auditEvents, controlledContext] = await Promise.all([
      clients.registry.listDocumentAssignments(documentId, context).catch((error) => {
        if (error instanceof ApiClientError && error.status === 404) {
          return [];
        }
        throw error;
      }),
      clients.registry.listDocumentVersions(documentId, context),
      listVisibleIngestionJobs(clients, [{ document_id: documentId }], context),
      clients.registry.getAuthorizationHints(context),
      listVisibleWorkflowTasks(
        clients.registry.listWorkflowTasks(context, { includeResolved: true, documentId }),
      ),
      listVisibleAuditEvents(clients.registry.listAuditEvents(context, { limit: 200 })),
      controlledDomain
        ? listControlledDocumentContext(clients, context, controlledDomain, documentId)
        : Promise.resolve({
            packages: [] as ControlledDocumentPackage[],
            rules: [] as ControlledRule[],
            available: true,
          }),
    ]);
    const currentVersion = versions.find((version) => version.status === "valid") ?? versions[0];
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
          document={document}
          versions={versions}
          jobs={jobs}
          authorization={authorization}
          assignments={assignments}
          workflowTasks={workflowTasks}
          auditEvents={auditEvents}
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
) {
  try {
    const [packages, rules] = await Promise.all([
      clients.registry.listControlledDocumentPackages(context, {
        domain,
        includeInactive: true,
      }),
      clients.registry.listControlledRules(domain, context, {
        approvedOnly: false,
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

async function listVisibleWorkflowTasks(request: Promise<RegistryWorkflowTask[]>) {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 403) return [];
    throw error;
  }
}

async function listVisibleAuditEvents(request: Promise<AuditEvent[]>) {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 403) return [];
    throw error;
  }
}
