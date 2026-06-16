import { PageHeader } from "@/components/page-header";
import { UploadWizard } from "@/features/documents/upload-wizard";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/upload");
  const [documents, authorization] = await Promise.all([
    clients.registry.listDocuments(context),
    clients.registry.getAuthorizationHints(context)
  ]);

  return (
    <>
      <PageHeader
        title={{ cs: "Nahrání nové verze", en: "Upload a new version" }}
        description={{
          cs: "Vyberte dokument a originální soubor. AKB soubor ověří, bezpečně uloží, založí verzi a spustí zpracování pro citace.",
          en: "Choose a document and original file. AKB verifies and stores the file securely, creates a version and starts citation processing."
        }}
      />
      <UploadWizard documents={documents} authorization={authorization} />
    </>
  );
}
