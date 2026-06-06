import { PageHeader } from "@/components/page-header";
import { HelpCenter } from "@/features/help/help-center";

export default function HelpPage() {
  return (
    <>
      <PageHeader
        title={{ cs: "Nápověda", en: "Help" }}
        description={{
          cs: "Pracovní nápověda pro správu dokumentů, upload, viewer, citace, governance kontroly a řešení varování.",
          en: "Workflow help for document management, upload, viewer, citations, governance checks and warning resolution."
        }}
      />
      <HelpCenter />
    </>
  );
}
