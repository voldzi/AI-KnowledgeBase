"use client";

import { useMemo, useState } from "react";
import { KeyRound, Search, ShieldCheck, UserCog, UserPlus } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import {
  StratosDataTable,
  StratosSearchBox,
  StratosSelect,
  type StratosDataTableColumn,
} from "@/components/stratos";
import { withAppBasePath } from "@/lib/app-url";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type { AuthorizationHint, DirectoryUser, RoleMapping } from "@/lib/types";

interface AdminSkeletonProps {
  authorization: AuthorizationHint;
  initialRoleMappings: RoleMapping[];
}

const ROLE_OPTIONS = [
  "reader",
  "analyst",
  "document_gestor",
  "document_owner",
  "document_manager",
  "reviewer",
  "auditor",
  "service_governance",
  "admin",
];

const adminCopy = {
  cs: {
    activeMappings: "Aktivní role",
    activeMappingsDetail: "platných mapování",
    subjects: "Identity",
    subjectsDetail: "uživatelů a skupin",
    roles: "Role",
    rolesDetail: "dostupných profilů",
    title: "Řízení přístupu",
    readOnly: "jen čtení",
    roleMappings: "Mapování rolí",
    directory: "Adresář uživatelů",
    directoryDetail: "Vyhledejte identitu a přiřaďte jí aplikační roli.",
    search: "Hledat v adresáři",
    searchPlaceholder: "Jméno, e-mail nebo uživatelský účet",
    runSearch: "Hledat",
    role: "Role",
    assign: "Přiřadit roli",
    subject: "Identita",
    subjectType: "Typ",
    status: "Stav",
    updated: "Aktualizováno",
    action: "Akce",
    deactivate: "Odebrat",
    activate: "Aktivovat",
    empty: "Žádné mapování role.",
    noUsers: "Adresář nevrátil žádného uživatele.",
    selectUser: "Vyberte uživatele z výsledků.",
    saved: "Mapování role bylo uloženo.",
    failed: "Operaci přístupu se nepodařilo dokončit.",
    searching: "Hledám...",
  },
  en: {
    activeMappings: "Active roles",
    activeMappingsDetail: "valid mappings",
    subjects: "Identities",
    subjectsDetail: "users and groups",
    roles: "Roles",
    rolesDetail: "available profiles",
    title: "Access management",
    readOnly: "read only",
    roleMappings: "Role mappings",
    directory: "User directory",
    directoryDetail: "Find an identity and assign an application role.",
    search: "Search directory",
    searchPlaceholder: "Name, email, or user account",
    runSearch: "Search",
    role: "Role",
    assign: "Assign role",
    subject: "Identity",
    subjectType: "Type",
    status: "Status",
    updated: "Updated",
    action: "Action",
    deactivate: "Remove",
    activate: "Activate",
    empty: "No role mapping.",
    noUsers: "The directory returned no users.",
    selectUser: "Select a user from the results.",
    saved: "Role mapping saved.",
    failed: "The access operation could not be completed.",
    searching: "Searching...",
  },
} satisfies Record<AklLanguage, Record<string, string>>;

