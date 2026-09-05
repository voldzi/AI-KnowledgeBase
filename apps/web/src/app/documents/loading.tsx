import { WorkspacePageLoading } from "@/components/workspace-page-loading";

export default function DocumentsLoading() {
  return (
    <WorkspacePageLoading
      title={{ cs: "Dokumenty", en: "Documents" }}
      description={{
        cs: "Připravuji dokumenty, dostupné filtry a vaše oprávnění.",
        en: "Preparing documents, available filters, and your permissions.",
      }}
      loadingTitle={{ cs: "Načítám dokumenty", en: "Loading documents" }}
      loadingDetail={{
        cs: "Výsledky se zobrazí průběžně po ověření přístupu.",
        en: "Results will appear after access is checked.",
      }}
    />
  );
}
