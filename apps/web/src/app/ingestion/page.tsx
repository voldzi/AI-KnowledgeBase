import { PageHeader } from "@/components/page-header";
import { IngestionBoard } from "@/features/ingestion/ingestion-board";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export default async function IngestionPage() {
  const clients = getServerApiClients();
  const context = getServerRequestContext();
  const [documents, jobs] = await Promise.all([clients.registry.listDocuments(context), clients.ingestion.listJobs(context)]);
  const reports = (
    await Promise.all(
      jobs.map((job) => clients.ingestion.getReport(job.job_id, context).catch(() => null))
    )
  ).filter((report) => report !== null);

  return (
    <>
      <PageHeader
        title="Ingestion status"
        description="Operational view over queued, running, failed and warning states reported by the Ingestion Service."
      />
      <IngestionBoard documents={documents} jobs={jobs} reports={reports} />
    </>
  );
}
