"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  Database,
  FileClock,
  FilePlus2,
  LayoutDashboard,
  ListChecks,
  LogOut,
  ShieldCheck,
  UserRound
} from "lucide-react";

import { isEmployeeChatOnly } from "@/lib/auth/authorization";
import {
  AppSettingsSurface,
  type RolePreviewSettings,
  type SettingsSurfaceMode,
  type StratosSettingsCoreValue,
  type StratosSettingsCoreValueKey,
  type StratosSettingsCoreValues
} from "@/components/app-settings-surface";
import { ProjectTopbar } from "@/components/project-topbar";
import {
  StratosAppRail,
  StratosAppShell,
  CommandCenter,
  StratosWorkspaceNav,
  StratosWorkspaceSidebar,
  type CommandCenterItem,
  type StratosWorkspaceNavGroup
} from "@/components/stratos";
import { withAppBasePath } from "@/lib/app-url";
import { LanguageProvider, useLanguage, type AklLanguage } from "@/lib/i18n";

const navigation = {
  cs: [
    { href: "/", label: "Přehled", icon: LayoutDashboard },
    { href: "/tasks", label: "Úkoly", icon: ListChecks },
    { href: "/documents", label: "Dokumenty", icon: Database },
    { href: "/upload", label: "Nahrát", icon: FilePlus2 },
    { href: "/ingestion", label: "Zpracování", icon: FileClock },
    { href: "/chat", label: "Znalostní chat", icon: Bot },
    { href: "/audit", label: "Audit", icon: ShieldCheck },
    { href: "/help", label: "Nápověda", icon: CircleHelp }
  ],
  en: [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/tasks", label: "Tasks", icon: ListChecks },
    { href: "/documents", label: "Documents", icon: Database },
    { href: "/upload", label: "Upload", icon: FilePlus2 },
    { href: "/ingestion", label: "Ingestion", icon: FileClock },
    { href: "/chat", label: "Knowledge chat", icon: Bot },
    { href: "/audit", label: "Audit", icon: ShieldCheck },
    { href: "/help", label: "Help", icon: CircleHelp }
  ]
} satisfies Record<AklLanguage, Array<{ href: string; label: string; icon: typeof UserRound }>>;

