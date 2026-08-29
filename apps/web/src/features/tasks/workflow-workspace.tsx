"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, ClipboardCheck, Files, ListTodo, RefreshCw, Users } from "lucide-react";
import { StratosButton, StratosButtonLink, StratosDataTable, StratosSearchBox, StratosSelect, StratosViewTabs, type StratosDataTableColumn, type StratosViewTab } from "@/components/stratos";
import { StatusBadge } from "@/components/status-badge";
import { documentStatusLabel, documentTypeLabel, formatDate } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";
import { withDocumentReturnContext } from "@/lib/navigation/document-navigation";
import type { AuthorizationHint, DocumentAssignmentRole, RegistryWorkflowTask, WorkflowDocument } from "@/lib/types";
import { WorkflowInbox } from "./workflow-inbox";
import { documentDeadlines, workflowToday, type DocumentDeadline } from "./document-deadlines";
import type { WorkflowView as View } from "./workflow-query";

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
  view: View;
  canReadTeam: boolean;
  documents: WorkflowDocument[];
  tasks: RegistryWorkflowTask[];
  authorization: AuthorizationHint;
  unavailable: boolean;
  actionsUnavailable: boolean;
  nowIso: string;
  total: number | null;
  limit: number;
  offset: number;
}

export function WorkflowWorkspace({ view, canReadTeam, documents, tasks, authorization, unavailable, actionsUnavailable, nowIso, total, limit, offset }: Props) {
  const { language } = useLanguage();
  const t = copy[language];
  const router = useRouter();
  const search = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
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
  const index = language === "cs" ? 0 : 1;
  const tabs: StratosViewTab<View>[] = [
    { value: "approvals", label: t.approvals, icon: ClipboardCheck },
    { value: "mine", label: t.mine, icon: ListTodo },
    { value: "documents", label: t.documents, icon: Files },
  ];
  if (canReadTeam) tabs.push({ value: "team", label: t.team, icon: Users });

  const [taskQuery, setTaskQuery] = useState(() => search.get("q") ?? "");
  const [taskStatus, setTaskStatus] = useState(() => search.get("status") ?? "all");
  const [priority, setPriority] = useState(() => search.get("priority") ?? "all");
  const [kind, setKind] = useState(() => search.get("kind") ?? "all");
  const ownNavigations = useRef(new Set<string>());
  const replaceQuery = useCallback((params: URLSearchParams) => {
    const target = params.toString();
    ownNavigations.current.add(target);
    if (ownNavigations.current.size > 16) ownNavigations.current.delete(ownNavigations.current.values().next().value!);
    // Next's router adds the configured base path itself.
    startRefresh(() => router.replace(`/tasks?${target}`, { scroll: false }));
  }, [router]);
  useEffect(() => {
    // Preserve typing/focus on our own responses; restore filters on Back/Forward.
    if (ownNavigations.current.delete(search.toString())) return;
    setQuery(search.get("document_q") ?? "");
    const role = search.get("assignment");
    setAssignment(role === "managed" || role === "approver" ? role : "all");
    setStatus(search.get("version_status") ?? "all");
    const dateFilter = search.get("deadline");
    setDeadline(dateFilter === "attention" || dateFilter === "expired" || dateFilter === "review" || dateFilter === "missing" ? dateFilter : "all");
    setTaskQuery(search.get("q") ?? "");
    setTaskStatus(search.get("status") ?? "all");
    setPriority(search.get("priority") ?? "all");
    setKind(search.get("kind") ?? "all");
  }, [search]);
  const filters = useMemo(() => view === "documents"
    ? { document_q: query, assignment, version_status: status, deadline }
    : { q: taskQuery, status: taskStatus, priority, kind: view === "approvals" ? "all" : kind },
  [view, query, assignment, status, deadline, taskQuery, taskStatus, priority, kind]);
  const filtersChanged = Object.entries(filters).some(([key, value]) =>
    (value === "all" ? "" : value) !== (search.get(key) === "all" ? "" : search.get(key) ?? ""));
  useEffect(() => {
    if (!filtersChanged) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(search.toString());
      for (const [key, value] of Object.entries(filters)) {
        if (!value || value === "all") params.delete(key);
        else params.set(key, value);
      }
      params.set("view", view);
      params.delete("page");
      params.delete("task");
      replaceQuery(params);
    }, 250);
    return () => clearTimeout(timer);
  }, [filtersChanged, filters, view, search, replaceQuery]);
  const pending = refreshing || filtersChanged;

  function changeView(next: View) {
    const params = new URLSearchParams(search.toString());
    params.set("view", next);
    params.set("document_q", query);
    params.set("assignment", assignment);
    params.set("version_status", status);
    params.set("deadline", deadline);
    for (const key of ["q", "priority", "status", "kind", "task", "page"]) params.delete(key);
    replaceQuery(params);
  }

  const params = new URLSearchParams({ view: "documents", document_q: query, assignment, version_status: status, deadline });
  params.set("page", String(Math.floor(offset / limit) + 1));
  const returnTo = `/tasks?${params.toString()}`;
  const columns: StratosDataTableColumn<WorkflowDocument>[] = [
    { id: "document", label: t.documents, width: "minmax(260px, 2fr)",
      render: (item) => <span className="cell-title"><StratosButtonLink href={withDocumentReturnContext(`/documents/${item.document_id}?tab=workflow${item.document_version_id ? `&version=${encodeURIComponent(item.document_version_id)}` : ""}`, returnTo, "tasks")}>{item.title}</StratosButtonLink><span>{documentTypeLabel(item.document_type, language)}</span></span> },
    { id: "assignment", label: t.assignment, width: 170, render: (item) => item.assignment_roles.map((role) => roleLabels[role][index]).join(", ") },
    { id: "status", label: t.status, width: 190, render: (item) => <span className="cell-title"><StatusBadge value={item.version_status ?? item.status} label={documentStatusLabel(item.version_status ?? item.status, language)} /><span>{t.version} {item.version_label ?? t.unspecified}</span>{item.published_version_label && item.published_version_label !== item.version_label ? <span>{t.previous}: {item.published_version_label}</span> : null}</span> },
    { id: "validity", label: t.validity, width: 160,
      render: (item) => formatDate(item.published_version_label ? item.published_valid_to : item.valid_to, language) },
    { id: "review", label: t.reviewDue, width: 170, render: (item) => item.review_due_on ? formatDate(item.review_due_on, language) : t.unspecified },
    { id: "deadlines", label: t.deadline, width: 245, render: (item) => <span className="workflow-deadline-list">{documentDeadlines(item, today).map((value) => <StatusBadge key={value} value={value === "expired" || value === "review_invalid" ? "error" : value === "review_missing" ? "info" : "warning"} label={deadlineLabels[value][index]} />)}</span> },
  ];
  function changePage(nextOffset: number) {
    const params = new URLSearchParams(search.toString());
    params.set("view", view);
    params.set("page", String(Math.floor(nextOffset / limit) + 1));
    params.delete("task");
    replaceQuery(params);
  }
  return <div className="stack workflow-workspace">
    <header className="page-header workflow-workspace__heading"><h1>{t.title}</h1><StratosButton
      type="button" className="icon-button" aria-label={language === "cs" ? "Obnovit přehled" : "Refresh workspace"}
      title={language === "cs" ? "Obnovit přehled" : "Refresh workspace"} disabled={refreshing}
      onClick={() => startRefresh(() => router.refresh())}><RefreshCw size={18} aria-hidden="true" /></StratosButton></header>
    <StratosViewTabs ariaLabel={t.tabs} value={view} items={tabs} onValueChange={changeView} />
    {actionsUnavailable ? <div className="notice notice--warning" role="status">{t.actionsUnavailable}</div> : null}
    {view === "documents" ? <section className="stack" aria-label={t.documents}>
        <fieldset className="workflow-document-filters workflow-filter-fieldset">
          <StratosSearchBox id="my-document-search" label={t.search} placeholder={t.search} value={query} onChange={(event) => setQuery(event.target.value)} />
          <StratosSelect id="my-document-role" label={t.assignment} aria-label={t.assignment} value={assignment} onChange={(event) => setAssignment(event.target.value as AssignmentFilter)}><option value="all">{t.all}</option><option value="managed">{t.managed}</option><option value="approver">{t.approver}</option></StratosSelect>
          <StratosSelect id="my-document-status" label={t.status} aria-label={t.status} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{t.all}</option>{["draft", "review", "approved", "valid", "superseded", "archived", "cancelled"].map((value) => <option key={value} value={value}>{documentStatusLabel(value, language)}</option>)}</StratosSelect>
          <StratosSelect id="my-document-deadline" label={t.deadline} aria-label={t.deadline} value={deadline} onChange={(event) => setDeadline(event.target.value as DeadlineFilter)}><option value="all">{t.all}</option><option value="attention">{t.attention}</option><option value="expired">{t.overdue}</option><option value="review">{t.review}</option><option value="missing">{t.missing}</option></StratosSelect>
        </fieldset>
      </section>
      : <fieldset className="workflow-document-filters workflow-filter-fieldset">
        <StratosSearchBox id="workflow-page-search" label={language === "cs" ? "Hledat úkol nebo dokument" : "Search tasks or documents"} value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} />
        <StratosSelect id="workflow-page-status" label={language === "cs" ? "Stav úkolu" : "Task status"} aria-label={language === "cs" ? "Stav úkolu" : "Task status"} value={taskStatus} onChange={(event) => setTaskStatus(event.target.value)}>
          <option value="all">{t.all}</option>{(["open", "waiting", "blocked"] as const).map((value, i) => <option key={value} value={value}>{(language === "cs" ? ["Otevřený", "Čekající", "Blokovaný"] : ["Open", "Waiting", "Blocked"])[i]}</option>)}
        </StratosSelect>
        <StratosSelect id="workflow-page-priority" label={language === "cs" ? "Priorita" : "Priority"} aria-label={language === "cs" ? "Priorita" : "Priority"} value={priority} onChange={(event) => setPriority(event.target.value)}>
          <option value="all">{t.all}</option>{(["critical", "high", "medium", "low"] as const).map((value, i) => <option key={value} value={value}>{(language === "cs" ? ["Kritická", "Vysoká", "Střední", "Nízká"] : ["Critical", "High", "Medium", "Low"])[i]}</option>)}
        </StratosSelect>
        {view !== "approvals" ? <StratosSelect id="workflow-page-kind" label={language === "cs" ? "Typ úkolu" : "Task type"} aria-label={language === "cs" ? "Typ úkolu" : "Task type"} value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="all">{t.all}</option>{(["review", "draft", "ingestion", "governance", "audit"] as const).map((value, i) => <option key={value} value={value}>{(language === "cs" ? ["Schválení", "Koncept", "Zpracování", "Kontrola", "Audit"] : ["Review", "Draft", "Processing", "Governance", "Audit"])[i]}</option>)}
        </StratosSelect> : null}
      </fieldset>}
    <div className="stack" aria-busy={pending}>
      {pending ? <div className="notice" role="status"><span className="dashboard-loading__indicator" aria-hidden="true" />{language === "cs" ? "Načítám přehled…" : "Loading workspace…"}</div>
        : unavailable ? <div className="notice notice--danger" role="alert">{t.unavailable}<StratosButton onClick={() => startRefresh(() => router.refresh())}><RefreshCw size={16} aria-hidden="true" />{language === "cs" ? "Zkusit znovu" : "Try again"}</StratosButton></div>
          : view === "documents" ? <StratosDataTable rows={documents} columns={columns} getRowId={(item) => item.document_id} emptyLabel={t.empty} aria-label={t.documents} columnWidthStorageKey="personal-document-workspace" />
            : <WorkflowInbox serverFiltered compact title={t[view]} documents={[]} jobs={[]} auditEvents={[]} registryTasks={tasks} authorization={authorization} nowIso={nowIso} />}
    </div>
    <nav className="workflow-pagination" aria-label={language === "cs" ? "Stránkování přehledu" : "Workspace pages"}>
      <span role="status">{pending || total === null ? t.unknown : `${Math.min(offset + 1, total)}–${Math.min(offset + limit, total)} ${language === "cs" ? "z" : "of"} ${total}`}</span>
      <StratosButton className="icon-button" disabled={pending || offset === 0} onClick={() => changePage(Math.max(0, offset - limit))} aria-label={language === "cs" ? "Předchozí stránka" : "Previous page"} title={language === "cs" ? "Předchozí stránka" : "Previous page"}><ChevronLeft size={18} aria-hidden="true" /></StratosButton>
      <StratosButton className="icon-button" disabled={pending || total === null || offset + limit >= total} onClick={() => changePage(offset + limit)} aria-label={language === "cs" ? "Další stránka" : "Next page"} title={language === "cs" ? "Další stránka" : "Next page"}><ChevronRight size={18} aria-hidden="true" /></StratosButton>
    </nav>
  </div>;
}
