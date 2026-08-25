import { WorkspacePageLoading } from "@/components/workspace-page-loading";

export default function ControlledDocumentationLoading() {
  return (
    <WorkspacePageLoading
      title={{ cs: "Řízené předpisy", en: "Controlled documentation" }}
      description={{
        cs: "Připravuji platná vydání, přílohy a ověřená pravidla.",
        en: "Preparing valid releases, attachments, and verified rules.",
      }}
      loadingTitle={{ cs: "Načítám řízené předpisy", en: "Loading controlled documentation" }}
      loadingDetail={{
        cs: "Ověřuji účinnost dokumentů a zobrazím pouze dostupný obsah.",
        en: "Checking document validity and showing only accessible content.",
      }}
    />
  );
}
