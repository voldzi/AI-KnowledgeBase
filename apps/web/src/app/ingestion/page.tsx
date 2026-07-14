import { PageHeader } from "@/components/page-header";
import { IngestionBoard } from "@/features/ingestion/ingestion-board";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";
import {
  listVisibleIngestionJobs,
  listVisibleIngestionReports,
} from "@/lib/ingestion/governed-operations";

export const dynamic = "force-dynamic";

export default async function IngestionPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/ingestion");
  requirePageAccess(context, "knowledge_workspace");
  const documents = await clients.registry.listDocuments(context);
  const jobs = await listVisibleIngestionJobs(clients, documents, context);
  const reports = await listVisibleIngestionReports(clients, context, jobs);

  return (
    <>
      <PageHeader
        title={{ cs: "Stav zpracování", en: "Ingestion status" }}
        description={{
          cs: "Sledujte, zda AKB dokument přečetla, připravila citace a jestli je potřeba vyřešit varování nebo chybu.",
          en: "Track whether AKB read the document, prepared citations and needs a warning or error resolved."
        }}
      />
      <IngestionBoard documents={documents} jobs={jobs} reports={reports} />
    </>
  );
}