export function AdminSkeleton({ authorization, initialRoleMappings }: AdminSkeletonProps) {
  const { language } = useLanguage();
  const copy = adminCopy[language];
  const [members, setMembers] = useState(initialRoleMappings);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<DirectoryUser | null>(null);
  const [selectedRole, setSelectedRole] = useState("reader");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [busyMappingId, setBusyMappingId] = useState<string | null>(null);

  const activeMembers = members.filter((member) => member.status === "active");
  const subjectCount = new Set(members.map((member) => `${member.subject_type}:${member.subject_id}`)).size;
  const columns = useMemo<StratosDataTableColumn<RoleMapping>[]>(() => [
    {
      id: "subject",
      label: copy.subject,
      sortable: true,
      sortValue: (member: RoleMapping) => member.display_name ?? member.subject_id,
      render: (member) => (
        <span className="cell-title">
          <strong>{member.display_name || member.subject_id}</strong>
          <small>{member.subject_id}</small>
        </span>
      ),
    },
    { id: "type", label: copy.subjectType, render: (member) => member.subject_type },
    { id: "role", label: copy.role, sortable: true, render: (member) => member.role },
    {
      id: "status",
      label: copy.status,
      sortable: true,
      render: (member) => (
        <StatusBadge value={member.status === "active" ? "valid" : "archived"} label={member.status} />
      ),
    },
    {
      id: "updated",
      label: copy.updated,
      sortable: true,
      sortValue: (member: RoleMapping) => member.updated_at,
      render: (member) => formatDateTime(member.updated_at, language),
    },
    {
      id: "action",
      label: copy.action,
      resizable: false,
      render: (member) => (
        <button
          className="button"
          type="button"
          disabled={!authorization.can_manage_admin || busyMappingId === member.role_mapping_id}
          onClick={() => void setMappingStatus(member)}
        >
          {member.status === "active" ? copy.deactivate : copy.activate}
        </button>
      ),
    },
  ], [authorization.can_manage_admin, busyMappingId, copy, language]);

  async function searchDirectory() {
    const query = directoryQuery.trim();
    if (!query) return;
    setStatus("loading");
    setMessage(null);
    try {
      const response = await fetch(
        `${withAppBasePath("/api/admin/access")}?query=${encodeURIComponent(query)}&limit=12`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) throw new Error("directory search failed");
      const payload = (await response.json()) as { users?: DirectoryUser[] };
      setDirectoryUsers(payload.users ?? []);
      setSelectedUser(null);
      setStatus("ready");
    } catch {
      setStatus("error");
      setMessage(copy.failed);
    }
  }

  async function assignRole() {
    if (!selectedUser || !authorization.can_manage_admin) {
      setMessage(copy.selectUser);
      return;
    }
    setStatus("loading");
    setMessage(null);
    try {
      await postAccessAction({ action: "import_user", subject: selectedUser.subject_id });
      const payload = await postAccessAction({
        action: "assign_role",
        subject_type: "user",
        subject_id: selectedUser.subject_id,
        role: selectedRole,
        status: "active",
      }) as { member: RoleMapping };
      setMembers((current) => [
        payload.member,
        ...current.filter((member) => member.role_mapping_id !== payload.member.role_mapping_id),
      ]);
      setStatus("ready");
      setMessage(copy.saved);
    } catch {
      setStatus("error");
      setMessage(copy.failed);
    }
  }

  async function setMappingStatus(member: RoleMapping) {
    setBusyMappingId(member.role_mapping_id);
    setMessage(null);
    try {
      const payload = await postAccessAction({
        action: "set_role_status",
        role_mapping_id: member.role_mapping_id,
        status: member.status === "active" ? "removed" : "active",
      }) as { member: RoleMapping };
      setMembers((current) => current.map((candidate) => (
        candidate.role_mapping_id === payload.member.role_mapping_id ? payload.member : candidate
      )));
      setMessage(copy.saved);
    } catch {
      setMessage(copy.failed);
    } finally {
      setBusyMappingId(null);
    }
  }

  return (
    <div className="stack">
      <section className="grid grid--three">
        <MetricCard icon={ShieldCheck} label={copy.activeMappings} value={formatNumber(activeMembers.length, language)} detail={copy.activeMappingsDetail} tone="success" />
        <MetricCard icon={UserCog} label={copy.subjects} value={formatNumber(subjectCount, language)} detail={copy.subjectsDetail} tone="default" />
        <MetricCard icon={KeyRound} label={copy.roles} value={formatNumber(ROLE_OPTIONS.length, language)} detail={copy.rolesDetail} tone="default" />
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>{copy.directory}</h2>
            <p>{copy.directoryDetail}</p>
          </div>
          <StatusBadge value={authorization.can_manage_admin ? "valid" : "draft"} label={authorization.can_manage_admin ? "admin.manage" : copy.readOnly} />
        </div>
        <div className="panel__body stack">
          <div className="admin-directory-toolbar">
            <StratosSearchBox
              id="admin-directory-search"
              label={copy.search}
              value={directoryQuery}
              placeholder={copy.searchPlaceholder}
              onChange={(event) => setDirectoryQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void searchDirectory();
                }
              }}
            />
            <button className="button" type="button" disabled={!directoryQuery.trim() || status === "loading"} onClick={() => void searchDirectory()}>
              <Search size={15} aria-hidden="true" />
              {status === "loading" ? copy.searching : copy.runSearch}
            </button>
          </div>
          {directoryUsers.length > 0 ? (
            <div className="admin-directory-results" aria-label={copy.directory}>
              {directoryUsers.map((user) => (
                <button
                  className={selectedUser?.subject_id === user.subject_id ? "is-selected" : ""}
                  key={user.subject_id}
                  type="button"
                  onClick={() => setSelectedUser(user)}
                >
                  <strong>{user.display_name || user.username || user.subject_id}</strong>
                  <small>{user.email || user.subject_id}</small>
                </button>
              ))}
            </div>
          ) : status === "ready" ? <p className="muted">{copy.noUsers}</p> : null}
          <div className="admin-role-assignment">
            <div>
              <span>{copy.subject}</span>
              <strong>{selectedUser?.display_name || selectedUser?.username || copy.selectUser}</strong>
            </div>
            <StratosSelect id="admin-role" label={copy.role} value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)}>
              {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
            </StratosSelect>
            <button className="button button--primary" type="button" disabled={!selectedUser || status === "loading" || !authorization.can_manage_admin} onClick={() => void assignRole()}>
              <UserPlus size={15} aria-hidden="true" />
              {copy.assign}
            </button>
          </div>
          {message ? <p className={status === "error" ? "notice notice--danger" : "notice"} role="status">{message}</p> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>{copy.roleMappings}</h2>
          <span className="muted">{members.length}</span>
        </div>
        <StratosDataTable rows={members} columns={columns} getRowId={(member) => member.role_mapping_id} emptyLabel={copy.empty} aria-label={copy.roleMappings} />
      </section>
    </div>
  );
}

async function postAccessAction(body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(withAppBasePath("/api/admin/access"), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("access action failed");
  return response.json();
}
