import { WorkspacePageLoading } from "@/components/workspace-page-loading";

export function DashboardLoading() {
  return (
    <WorkspacePageLoading
      title={{ cs: "Provozní přehled", en: "Operational dashboard" }}
      description={{
        cs: "Připravuji aktuální dokumenty, úkoly a provozní stav.",
        en: "Preparing current documents, tasks, and operational status.",
      }}
      loadingTitle={{ cs: "Načítám provozní přehled", en: "Loading the operational dashboard" }}
      loadingDetail={{
        cs: "Ověřuji oprávnění a získávám aktuální údaje.",
        en: "Checking permissions and retrieving current data.",
      }}
    />
  );
}
