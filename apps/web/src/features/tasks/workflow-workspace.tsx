"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, ClipboardCheck, Files, ListTodo, RefreshCw, Users } from "lucide-react";
import { StratosButton, StratosButtonLink, StratosDataTable, StratosSearchBox, StratosSelect, StratosViewTabs, type StratosDataTableColumn, type StratosViewTab } from "@/components/stratos";
import { StatusBadge } from "@/components/status-badge";
import { withAppBasePath } from "@/lib/app-url";
import { documentStatusLabel, documentTypeLabel, formatDate } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";
import { withDocumentReturnContext } from "@/lib/navigation/document-navigation";
import type { AuthorizationHint, DocumentAssignmentRole, RegistryWorkflowTask, WorkflowDocument } from "@/lib/types";
import { WorkflowInbox } from "./workflow-inbox";
import { approvesDocument, documentDeadlines, managesDocument, urgentDeadline, workflowToday, type DocumentDeadline } from "./document-deadlines";

type View = "approvals" | "mine" | "documents" | "team";
type AssignmentFilter = "all" | "managed" | "approver";
type DeadlineFilter = "all" | "attention" | "expired" | "review" | "missing";

const copy = {
  cs: {
    title: "Moje práce", approvals: "Ke schválení", mine: "Moje úkoly", documents: "Moje dokumenty", team: "Týmové úkoly",
    attention: "Blížící se a překročené termíny", tabs: "Osobní pracovní přehledy", search: "Hledat dokument",
    assignment: "Moje odpovědnost", all: "Všechny", managed: "Spravuji", approver: "Schvaluji nebo posuzuji",
    status: "Stav verze", deadline: "Termíny", overdue: "Po konci platnosti", review: "Revize do 30 dnů a po termínu", missing: "Chybějící nebo chybný termín revize",
    version: "Verze", validity: "Platnost do", reviewDue: "Termín revize", empty: "Žádné přiřazené dokumenty neodpovídají filtrům.",
    unavailable: "Přehled se nepodařilo bezpečně načíst. Nejde o potvrzení, že nemáte žádné úkoly nebo dokumenty.",
    actionsUnavailable: "Oprávnění k rozhodnutí nyní nelze ověřit. Změny jsou dočasně nedostupné.",
    previous: "Zveřejněná verze", unspecified: "Neuvedeno", unknown: "Nezjištěno",
  },
  en: {
    title: "My workspace", approvals: "Awaiting my approval", mine: "My tasks", documents: "My documents", team: "Team tasks",
    attention: "Upcoming and overdue dates", tabs: "Personal work views", search: "Search documents",
    assignment: "My responsibility", all: "All", managed: "Managed by me", approver: "Approved or reviewed by me",
    status: "Version status", deadline: "Dates", overdue: "Past validity end", review: "Review due within 30 days or overdue", missing: "Missing or invalid review date",
    version: "Version", validity: "Valid until", reviewDue: "Review due", empty: "No assigned documents match the filters.",
    unavailable: "This view could not be securely loaded. This does not confirm that you have no tasks or documents.",
    actionsUnavailable: "Decision permissions could not be verified. Changes are temporarily unavailable.",
    previous: "Published version", unspecified: "Not specified", unknown: "Unknown",
  },
};

const roleLabels: Record<DocumentAssignmentRole, [string, string]> = {
  owner: ["Vlastník", "Owner"], gestor: ["Gestor", "Document owner"], steward: ["Správce", "Steward"],
  approver: ["Schvalovatel", "Approver"], reviewer: ["Posuzovatel", "Reviewer"], auditor: ["Auditor", "Auditor"],
};
const deadlineLabels: Record<DocumentDeadline, [string, string]> = {
  expired: ["Platnost skončila", "Validity ended"], expires_soon: ["Platnost končí do 30 dnů", "Expires within 30 days"],
  review_overdue: ["Revize po termínu", "Review overdue"], review_soon: ["Revize do 30 dnů", "Review within 30 days"],
  review_missing: ["Termín revize není nastaven", "Review date not set"], review_invalid: ["Chybný termín revize", "Invalid review date"],
};

