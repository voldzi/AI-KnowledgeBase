import { WorkspacePageLoading } from "@/components/workspace-page-loading";

export default function TasksLoading() {
  return <WorkspacePageLoading
    title={{ cs: "Moje práce", en: "My workspace" }}
    description={{ cs: "", en: "" }}
    loadingTitle={{ cs: "Načítám přehled", en: "Loading workspace" }}
    loadingDetail={{ cs: "Ověřuji přístup k vašim úkolům a dokumentům.", en: "Verifying access to your tasks and documents." }}
  />;
}