const shellCopy = {
  cs: {
    assistantBrand: "Znalostní asistent",
    assistantSubtitle: "interní znalosti a postupy",
    serviceAvailable: "Služba dostupná",
    knowledgeManagement: "Správa znalostí",
    help: "Nápověda",
    searchPlaceholder: "Najít dokument, verzi, citaci nebo auditní událost",
    commandCenterOpen: "Otevřít Command Center",
    commandCenterTitle: "Command Center",
    commandCenterPlaceholder: "Hledat v AKB nebo spustit akci",
    commandCenterPreview: "Vyberte výsledek pro rychlé otevření nebo spuštění akce.",
    commandCenterNoResults: "Nenalezen žádný výsledek.",
    commandCenterActions: "Akce",
    commandCenterClose: "Zavřít Command Center",
    commandOpen: "Otevřít",
    commandGo: "Přejít",
    commandSections: "Sekce",
    commandTools: "Nástroje",
    commandKnowledge: "Znalosti",
    stratosApplications: "Aplikace STRATOS",
    appComingSoon: "Připravuje se",
    userMenu: "Uživatelské menu",
    settings: "Nastavení",
    logout: "Odhlásit",
    saved: "Uloženo",
    saving: "Ukládám",
    saveFailed: "Chyba uložení",
    workspaceTitle: "AKB pracovní plocha",
    workspaceSubtitle: "Dokumenty, workflow a znalosti",
    workspaceFooter: "STRATOS jednotné rozhraní",
    collapseSidebar: "Zasunout submenu",
    expandSidebar: "Rozbalit submenu",
    moduleDocuments: "Dokumenty",
    moduleOperations: "Provoz",
    moduleAi: "AI",
    moduleKnowledge: "Znalosti",
    moduleGovernance: "Dohled",
    groupWorkspace: "Pracovní plocha",
    groupDocuments: "Dokumenty",
    groupAi: "AI asistenti",
    groupKnowledge: "Znalosti",
    groupGovernance: "Dohled",
    allowedActions: "Povolené akce",
    healthOk: "Stav OK",
    apiModeMock: "Mock API režim",
    apiModeProduction: "Produkční API klienti",
    authModeMock: "dev auth",
    authModeOidc: "OIDC auth"
  },
  en: {
    assistantBrand: "Knowledge assistant",
    assistantSubtitle: "internal knowledge and procedures",
    serviceAvailable: "Service available",
    knowledgeManagement: "Knowledge management",
    help: "Help",
    searchPlaceholder: "Find document, version, citation, or audit event",
    commandCenterOpen: "Open Command Center",
    commandCenterTitle: "Command Center",
    commandCenterPlaceholder: "Search AKB or run an action",
    commandCenterPreview: "Select a result to open a page or run a quick action.",
    commandCenterNoResults: "No result found.",
    commandCenterActions: "Actions",
    commandCenterClose: "Close Command Center",
    commandOpen: "Open",
    commandGo: "Go",
    commandSections: "Sections",
    commandTools: "Tools",
    commandKnowledge: "Knowledge",
    stratosApplications: "STRATOS applications",
    appComingSoon: "Coming soon",
    userMenu: "User menu",
    settings: "Settings",
    logout: "Logout",
    saved: "Saved",
    saving: "Saving",
    saveFailed: "Save failed",
    workspaceTitle: "AKB workspace",
    workspaceSubtitle: "Documents, workflow and knowledge",
    workspaceFooter: "STRATOS unified interface",
    collapseSidebar: "Collapse submenu",
    expandSidebar: "Expand submenu",
    moduleDocuments: "Documents",
    moduleOperations: "Operations",
    moduleAi: "AI",
    moduleKnowledge: "Knowledge",
    moduleGovernance: "Governance",
    groupWorkspace: "Workspace",
    groupDocuments: "Documents",
    groupAi: "AI assistants",
    groupKnowledge: "Knowledge",
    groupGovernance: "Governance",
    allowedActions: "Allowed actions",
    healthOk: "Health OK",
    apiModeMock: "Mock API mode",
    apiModeProduction: "Production API clients",
    authModeMock: "dev auth",
    authModeOidc: "OIDC auth"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

type ShellModuleId = "documents" | "operations" | "ai" | "knowledge" | "governance";

const moduleRouteGroups: Record<ShellModuleId, string[]> = {
  documents: ["/documents", "/upload", "/ingestion"],
  operations: ["/", "/tasks"],
  ai: ["/chat", "/help"],
  knowledge: [],
  governance: ["/audit"]
};

const moduleRootRoutes: Record<ShellModuleId, string> = {
  documents: "/documents",
  operations: "/tasks",
  ai: "/chat",
  knowledge: "/chat",
  governance: "/audit"
};

interface AppShellProps {
  children: React.ReactNode;
  apiMode: "mock" | "production";
  authMode: "mock" | "oidc";
  initialUser?: {
    subjectId: string;
    roles: string[];
    groups: string[];
  } | null;
}

interface AklUserProfile {
  name: string;
  email?: string;
  initials: string;
  roles: string[];
}

interface SettingsAccessInfo {
  subjectId: string;
  roles: string[];
  groups: string[];
  permissions: string[];
}

interface ProfileSettingsPayload {
  subject_id?: string;
  settings?: {
    core?: Record<string, unknown>;
    apps?: {
      akb?: Record<string, unknown>;
    };
  };
  identity?: {
    subject_id?: string;
    display_name?: string;
    email?: string | null;
    roles?: unknown[];
    groups?: unknown[];
    permissions?: unknown[];
  };
}

const emptyRolePreview: RolePreviewSettings = {
  canUse: false,
  active: false,
  profileId: "",
  label: "",
  roles: [],
  profiles: []
};

export function AppShell({ children, apiMode, authMode, initialUser }: AppShellProps) {
  return (
    <LanguageProvider>
      <AppShellContent apiMode={apiMode} authMode={authMode} initialUser={initialUser}>{children}</AppShellContent>
    </LanguageProvider>
  );
}

function AppShellContent({ children, apiMode, authMode, initialUser }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { language, setLanguage } = useLanguage();
  const isEmbeddedPath = pathname === "/embed" || pathname.startsWith("/embed/") || pathname === "/akb/embed" || pathname.startsWith("/akb/embed/");
  const copy = shellCopy[language];
  const apiModeLabel = apiMode === "mock" ? copy.apiModeMock : copy.apiModeProduction;
  const authModeLabel = authMode === "mock" ? copy.authModeMock : copy.authModeOidc;
  const [activeModule, setActiveModule] = useState<ShellModuleId>(() => moduleForPath(pathname));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [commandCenterOpen, setCommandCenterOpen] = useState(false);
  const [commandCenterQuery, setCommandCenterQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMode, setSettingsMode] = useState<SettingsSurfaceMode>("modal");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [rolePreview, setRolePreview] = useState<RolePreviewSettings>(emptyRolePreview);
  const [savedRolePreviewProfileId, setSavedRolePreviewProfileId] = useState("");
  const [accessInfo, setAccessInfo] = useState<SettingsAccessInfo>(() => ({
    subjectId: initialUser?.subjectId ?? "",
    roles: initialUser?.roles ?? [],
    groups: initialUser?.groups ?? [],
    permissions: []
  }));
  const [userProfile, setUserProfile] = useState<AklUserProfile>(() => ({
    name: authMode === "mock" ? "AKB Dev User" : initialUser?.subjectId ?? "AKB",
    email: authMode === "mock" ? "dev@akl.local" : undefined,
    initials: authMode === "mock" ? "AD" : initialsFromName(initialUser?.subjectId ?? "AKB"),
    roles: initialUser?.roles ?? []
  }));
  const [settingsValues, setSettingsValues] = useState<StratosSettingsCoreValues>(() =>
    createSettingsValues({
      authModeLabel,
      language,
      user: {
        name: authMode === "mock" ? "AKB Dev User" : initialUser?.subjectId ?? "AKB",
        email: authMode === "mock" ? "dev@akl.local" : undefined,
        roles: initialUser?.roles ?? []
      }
    })
  );

  useEffect(() => {
    setActiveModule(moduleForPath(pathname));
    // Navigation closes the mobile drawer so the destination page is visible.
    setMobileSidebarOpen(false);
  }, [pathname]);

  const toggleMobileSidebar = () => {
    setMobileSidebarOpen((open) => {
      if (open) {
        return false;
      }
      // The desktop "collapsed" state hides the sidebar body — undo it so the
      // drawer always opens fully expanded on mobile.
      setSidebarCollapsed(false);
      return true;
    });
  };

  useEffect(() => {
    let active = true;
    fetch(withAppBasePath("/api/auth/session"), { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!active || !payload?.user) {
          return;
        }
        const name = String(payload.user.name || payload.user.email || payload.user.subjectId || "AKB");
        const email = typeof payload.user.email === "string" ? payload.user.email : undefined;
        const roles = Array.isArray(payload.user.roles) ? payload.user.roles.filter((role: unknown): role is string => typeof role === "string") : [];
        const groups = Array.isArray(payload.user.groups) ? payload.user.groups.filter((group: unknown): group is string => typeof group === "string") : [];
        setUserProfile({
          name,
          email,
          initials: initialsFromName(name),
          roles
        });
        setAccessInfo((current) => ({
          ...current,
          subjectId: typeof payload.user.subjectId === "string" ? payload.user.subjectId : current.subjectId,
          roles,
          groups
        }));
        if (payload.rolePreview) {
          const preview = normalizeRolePreview(payload.rolePreview);
          setRolePreview(preview);
          setSavedRolePreviewProfileId(preview.profileId);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const applyProfileSettings = useCallback(
    (payload: ProfileSettingsPayload) => {
      const identity = payload.identity ?? {};
      const roles = arrayOfStrings(identity.roles);
      const groups = arrayOfStrings(identity.groups);
      const permissions = arrayOfStrings(identity.permissions);
      const fallbackName =
        typeof identity.display_name === "string" && identity.display_name
          ? identity.display_name
          : typeof identity.email === "string" && identity.email
            ? identity.email
            : payload.subject_id ?? initialUser?.subjectId ?? "AKB";
      const fallbackUser: AklUserProfile = {
        name: fallbackName,
        email: typeof identity.email === "string" ? identity.email : undefined,
        initials: initialsFromName(fallbackName),
        roles: roles.length ? roles : initialUser?.roles ?? []
      };
      const nextValues = createSettingsValues({
        authModeLabel,
        language,
        user: fallbackUser
      });
      const mergedValues = settingsValuesFromCore(payload.settings?.core ?? {}, nextValues);
      const nextLanguage = mergedValues.language === "en" ? "en" : "cs";
      const nextName = typeof mergedValues.displayName === "string" && mergedValues.displayName ? mergedValues.displayName : fallbackUser.name;
      const nextEmail = typeof mergedValues.email === "string" && mergedValues.email ? mergedValues.email : undefined;

      setSettingsValues(mergedValues);
      setSettingsDirty(false);
      setUserProfile({
        name: nextName,
        email: nextEmail,
        initials: initialsFromName(nextName),
        roles: fallbackUser.roles
      });
      setAccessInfo({
        subjectId: typeof identity.subject_id === "string" ? identity.subject_id : payload.subject_id ?? initialUser?.subjectId ?? "",
        roles: fallbackUser.roles,
        groups,
        permissions
      });
      setLanguage(nextLanguage);
      const appMode = payload.settings?.apps?.akb?.settingsMode;
      if (isSettingsSurfaceMode(appMode)) {
        setSettingsMode(appMode);
      }
      const profileId = payload.settings?.apps?.akb?.rolePreviewProfileId;
      if (typeof profileId === "string" && rolePreview.canUse) {
        setRolePreview((current) => {
          const profile = current.profiles.find((item) => item.id === profileId);
          return {
            ...current,
            profileId,
            label: profile?.label ?? current.label,
            roles: profile?.roles ?? current.roles
          };
        });
      }
    },
    [authModeLabel, initialUser?.roles, initialUser?.subjectId, language, rolePreview.canUse, setLanguage]
  );

  const persistProfileSettings = useCallback(
    async (
      values: StratosSettingsCoreValues,
      options: { mode?: SettingsSurfaceMode; rolePreviewProfileId?: string } = {}
    ): Promise<ProfileSettingsPayload> => {
      const response = await fetch(withAppBasePath("/api/v1/profile/settings"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          settings: {
            core: values,
            apps: {
              akb: {
                settingsMode: options.mode ?? settingsMode,
                rolePreviewProfileId: options.rolePreviewProfileId ?? rolePreview.profileId
              }
            }
          }
        })
      });
      if (!response.ok) {
        throw new Error(`Profile settings save failed with ${response.status}`);
      }
      return await response.json() as ProfileSettingsPayload;
    },
    [rolePreview.profileId, settingsMode]
  );

  useEffect(() => {
    let active = true;
    fetch(withAppBasePath("/api/v1/profile/settings"), { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: ProfileSettingsPayload | null) => {
        if (!active || !payload) {
          return;
        }
        applyProfileSettings(payload);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [applyProfileSettings]);

  useEffect(() => {
    if (settingsDirty) {
      return;
    }
    setSettingsValues((current) => ({
      ...current,
      displayName: userProfile.name,
      email: userProfile.email ?? "",
      role: userProfile.roles.length > 0 ? userProfile.roles.join(", ") : authModeLabel,
      language
    }));
  }, [authModeLabel, language, settingsDirty, userProfile]);

  const handleRailSelect = () => {
    setSidebarCollapsed(false);
    setMobileSidebarOpen(false);
  };
  const railItems = [
    { id: "documents", href: moduleRootRoutes.documents, label: copy.moduleDocuments, icon: Database, onSelect: handleRailSelect },
    { id: "operations", href: moduleRootRoutes.operations, label: copy.moduleOperations, icon: ListChecks, onSelect: handleRailSelect },
    { id: "ai", href: moduleRootRoutes.ai, label: copy.moduleAi, icon: Bot, onSelect: handleRailSelect },
    { id: "governance", href: moduleRootRoutes.governance, label: copy.moduleGovernance, icon: ShieldCheck, onSelect: handleRailSelect }
  ];
  const activeRailHref = moduleRootRoutes[activeModule];
  const activeModuleLabel = railItems.find((item) => item.id === activeModule)?.label ?? copy.workspaceTitle;
  const activeModuleRoutes = moduleRouteGroups[activeModule];
  const activeSubmenuItem = navigation[language].find((item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href)));
  const activeTopbarContext = activeSubmenuItem?.label ?? activeModuleLabel;
  const activeModuleActions = useMemo(
    () => navigation[language].filter((item) => activeModuleRoutes.includes(item.href)).slice(0, 2),
    [activeModuleRoutes, language]
  );
  const workspaceGroups = useMemo<StratosWorkspaceNavGroup[]>(() => {
    const groupLabel = moduleGroupLabel(activeModule, copy);
    return [
      {
        id: activeModule,
        label: groupLabel,
        items: navigation[language]
          .filter((item) => activeModuleRoutes.includes(item.href))
          .map((item) => navItemToWorkspaceItem(item, pathname))
      }
    ];
  }, [activeModule, activeModuleRoutes, copy, language, pathname]);
  const commandCenterItems = useMemo<CommandCenterItem[]>(() => {
    const openRoute = (href: string) => {
      router.push(href);
      setCommandCenterOpen(false);
    };
    const navigationItems: CommandCenterItem[] = navigation[language].map((item) => {
      const Icon = item.icon;
      const moduleId = moduleForPath(item.href);
      return {
        id: `nav:${item.href}`,
        type: item.href === "/" ? "dashboard" : "action",
        title: item.label,
        subtitle: moduleGroupLabel(moduleId, copy),
        detail: item.href,
        section: copy.commandSections,
        icon: <Icon size={18} aria-hidden="true" />,
        tone: moduleTone(moduleId),
        keywords: [item.href, moduleId],
        primaryAction: {
          id: `open:${item.href}`,
          label: copy.commandOpen,
          hint: "Enter",
          onSelect: () => openRoute(item.href)
        },
        actions: [
          {
            id: `go:${item.href}`,
            label: copy.commandGo,
            hint: "Enter",
            onSelect: () => openRoute(item.href)
          }
        ]
      };
    });
    return [
      ...navigationItems,
      {
        id: "action:new-document",
        type: "action",
        title: language === "cs" ? "Založit dokument" : "Create document",
        subtitle: copy.moduleDocuments,
        detail: language === "cs" ? "Zadat metadata a pokračovat nahráním první verze." : "Enter metadata and continue by uploading the first version.",
        section: copy.commandTools,
        icon: <FilePlus2 size={18} aria-hidden="true" />,
        tone: "green",
        keywords: ["draft", "document", "koncept"],
        primaryAction: {
          id: "new-document",
          label: copy.commandOpen,
          hint: "Enter",
          onSelect: () => openRoute("/documents/new")
        }
      },
      {
        id: "action:upload",
        type: "action",
        title: language === "cs" ? "Nahrát verzi dokumentu" : "Upload document version",
        subtitle: copy.moduleDocuments,
        detail: language === "cs" ? "Vybrat originální soubor a spustit zpracování pro citace." : "Choose the original file and start citation processing.",
        section: copy.commandTools,
        icon: <FilePlus2 size={18} aria-hidden="true" />,
        tone: "blue",
        keywords: ["upload", "ingestion", "nahrat"],
        primaryAction: {
          id: "upload-document",
          label: copy.commandOpen,
          hint: "Enter",
          onSelect: () => openRoute("/upload")
        }
      },
      {
        id: "knowledge:chat",
        type: "report",
        title: language === "cs" ? "Dotaz se zdroji" : "Ask with citations",
        subtitle: copy.moduleKnowledge,
        detail: language === "cs" ? "Otevřít znalostní chat s citacemi." : "Open knowledge chat with citations.",
        section: copy.commandKnowledge,
        icon: <Bot size={18} aria-hidden="true" />,
        tone: "purple",
        keywords: ["rag", "citace", "citations", "chat"],
        primaryAction: {
          id: "open-chat",
          label: copy.commandOpen,
          hint: "Enter",
          onSelect: () => openRoute("/chat")
        }
      }
    ];
  }, [copy, language, router]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandCenterOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleLogout = () => {
    window.location.assign(withAppBasePath("/api/auth/logout"));
  };

  const handleSettingsValueChange = (key: StratosSettingsCoreValueKey, value: StratosSettingsCoreValue) => {
    setSettingsValues((current) => ({ ...current, [key]: value }));
    setSettingsDirty(true);
  };

  const handleSettingsModeChange = (mode: SettingsSurfaceMode) => {
    setSettingsMode(mode);
    setSettingsDirty(true);
  };

  const handleLanguageChange = async (nextLanguage: AklLanguage) => {
    const nextValues = { ...settingsValues, language: nextLanguage };
    setSettingsValues(nextValues);
    setLanguage(nextLanguage);
    try {
      const payload = await persistProfileSettings(nextValues, { mode: settingsMode, rolePreviewProfileId: rolePreview.profileId });
      applyProfileSettings(payload);
    } catch {
      setSettingsDirty(true);
    }
  };

  const handleRolePreviewChange = (profileId: string) => {
    const profile = rolePreview.profiles.find((item) => item.id === profileId);
    setRolePreview((current) => ({
      ...current,
      active: Boolean(profileId),
      profileId,
      label: profile?.label ?? "",
      roles: profile?.roles ?? []
    }));
    setSettingsDirty(true);
  };

  const handleSettingsSave = async () => {
    try {
      const savedProfile = await persistProfileSettings(settingsValues, {
        mode: settingsMode,
        rolePreviewProfileId: rolePreview.profileId
      });
      applyProfileSettings(savedProfile);
      if (rolePreview.canUse && rolePreview.profileId !== savedRolePreviewProfileId) {
        const response = await fetch(withAppBasePath("/api/auth/role-preview"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ profileId: rolePreview.profileId })
        }).catch(() => null);
        if (response?.ok) {
          window.location.reload();
          return;
        }
      }
      setSettingsDirty(false);
    } catch {
      setSettingsDirty(true);
    }
  };

  if (isEmbeddedPath) {
    return <main className="akb-embed-shell">{children}</main>;
  }

  if (isEmployeeChatOnly({ roles: userProfile.roles })) {
    return (
      <main className="akb-employee-portal-shell">
        <header className="akb-employee-portal-topbar">
          <Link className="akb-employee-portal-brand" href="/chat">
            <span className="akb-employee-portal-mark" aria-hidden="true">AKB</span>
            <span>
              <strong>{copy.assistantBrand}</strong>
              <small>{copy.assistantSubtitle}</small>
            </span>
          </Link>
          <div className="akb-employee-portal-actions">
            <button
              className="akb-chat-icon-button"
              type="button"
              onClick={() => setSettingsOpen(true)}
              title={copy.settings}
              aria-label={copy.settings}
            >
              <UserRound size={16} aria-hidden="true" />
            </button>
            <button className="akb-chat-icon-button" type="button" onClick={handleLogout} title={copy.logout} aria-label={copy.logout}>
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
        {children}
        {settingsOpen ? (
          <AppSettingsSurface
            apiModeLabel={apiModeLabel}
            authModeLabel={authModeLabel}
            dirty={settingsDirty}
            language={language}
            mode={settingsMode}
            onClose={() => setSettingsOpen(false)}
            onLogout={handleLogout}
            onModeChange={handleSettingsModeChange}
            onRolePreviewChange={handleRolePreviewChange}
            onSave={handleSettingsSave}
            onValueChange={handleSettingsValueChange}
            accessInfo={accessInfo}
            rolePreview={rolePreview}
            userInitials={userProfile.initials}
            values={settingsValues}
          />
        ) : null}
      </main>
    );
  }

  return (
    <StratosAppShell
      sidebarCollapsed={sidebarCollapsed}
      mobileSidebarOpen={mobileSidebarOpen}
      onMobileSidebarClose={() => setMobileSidebarOpen(false)}
      rail={
        <StratosAppRail
          activePathname={activeRailHref}
          brandHref="/"
          brandMark="AKB"
          brandName="AKB Platform"
          brandSubtitle="AI Knowledge Base"
          items={railItems}
          footer={
            <>
              <div className="health-dot" aria-hidden="true" />
              <span>{apiModeLabel} · {authModeLabel}</span>
            </>
          }
        />
      }
      sidebar={
        <StratosWorkspaceSidebar
          title={activeModuleLabel}
          subtitle={copy.workspaceSubtitle}
          collapsed={sidebarCollapsed}
          footer={copy.workspaceFooter}
          headerActions={
            <div className="stratos-sidebar-hover-actions" aria-label={copy.allowedActions}>
              {activeModuleActions.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    className="stratos-sidebar-action stratos-sidebar-action-link"
                    href={item.href}
                    key={item.href}
                    title={item.label}
                    aria-label={item.label}
                    onClick={() => {
                      setSidebarCollapsed(false);
                      setMobileSidebarOpen(false);
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </Link>
                );
              })}
              <button
                className="stratos-sidebar-action"
                type="button"
                aria-label={sidebarCollapsed ? copy.expandSidebar : copy.collapseSidebar}
                title={sidebarCollapsed ? copy.expandSidebar : copy.collapseSidebar}
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              >
                {sidebarCollapsed ? <ChevronsRight size={16} aria-hidden="true" /> : <ChevronsLeft size={16} aria-hidden="true" />}
              </button>
            </div>
          }
        >
          {/* Mobile-only: section switcher that replaces the hidden AppRail on small screens */}
          <nav className="sidebar-mobile-sections" aria-label={language === "cs" ? "Moduly AKB" : "AKB modules"}>
            {railItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`sidebar-mobile-section-btn${activeModule === item.id ? " is-active" : ""}`}
                  aria-current={activeModule === item.id ? "true" : undefined}
                  onClick={() => {
                    setSidebarCollapsed(false);
                    setMobileSidebarOpen(false);
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <StratosWorkspaceNav
            key={activeModule}
            groups={workspaceGroups}
            ariaLabel={language === "cs" ? "Navigace pracovní plochy" : "Workspace navigation"}
            onNavigate={() => setMobileSidebarOpen(false)}
          />
        </StratosWorkspaceSidebar>
      }
      topbar={
        <>
          <ProjectTopbar
            apiModeLabel={apiModeLabel}
            authModeLabel={authModeLabel}
            commandCenterLabel={copy.commandCenterOpen}
            commandCenterPlaceholder={copy.commandCenterPlaceholder}
            healthLabel={copy.healthOk}
            labels={{
              applications: copy.stratosApplications,
              appComingSoon: copy.appComingSoon,
              logout: copy.logout,
              saved: copy.saved,
              saveFailed: copy.saveFailed,
              saving: copy.saving,
              settings: copy.settings,
              userMenu: copy.userMenu
            }}
            language={language}
            onCommandCenterOpen={() => setCommandCenterOpen(true)}
            onLanguageChange={handleLanguageChange}
            onLogout={handleLogout}
            mobileMenuOpen={mobileSidebarOpen}
            onMobileMenuOpen={toggleMobileSidebar}
            onSettingsOpen={() => setSettingsOpen(true)}
            projectName={activeTopbarContext}
            user={userProfile}
            workspaceName={activeModuleLabel}
          />
          <CommandCenter
            open={commandCenterOpen}
            query={commandCenterQuery}
            items={commandCenterItems}
            labels={{
              title: copy.commandCenterTitle,
              placeholder: copy.commandCenterPlaceholder,
              noResults: copy.commandCenterNoResults,
              open: copy.commandCenterOpen,
              close: copy.commandCenterClose,
              actions: copy.commandCenterActions,
              preview: copy.commandCenterPreview
            }}
            onQueryChange={setCommandCenterQuery}
            onClose={() => setCommandCenterOpen(false)}
          />
          {settingsOpen ? (
            <AppSettingsSurface
              apiModeLabel={apiModeLabel}
              authModeLabel={authModeLabel}
              dirty={settingsDirty}
              language={language}
              mode={settingsMode}
              onClose={() => setSettingsOpen(false)}
              onLogout={handleLogout}
              onModeChange={handleSettingsModeChange}
              onRolePreviewChange={handleRolePreviewChange}
              onSave={handleSettingsSave}
              onValueChange={handleSettingsValueChange}
              accessInfo={accessInfo}
              rolePreview={rolePreview}
              userInitials={userProfile.initials}
              values={settingsValues}
            />
          ) : null}
        </>
      }
    >
      {children}
    </StratosAppShell>
  );

}

function moduleTone(moduleId: ShellModuleId): CommandCenterItem["tone"] {
  if (moduleId === "documents") {
    return "blue";
  }
  if (moduleId === "ai") {
    return "purple";
  }
  if (moduleId === "knowledge") {
    return "purple";
  }
  if (moduleId === "governance") {
    return "amber";
  }
  return "green";
}

function normalizeRolePreview(value: unknown): RolePreviewSettings {
  const input = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const profiles = Array.isArray(input.profiles)
    ? input.profiles
        .filter((profile): profile is Record<string, unknown> => typeof profile === "object" && profile !== null)
        .map((profile) => ({
          id: String(profile.id ?? ""),
          label: String(profile.label ?? ""),
          description: String(profile.description ?? ""),
          roles: Array.isArray(profile.roles) ? profile.roles.filter((role): role is string => typeof role === "string") : []
        }))
        .filter((profile) => profile.id && profile.label)
    : [];
  const profileId = typeof input.profileId === "string" ? input.profileId : "";
  const selectedProfile = profiles.find((profile) => profile.id === profileId);
  return {
    canUse: Boolean(input.canUse),
    active: Boolean(input.active),
    profileId,
    label: typeof input.label === "string" ? input.label : selectedProfile?.label ?? "",
    roles: Array.isArray(input.roles) ? input.roles.filter((role): role is string => typeof role === "string") : selectedProfile?.roles ?? [],
    profiles
  };
}

function settingsValuesFromCore(
  core: Record<string, unknown>,
  fallback: StratosSettingsCoreValues
): StratosSettingsCoreValues {
  return {
    displayName: stringSetting(core.displayName, fallback.displayName),
    email: stringSetting(core.email, fallback.email),
    role: stringSetting(core.role, fallback.role),
    language: core.language === "en" ? "en" : "cs",
    theme: stringSetting(core.theme, stringSetting(fallback.theme, "system")),
    accent: stringSetting(core.accent, stringSetting(fallback.accent, "teal")),
    highContrast: booleanSetting(core.highContrast, booleanSetting(fallback.highContrast, false)),
    timezone: stringSetting(core.timezone, stringSetting(fallback.timezone, "Europe/Prague")),
    notifyTimezone: booleanSetting(core.notifyTimezone, booleanSetting(fallback.notifyTimezone, true)),
    weekStart: stringSetting(core.weekStart, stringSetting(fallback.weekStart, "monday")),
    timeFormat: stringSetting(core.timeFormat, stringSetting(fallback.timeFormat, "24h")),
    dateFormat: stringSetting(core.dateFormat, stringSetting(fallback.dateFormat, "dd.mm.yyyy")),
    compactMode: booleanSetting(core.compactMode, booleanSetting(fallback.compactMode, false)),
    commandHints: booleanSetting(core.commandHints, booleanSetting(fallback.commandHints, true)),
    flyoutToasts: booleanSetting(core.flyoutToasts, booleanSetting(fallback.flyoutToasts, true)),
    markdown: booleanSetting(core.markdown, booleanSetting(fallback.markdown, true)),
    keyboardShortcuts: booleanSetting(core.keyboardShortcuts, booleanSetting(fallback.keyboardShortcuts, true))
  };
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isSettingsSurfaceMode(value: unknown): value is SettingsSurfaceMode {
  return value === "modal" || value === "sidebar" || value === "fullscreen";
}

function moduleForPath(pathname: string): ShellModuleId {
  const entry = (Object.entries(moduleRouteGroups) as Array<[ShellModuleId, string[]]>).find(([, routes]) =>
    routes.some((route) => pathname === route || (route !== "/" && pathname.startsWith(route)))
  );
  return entry?.[0] ?? "operations";
}

function moduleGroupLabel(moduleId: ShellModuleId, copy: Record<string, string>) {
  if (moduleId === "documents") {
    return copy.groupDocuments;
  }
  if (moduleId === "ai") {
    return copy.groupAi;
  }
  if (moduleId === "knowledge") {
    return copy.groupKnowledge;
  }
  if (moduleId === "governance") {
    return copy.groupGovernance;
  }
  return copy.groupWorkspace;
}

function createSettingsValues({
  authModeLabel,
  language,
  user
}: {
  authModeLabel: string;
  language: AklLanguage;
  user: Pick<AklUserProfile, "name" | "email" | "roles">;
}): StratosSettingsCoreValues {
  return {
    displayName: user.name,
    email: user.email ?? "",
    role: user.roles.length > 0 ? user.roles.join(", ") : authModeLabel,
    language,
    theme: "system",
    accent: "teal",
    highContrast: false,
    timezone: "Europe/Prague",
    notifyTimezone: true,
    weekStart: "monday",
    timeFormat: "24h",
    dateFormat: "dd.mm.yyyy",
    compactMode: false,
    commandHints: true,
    flyoutToasts: true,
    markdown: true,
    keyboardShortcuts: true
  };
}

function navItemToWorkspaceItem(
  item: (typeof navigation)[AklLanguage][number],
  pathname: string
): StratosWorkspaceNavGroup["items"][number] {
  const Icon = item.icon;
  return {
    id: item.href,
    href: withAppBasePath(item.href),
    label: item.label,
    icon: <Icon size={16} aria-hidden="true" />,
    active: pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
  };
}

function initialsFromName(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .split(/[\s._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return "AK";
  }
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
