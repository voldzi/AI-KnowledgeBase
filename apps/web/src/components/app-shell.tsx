"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
  ShieldCheck,
  UserRound
} from "lucide-react";

import {
  AppSettingsSurface,
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
    { href: "/assistant", label: "Asistent pro zaměstnance", icon: UserRound },
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
    { href: "/assistant", label: "Employee assistant", icon: UserRound },
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
  ai: ["/assistant", "/chat", "/help"],
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
}

interface AklUserProfile {
  name: string;
  email?: string;
  initials: string;
  roles: string[];
}

export function AppShell({ children, apiMode, authMode }: AppShellProps) {
  return (
    <LanguageProvider>
      <AppShellContent apiMode={apiMode} authMode={authMode}>{children}</AppShellContent>
    </LanguageProvider>
  );
}

function AppShellContent({ children, apiMode, authMode }: AppShellProps) {
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
  const [userProfile, setUserProfile] = useState<AklUserProfile>(() => ({
    name: authMode === "mock" ? "AKB Dev User" : "AKB",
    email: authMode === "mock" ? "dev@akl.local" : undefined,
    initials: authMode === "mock" ? "AD" : "AK",
    roles: []
  }));
  const [settingsValues, setSettingsValues] = useState<StratosSettingsCoreValues>(() =>
    createSettingsValues({
      authModeLabel,
      language,
      user: {
        name: authMode === "mock" ? "AKB Dev User" : "AKB",
        email: authMode === "mock" ? "dev@akl.local" : undefined,
        roles: []
      }
    })
  );

  useEffect(() => {
    setActiveModule(moduleForPath(pathname));
    // Navigation closes the mobile drawer so the destination page is visible.
    setMobileSidebarOpen(false);
  }, [pathname]);

  const openMobileSidebar = () => {
    // The desktop "collapsed" state hides the sidebar body — undo it so the
    // drawer always opens fully expanded on mobile.
    setSidebarCollapsed(false);
    setMobileSidebarOpen(true);
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
        setUserProfile({
          name,
          email,
          initials: initialsFromName(name),
          roles
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (settingsDirty) {
      return;
    }
    setSettingsValues(createSettingsValues({ authModeLabel, language, user: userProfile }));
  }, [authModeLabel, language, settingsDirty, userProfile]);

  const railItems = [
    { id: "documents", href: moduleRootRoutes.documents, label: copy.moduleDocuments, icon: Database },
    { id: "operations", href: moduleRootRoutes.operations, label: copy.moduleOperations, icon: ListChecks },
    { id: "ai", href: moduleRootRoutes.ai, label: copy.moduleAi, icon: Bot },
    { id: "governance", href: moduleRootRoutes.governance, label: copy.moduleGovernance, icon: ShieldCheck }
  ].map((item) => ({
    ...item,
    onSelect: () => {
      selectShellModule(item.id as ShellModuleId, { keepMobileSidebarOpen: false });
    }
  }));
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

  const handleSettingsSave = () => {
    if (settingsValues.language === "cs" || settingsValues.language === "en") {
      setLanguage(settingsValues.language);
    }
    setSettingsDirty(false);
  };

  if (isEmbeddedPath) {
    return <main className="akb-embed-shell">{children}</main>;
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
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-mobile-section-btn${activeModule === item.id ? " is-active" : ""}`}
                  aria-current={activeModule === item.id ? "true" : undefined}
                  onClick={() => {
                    selectShellModule(item.id as ShellModuleId, { keepMobileSidebarOpen: true });
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                  {item.label}
                </button>
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
            onLanguageChange={setLanguage}
            onLogout={handleLogout}
            onMobileMenuOpen={openMobileSidebar}
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
              onModeChange={setSettingsMode}
              onSave={handleSettingsSave}
              onValueChange={handleSettingsValueChange}
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

  function selectShellModule(moduleId: ShellModuleId, { keepMobileSidebarOpen }: { keepMobileSidebarOpen: boolean }) {
    setActiveModule(moduleId);
    setSidebarCollapsed(false);
    setMobileSidebarOpen(keepMobileSidebarOpen);
  }
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
