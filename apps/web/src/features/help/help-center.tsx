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
    quickStartBody: "Nejprve ověřte stav dokumentu v registru, otevřete detail, zkontrolujte verzi a ingestion, potom pracujte s viewerem, citacemi a governance signály.",
    roles: "Role",
    manager: "Správce dokumentů",
    managerBody: "Zakládá metadata, připravuje verze, sleduje ingestion a předává dokument do revize.",
    owner: "Vlastník / gestor",
    ownerBody: "Odpovídá za věcnou správnost, platnost, výjimky, schválení a publikaci.",
    auditor: "Auditor",
    auditorBody: "Kontroluje auditní stopu, citace, přístupové politiky a rozhodnutí ve workflow.",
    registry: "Registr dokumentů",
    registryBody: "Použijte pohledy a filtry pro frontu revize, platné zdroje, citlivé dokumenty a archiv. Tabulka vždy zobrazuje autoritativní metadata z Registry API.",
    upload: "Upload a preflight",
    uploadBody: "Soubor projde kontrolou názvu, velikosti, MIME typu a SHA-256. Preflight vytvoří podepsanou upload session, browser nahraje objekt a workflow teprve potom založí draft verzi.",
    viewer: "Viewer a citace",
    viewerBody: "Citace z chatu otevírá source-context. Cílově má viewer otevřít přesnou stranu, oddíl, řádek, slide nebo OCR bbox podle typu dokumentu.",
    workflow: "Workflow publikace",
    workflowBody: "Produkční postup je draft, preflight, ingestion, governance kontrola, revize, publikace a archivace nahrazených verzí.",
    governance: "Governance kontroly",
    governanceBody: "Porovnání verzí, compliance check, detekce konfliktů a AI insighty jsou podpůrné výstupy. Autoritativní rozhodnutí zůstává na vlastníkovi nebo gestorovi.",
    chat: "Znalostní chat",
    chatBody: "Odpovědi musí mít citace. Pokud zdroje nestačí, systém má vrátit no-answer stav místo neověřené odpovědi.",
    troubleshooting: "Varování a chyby",
    troubleshootingBody: "Selhaný ingestion, chybějící source URI, nízká jistota OCR nebo citlivá klasifikace mají být vyřešené před publikací.",
    planned: "plánováno",
    available: "dostupné",
    partial: "částečně"
  },
  en: {
    title: "Help",
    updated: "current for Document Workbench",
    quickStart: "Quick start",
    quickStartBody: "Start in the registry, open the document detail, check version and ingestion state, then use viewer, citations and governance signals.",
    roles: "Roles",
    manager: "Document manager",
    managerBody: "Creates metadata, prepares versions, monitors ingestion and moves the document to review.",
    owner: "Owner / gestor",
    ownerBody: "Owns factual correctness, validity, exceptions, approval and publication.",
    auditor: "Auditor",
    auditorBody: "Reviews audit trail, citations, access policies and workflow decisions.",
    registry: "Document registry",
    registryBody: "Use views and filters for review queue, valid sources, sensitive documents and archive. The table shows authoritative Registry API metadata.",
    upload: "Upload and preflight",
    uploadBody: "The file is checked for name, size, MIME type and SHA-256. Preflight creates a signed upload session, the browser uploads the object, and the workflow creates the draft version only after that.",
    viewer: "Viewer and citations",
    viewerBody: "A chat citation opens source-context. The target viewer should open exact page, section, row, slide or OCR bbox by document type.",
    workflow: "Publication workflow",
    workflowBody: "The production flow is draft, preflight, ingestion, governance check, review, publication and archive of superseded versions.",
    governance: "Governance checks",
    governanceBody: "Version compare, compliance check, conflict detection and AI insights are supporting outputs. The authoritative decision stays with owner or gestor.",
    chat: "Knowledge chat",
    chatBody: "Answers must have citations. If sources are insufficient, the system should return a no-answer state instead of an unsupported answer.",
    troubleshooting: "Warnings and errors",
    troubleshootingBody: "Failed ingestion, missing source URI, low OCR confidence or sensitive classification should be resolved before publication.",
    planned: "planned",
    available: "available",
    partial: "partial"
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
    { icon: ShieldCheck, title: copy.governance, body: copy.governanceBody, status: copy.planned },
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
