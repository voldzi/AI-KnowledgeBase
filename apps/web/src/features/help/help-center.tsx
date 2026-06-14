"use client";

import {
  BookOpenCheck,
  ClipboardCheck,
  FileSearch,
  FileUp,
  HelpCircle,
  MessageSquareQuote,
  ShieldCheck,
  Workflow
} from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { useLanguage, type AklLanguage } from "@/lib/i18n";

const helpCopy = {
  cs: {
    title: "Nápověda",
    updated: "aktuální pro Document Workbench",
    quickStart: "Rychlý start",
    quickStartBody: "Začněte v registru. Otevřete detail dokumentu, ověřte aktuální verzi, zpracování a citace, potom rozhodněte, jestli dokument potřebuje revizi, schválení nebo novou verzi.",
    roles: "Role",
    manager: "Správce dokumentů",
    managerBody: "Zakládá metadata, nahrává originální soubor, sleduje zpracování a připravuje dokument pro revizi.",
    owner: "Vlastník / gestor",
    ownerBody: "Odpovídá za věcnou správnost, platnost, výjimky, schválení a publikaci.",
    auditor: "Auditor",
    auditorBody: "Kontroluje auditní stopu, citace, přístupové politiky a rozhodnutí ve workflow.",
    registry: "Registr dokumentů",
    registryBody: "Použijte pohledy a filtry pro frontu revize, platné zdroje, citlivé dokumenty a archiv. Pokud nevíte, čím začít, otevřete dokument s prioritním krokem.",
    upload: "Nahrání verze",
    uploadBody: "Vyberte dokument a originální soubor. AKB soubor ověří, bezpečně uloží a z řízených voleb vytvoří souhrn změny do historie verzí.",
    viewer: "Viewer a citace",
    viewerBody: "Citace z chatu otevře přesný úsek zdroje. Detail dokumentu umí připravit originální soubor, zvýraznit citovanou část v PDF/Markdownu a zobrazit běžné kancelářské a datové formáty.",
    workflow: "Schválení a publikace",
    workflowBody: "Postup je: založit metadata, nahrát originál, zkontrolovat zpracování a citace, spustit kontroly, předat vlastníkovi a po schválení publikovat platnou verzi.",
    governance: "Kontroly před schválením",
    governanceBody: "Porovnání verzí, kontrola pravidel a detekce konfliktů pomáhají vlastníkovi rozhodnout. Výstup je podklad s citacemi, ne automatické schválení.",
    chat: "Znalostní chat",
    chatBody: "Odpovědi musí mít citace. Pokud zdroje nestačí, systém má vrátit no-answer stav místo neověřené odpovědi.",
    troubleshooting: "Varování a chyby",
    troubleshootingBody: "Chyby zpracování, chybějící originál, nízká jistota OCR nebo citlivá klasifikace se řeší před publikací.",
    planned: "návod",
    available: "aktivní",
    partial: "řízený krok"
  },
  en: {
    title: "Help",
    updated: "current for Document Workbench",
    quickStart: "Quick start",
    quickStartBody: "Start in the registry. Open document detail, verify the current version, processing and citations, then decide whether the document needs review, approval or a new version.",
    roles: "Roles",
    manager: "Document manager",
    managerBody: "Creates metadata, uploads the original file, monitors processing and prepares the document for review.",
    owner: "Owner / gestor",
    ownerBody: "Owns factual correctness, validity, exceptions, approval and publication.",
    auditor: "Auditor",
    auditorBody: "Reviews audit trail, citations, access policies and workflow decisions.",
    registry: "Document registry",
    registryBody: "Use views and filters for review queue, valid sources, sensitive documents and archive. If you are not sure where to start, open a document with a priority action.",
    upload: "Upload version",
    uploadBody: "Choose the document and original file. AKB verifies and stores the file, then creates the version-history summary from guided choices.",
    viewer: "Viewer and citations",
    viewerBody: "A chat citation opens the exact source segment. Document detail can prepare the original file, highlight the cited part in PDF/Markdown and display common office and data formats.",
    workflow: "Approval and publication",
    workflowBody: "The flow is: create metadata, upload the original, check processing and citations, run checks, send to owner and publish the valid version after approval.",
    governance: "Checks before approval",
    governanceBody: "Version compare, rule checks and conflict detection help the owner decide. The output is cited supporting evidence, not automatic approval.",
    chat: "Knowledge chat",
    chatBody: "Answers must have citations. If sources are insufficient, the system should return a no-answer state instead of an unsupported answer.",
    troubleshooting: "Warnings and errors",
    troubleshootingBody: "Processing errors, missing original file, low OCR confidence or sensitive classification should be resolved before publication.",
    planned: "guide",
    available: "active",
    partial: "guided step"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function HelpCenter() {
  const { language } = useLanguage();
  const copy = helpCopy[language];

  const sections = [
    { icon: FileSearch, title: copy.registry, body: copy.registryBody, status: copy.available },
    { icon: FileUp, title: copy.upload, body: copy.uploadBody, status: copy.partial },
    { icon: BookOpenCheck, title: copy.viewer, body: copy.viewerBody, status: copy.partial },
    { icon: Workflow, title: copy.workflow, body: copy.workflowBody, status: copy.partial },
    { icon: ShieldCheck, title: copy.governance, body: copy.governanceBody, status: copy.partial },
    { icon: MessageSquareQuote, title: copy.chat, body: copy.chatBody, status: copy.available },
    { icon: ClipboardCheck, title: copy.troubleshooting, body: copy.troubleshootingBody, status: copy.partial }
  ];

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel__header">
          <h2>{copy.quickStart}</h2>
          <HelpCircle size={18} aria-hidden="true" />
        </div>
        <div className="panel__body help-lead">
          <p>{copy.quickStartBody}</p>
          <StatusBadge value="online" label={copy.updated} />
        </div>
      </section>

      <section className="grid grid--three">
        {[
          [copy.manager, copy.managerBody],
          [copy.owner, copy.ownerBody],
          [copy.auditor, copy.auditorBody]
        ].map(([title, body]) => (
          <article className="panel help-role" key={title}>
            <div className="panel__body">
              <strong>{title}</strong>
              <p>{body}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>{copy.roles}</h2>
          <ClipboardCheck size={18} aria-hidden="true" />
        </div>
        <div className="panel__body help-grid">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <article className="help-item" key={section.title}>
                <Icon size={19} aria-hidden="true" />
                <div>
                  <div className="help-item__title">
                    <strong>{section.title}</strong>
                    <StatusBadge value={section.status === copy.available ? "valid" : section.status === copy.partial ? "review" : "draft"} label={section.status} />
                  </div>
                  <p>{section.body}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