interface Props {
  documents: WorkflowDocument[];
  tasks: RegistryWorkflowTask[];
  teamTasks: RegistryWorkflowTask[];
  authorization: AuthorizationHint;
  unavailable: string[];
  nowIso: string;
}

export function WorkflowWorkspace({ documents, tasks, teamTasks, authorization, unavailable, nowIso }: Props) {
  const { language } = useLanguage();
  const t = copy[language];
  const router = useRouter();
  const search = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const approvals = tasks.filter((task) => task.kind === "review");
  const defaultView: View = approvals.length > 0 || documents.some(approvesDocument)
    ? "approvals" : tasks.length > 0 ? "mine" : "documents";
  const requestedView = search.get("view");
  const view: View = requestedView === "team" && authorization.can_manage_admin ? "team"
    : requestedView === "mine" || requestedView === "documents" || requestedView === "approvals" ? requestedView : defaultView;
  const [query, setQuery] = useState(() => search.get("document_q") ?? "");
  const [assignment, setAssignment] = useState<AssignmentFilter>(() => {
    const value = search.get("assignment");
    return value === "managed" || value === "approver" ? value : "all";
  });
  const [status, setStatus] = useState(() => search.get("version_status") ?? "all");
  const [deadline, setDeadline] = useState<DeadlineFilter>(() => {
    const value = search.get("deadline");
    return value === "attention" || value === "expired" || value === "review" || value === "missing" ? value : "all";
  });
  const today = workflowToday(nowIso);
  const due = documents.filter(managesDocument).filter((document) => urgentDeadline(documentDeadlines(document, today)));
  const index = language === "cs" ? 0 : 1;
  const tabs: StratosViewTab<View>[] = [
    { value: "approvals", label: t.approvals, icon: ClipboardCheck },
    { value: "mine", label: t.mine, icon: ListTodo },
    { value: "documents", label: t.documents, icon: Files },
  ];
  if (authorization.can_manage_admin) tabs.push({ value: "team", label: t.team, icon: Users });

  function changeView(next: View) {
    const params = new URLSearchParams(search.toString());
    params.set("view", next);
    params.set("document_q", query);
    params.set("assignment", assignment);
    params.set("version_status", status);
    params.set("deadline", deadline);
    for (const key of ["q", "priority", "status", "kind", "task"]) params.delete(key);
    router.replace(withAppBasePath(`/tasks?${params.toString()}`), { scroll: false });
  }

  const params = new URLSearchParams({ view: "documents", document_q: query, assignment, version_status: status, deadline });
  const returnTo = `/tasks?${params.toString()}`;
  const filtered = documents.filter((document) => {
    const deadlines = documentDeadlines(document, today);
    return (!query.trim() || document.title.toLocaleLowerCase(language).includes(query.trim().toLocaleLowerCase(language)))
      && (assignment === "all" || (assignment === "managed" ? managesDocument(document) : approvesDocument(document)))
      && (status === "all" || (document.version_status ?? document.status) === status)
      && (deadline === "all" || (deadline === "attention" ? urgentDeadline(deadlines)
        : deadline === "expired" ? deadlines.includes("expired")
          : deadline === "review" ? deadlines.some((item) => item === "review_overdue" || item === "review_soon")
            : deadlines.some((item) => item === "review_missing" || item === "review_invalid")));
  });
  const columns: StratosDataTableColumn<WorkflowDocument>[] = [
    { id: "document", label: t.documents, width: "minmax(260px, 2fr)", sortable: true, sortAccessor: (item) => item.title,
      render: (item) => <span className="cell-title"><StratosButtonLink href={withDocumentReturnContext(`/documents/${item.document_id}?tab=workflow${item.document_version_id ? `&version=${encodeURIComponent(item.document_version_id)}` : ""}`, returnTo, "tasks")}>{item.title}</StratosButtonLink><span>{documentTypeLabel(item.document_type, language)}</span></span> },
    { id: "assignment", label: t.assignment, width: 170, render: (item) => item.assignment_roles.map((role) => roleLabels[role][index]).join(", ") },
    { id: "status", label: t.status, width: 190, render: (item) => <span className="cell-title"><StatusBadge value={item.version_status ?? item.status} label={documentStatusLabel(item.version_status ?? item.status, language)} /><span>{t.version} {item.version_label ?? t.unspecified}</span>{item.published_version_label && item.published_version_label !== item.version_label ? <span>{t.previous}: {item.published_version_label}</span> : null}</span> },
    { id: "validity", label: t.validity, width: 160, sortable: true, sortAccessor: (item) => (item.published_version_label ? item.published_valid_to : item.valid_to) ?? "9999",
      render: (item) => formatDate(item.published_version_label ? item.published_valid_to : item.valid_to, language) },
    { id: "review", label: t.reviewDue, width: 170, sortable: true, sortAccessor: (item) => item.review_due_on ?? "9999", render: (item) => item.review_due_on ? formatDate(item.review_due_on, language) : t.unspecified },
    { id: "deadlines", label: t.deadline, width: 245, render: (item) => <span className="workflow-deadline-list">{documentDeadlines(item, today).map((value) => <StatusBadge key={value} value={value === "expired" || value === "review_invalid" ? "error" : value === "review_missing" ? "info" : "warning"} label={deadlineLabels[value][index]} />)}</span> },
  ];
  const currentUnavailable = unavailable.includes(view === "documents" ? "documents" : view === "team" ? "team" : "tasks");
  return <div className="stack workflow-workspace">
    <header className="page-header workflow-workspace__heading"><h1>{t.title}</h1><StratosButton
      type="button" className="icon-button" aria-label={language === "cs" ? "Obnovit přehled" : "Refresh workspace"}
      title={language === "cs" ? "Obnovit přehled" : "Refresh workspace"} disabled={refreshing}
      onClick={() => startRefresh(() => router.refresh())}><RefreshCw size={18} aria-hidden="true" /></StratosButton></header>
    <dl className="workflow-summary">
      <div><dt><ClipboardCheck size={18} aria-hidden="true" />{t.approvals}</dt><dd>{unavailable.includes("tasks") ? t.unknown : approvals.length}</dd></div>
      <div><dt><Files size={18} aria-hidden="true" />{t.documents}</dt><dd>{unavailable.includes("documents") ? t.unknown : documents.length}</dd></div>
      <div><dt><CalendarClock size={18} aria-hidden="true" />{t.attention}</dt><dd>{unavailable.includes("documents") ? t.unknown : due.length}</dd></div>
    </dl>
    <StratosViewTabs ariaLabel={t.tabs} value={view} items={tabs} onValueChange={changeView} />
    {unavailable.includes("authorization") ? <div className="notice notice--warning" role="status">{t.actionsUnavailable}</div> : null}
    {currentUnavailable ? <div className="notice notice--danger" role="alert">{t.unavailable}</div>
      : view === "documents" ? <section className="stack" aria-label={t.documents}>
        <div className="workflow-document-filters">
          <StratosSearchBox id="my-document-search" label={t.search} placeholder={t.search} value={query} onChange={(event) => setQuery(event.target.value)} />
          <StratosSelect id="my-document-role" label={t.assignment} value={assignment} onChange={(event) => setAssignment(event.target.value as AssignmentFilter)}><option value="all">{t.all}</option><option value="managed">{t.managed}</option><option value="approver">{t.approver}</option></StratosSelect>
          <StratosSelect id="my-document-status" label={t.status} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{t.all}</option>{["draft", "review", "approved", "valid", "superseded", "archived", "cancelled"].map((value) => <option key={value} value={value}>{documentStatusLabel(value, language)}</option>)}</StratosSelect>
          <StratosSelect id="my-document-deadline" label={t.deadline} value={deadline} onChange={(event) => setDeadline(event.target.value as DeadlineFilter)}><option value="all">{t.all}</option><option value="attention">{t.attention}</option><option value="expired">{t.overdue}</option><option value="review">{t.review}</option><option value="missing">{t.missing}</option></StratosSelect>
        </div>
        <StratosDataTable rows={filtered} columns={columns} getRowId={(item) => item.document_id} emptyLabel={t.empty} aria-label={t.documents} columnWidthStorageKey="personal-document-workspace" />
      </section>
        : <WorkflowInbox key={view} compact title={t[view]} documents={[]} jobs={[]} auditEvents={[]} registryTasks={view === "approvals" ? approvals : view === "team" ? teamTasks : tasks} authorization={authorization} nowIso={nowIso} />}
  </div>;
}
