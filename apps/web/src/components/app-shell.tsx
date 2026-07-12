"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Bot,
  CircleHelp,
  Database,
  FileClock,
  FilePlus2,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  Network,
  ShieldCheck,
  UserCog,
  UserRound,
} from "lucide-react";
import {
  AppRail,
  AppShell as StratosUiAppShell,
  CommandCenter,
  WorkspaceNav,
  WorkspaceSidebar,
  broadcastStratosProfileSettingsUpdate,
  createStratosProfileSettingsClient,
  createStratosProfileSettingsPayload,
  mergeStratosProfileSettings,
  subscribeStratosProfileSettingsUpdate,
  useRailSectionSidebarController,
  type AppRailItem,
  type CommandCenterItem,
  type StratosProfileSettingsEnvelope,
  type WorkspaceNavGroup,
} from "@voldzi/stratos-ui";

import {
  canAccessWorkspaceRoute,
  isEmployeeChatOnly,
} from "@/lib/auth/authorization";
import {
  AppSettingsSurface,
  type RolePreviewSettings,
  type SettingsSurfaceMode,
  type StratosSettingsCoreValue,
  type StratosSettingsCoreValueKey,
  type StratosSettingsCoreValues,
} from "@/components/app-settings-surface";
import { ProjectTopbar } from "@/components/project-topbar";
import { withAppBasePath } from "@/lib/app-url";
import { LanguageProvider, useLanguage, type AklLanguage } from "@/lib/i18n";

const navigation = {
  cs: [
    { href: "/dashboard", label: "Přehled", icon: LayoutDashboard },
    { href: "/tasks", label: "Úkoly", icon: ListChecks },
    { href: "/documents", label: "Dokumenty", icon: Database },
    { href: "/ingestion", label: "Zpracování", icon: FileClock },
    { href: "/chat", label: "Znalostní chat", icon: Bot },
    { href: "/intelligence", label: "Intelligence", icon: Network },
    { href: "/intelligence/quality", label: "Kvalita vyhledávání", icon: FlaskConical },
    { href: "/audit", label: "Audit", icon: ShieldCheck },
    { href: "/admin", label: "Administrace", icon: UserCog },
    { href: "/help", label: "Nápověda", icon: CircleHelp },
  ],
  en: [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/tasks", label: "Tasks", icon: ListChecks },
    { href: "/documents", label: "Documents", icon: Database },
    { href: "/ingestion", label: "Ingestion", icon: FileClock },
    { href: "/chat", label: "Knowledge chat", icon: Bot },
    { href: "/intelligence", label: "Intelligence", icon: Network },
    { href: "/intelligence/quality", label: "Retrieval quality", icon: FlaskConical },
    { href: "/audit", label: "Audit", icon: ShieldCheck },
    { href: "/admin", label: "Administration", icon: UserCog },
    { href: "/help", label: "Help", icon: CircleHelp },
  ],
} satisfies Record<
  AklLanguage,
  Array<{ href: string; label: string; icon: typeof UserRound }>
>;

const sidebarOverlayMediaQuery = "(max-width: 1280px)";

function subscribeSidebarOverlay(onChange: () => void) {
  const mediaQuery = window.matchMedia(sidebarOverlayMediaQuery);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

function getSidebarOverlaySnapshot() {
  return window.matchMedia(sidebarOverlayMediaQuery).matches;
}

function getServerSidebarOverlaySnapshot() {
  // Closed is the safer initial state for mobile SSR; desktop is activated
  // immediately after hydration without a visual layout change.
  return true;
}

const shellCopy = {
  cs: {
    assistantBrand: "Znalostní asistent",
    assistantSubtitle: "interní znalosti a postupy",
    serviceAvailable: "Služba dostupná",
    knowledgeManagement: "Správa znalostí",
    help: "Nápověda",
    searchPlaceholder: "Najít sekci nebo spustit povolenou akci",
    commandCenterOpen: "Otevřít Command Center",
    commandCenterTitle: "Command Center",
    commandCenterPlaceholder: "Najít sekci nebo spustit povolenou akci",
    commandCenterPreview:
      "Vyberte výsledek pro rychlé otevření nebo spuštění akce.",
    commandCenterNoResults: "Nenalezen žádný výsledek.",
    commandCenterActions: "Akce",
    commandCenterClose: "Zavřít Command Center",
    commandOpen: "Otevřít",
    commandGo: "Přejít",
    commandSections: "Sekce",
    commandTools: "Nástroje",
    commandKnowledge: "Znalosti",
    stratosApplications: "Aplikace STRATOS",
    userMenu: "Uživatelské menu",
    settings: "Nastavení",
    logout: "Odhlásit",
    saved: "Uloženo",
    saving: "Ukládám",
    saveFailed: "Chyba uložení",
    workspaceTitle: "AKB pracovní plocha",
    workspaceSubtitle: "Dokumenty, workflow a znalosti",
    workspaceFooter: "STRATOS jednotné rozhraní",
    closeSidebar: "Zavřít navigaci",
    moduleDocuments: "Dokumenty",
    moduleOperations: "Provoz",
    moduleAi: "AI",
    moduleKnowledge: "Znalosti",
    moduleIntelligence: "Intelligence",
    moduleGovernance: "Dohled",
    groupWorkspace: "Pracovní plocha",
    groupDocuments: "Dokumenty",
    groupAi: "AI asistenti",
    groupKnowledge: "Znalosti",
    groupIntelligence: "Analytika",
    groupGovernance: "Dohled",
    healthOk: "Stav systému",
    apiModeMock: "Mock API režim",
    apiModeProduction: "Produkční API klienti",
    authModeMock: "dev auth",
    authModeOidc: "OIDC auth",
  },
  en: {
    assistantBrand: "Knowledge assistant",
    assistantSubtitle: "internal knowledge and procedures",
    serviceAvailable: "Service available",
    knowledgeManagement: "Knowledge management",
    help: "Help",
    searchPlaceholder: "Find a section or run an allowed action",
    commandCenterOpen: "Open Command Center",
    commandCenterTitle: "Command Center",
    commandCenterPlaceholder: "Find a section or run an allowed action",
    commandCenterPreview:
      "Select a result to open a page or run a quick action.",
    commandCenterNoResults: "No result found.",
    commandCenterActions: "Actions",
    commandCenterClose: "Close Command Center",
    commandOpen: "Open",
    commandGo: "Go",
    commandSections: "Sections",
    commandTools: "Tools",
    commandKnowledge: "Knowledge",
    stratosApplications: "STRATOS applications",
    userMenu: "User menu",
    settings: "Settings",
    logout: "Logout",
    saved: "Saved",
    saving: "Saving",
    saveFailed: "Save failed",
    workspaceTitle: "AKB workspace",
    workspaceSubtitle: "Documents, workflow and knowledge",
    workspaceFooter: "STRATOS unified interface",
    closeSidebar: "Close navigation",
    moduleDocuments: "Documents",
    moduleOperations: "Operations",
    moduleAi: "AI",
    moduleKnowledge: "Knowledge",
    moduleIntelligence: "Intelligence",
    moduleGovernance: "Governance",
    groupWorkspace: "Workspace",
    groupDocuments: "Documents",
    groupAi: "AI assistants",
    groupKnowledge: "Knowledge",
    groupIntelligence: "Analytics",
    groupGovernance: "Governance",
    healthOk: "System status",
    apiModeMock: "Mock API mode",
    apiModeProduction: "Production API clients",
    authModeMock: "dev auth",
    authModeOidc: "OIDC auth",
  },
} satisfies Record<AklLanguage, Record<string, string>>;

type ShellModuleId =
  "documents" | "operations" | "ai" | "knowledge" | "intelligence" | "governance";

const moduleRouteGroups: Record<ShellModuleId, string[]> = {
  documents: ["/documents", "/upload", "/ingestion"],
  operations: ["/dashboard", "/tasks", "/"],
  ai: ["/chat", "/help"],
  knowledge: [],
  intelligence: ["/intelligence", "/intelligence/quality"],
  governance: ["/audit", "/admin"],
};

const moduleRootRoutes: Record<ShellModuleId, string> = {
  documents: "/documents",
  operations: "/dashboard",
  ai: "/chat",
  knowledge: "/chat",
  intelligence: "/intelligence",
  governance: "/audit",
};

interface AppShellProps {
  children: React.ReactNode;
  apiMode: "mock" | "production";
  authMode: "mock" | "oidc";
  initialUser?: {
    subjectId: string;
    roles: string[];
    groups: string[];
    capabilities?: string[];
  } | null;
}

interface AklUserProfile {
  name: string;
  email?: string;
  initials: string;
  roles: string[];
  capabilities: string[];
  avatarColor?: string;
  avatarId?: string;
  avatarImageUrl?: string;
}

interface SettingsAccessInfo {
  subjectId: string;
  roles: string[];
  capabilities: string[];
  groups: string[];
  permissions: string[];
}

interface ProfileSettingsPayload extends StratosProfileSettingsEnvelope {
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
    capabilities?: unknown[];
  };
}

const emptyRolePreview: RolePreviewSettings = {
  canUse: false,
  active: false,
  profileId: "",
  label: "",
  roles: [],
  profiles: [],
};

const avatarColors: Record<string, string> = {
  amber: "#b45309",
  blue: "#2563eb",
  emerald: "#15803d",
  graphite: "#111827",
  rose: "#be123c",
  slate: "#475569",
  teal: "#0f8c7f",
  violet: "#7c3aed",
};

export function AppShell({
  children,
  apiMode,
  authMode,
  initialUser,
}: AppShellProps) {
  return (
    <LanguageProvider>
      <AppShellContent
        apiMode={apiMode}
        authMode={authMode}
        initialUser={initialUser}
      >
        {children}
      </AppShellContent>
    </LanguageProvider>
  );
}

function AppShellContent({
  children,
  apiMode,
  authMode,
  initialUser,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { language, setLanguage } = useLanguage();
  const isEmbeddedPath =
    pathname === "/embed" ||
    pathname.startsWith("/embed/") ||
    pathname === "/akb/embed" ||
    pathname.startsWith("/akb/embed/");
  const copy = shellCopy[language];
  const apiModeLabel =
    apiMode === "mock" ? copy.apiModeMock : copy.apiModeProduction;
  const authModeLabel =
    authMode === "mock" ? copy.authModeMock : copy.authModeOidc;
  const [activeModule, setActiveModule] = useState<ShellModuleId>(() =>
    moduleForPath(pathname),
  );
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [overlaySidebarOpen, setOverlaySidebarOpen] = useState(false);
  const sidebarOverlay = useSyncExternalStore(
    subscribeSidebarOverlay,
    getSidebarOverlaySnapshot,
    getServerSidebarOverlaySnapshot,
  );
  const shellSidebarOpen = sidebarOverlay
    ? overlaySidebarOpen
    : desktopSidebarOpen;
  const handleSidebarOpenChange = useCallback(
    (open: boolean) => {
      if (sidebarOverlay) {
        setOverlaySidebarOpen(open);
        return;
      }
      setDesktopSidebarOpen(open);
    },
    [sidebarOverlay],
  );
  const railSidebar = useRailSectionSidebarController<ShellModuleId>({
    activeSectionId: activeModule,
    sidebarOpen: shellSidebarOpen,
    onSectionChange: setActiveModule,
    onSidebarOpenChange: handleSidebarOpenChange,
    desktopBehavior: "toggle-active",
    mobileBehavior: "open-sidebar",
    overlayMediaQuery: sidebarOverlayMediaQuery,
  });
  const [commandCenterOpen, setCommandCenterOpen] = useState(false);
  const [commandCenterQuery, setCommandCenterQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMode, setSettingsMode] =
    useState<SettingsSurfaceMode>("modal");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(
    null,
  );
  const [rolePreview, setRolePreview] =
    useState<RolePreviewSettings>(emptyRolePreview);
  const [savedRolePreviewProfileId, setSavedRolePreviewProfileId] =
    useState("");
  const profileSettingsClient = useMemo(
    () =>
      createStratosProfileSettingsClient({
        endpoint: withAppBasePath("/api/v1/profile/settings"),
        credentials: "same-origin",
      }),
    [],
  );
  const [accessInfo, setAccessInfo] = useState<SettingsAccessInfo>(() => ({
    subjectId: initialUser?.subjectId ?? "",
    roles: initialUser?.roles ?? [],
    capabilities: initialUser?.capabilities ?? [],
    groups: initialUser?.groups ?? [],
    permissions: [],
  }));
  const [userProfile, setUserProfile] = useState<AklUserProfile>(() => ({
    name:
      authMode === "mock" ? "AKB Dev User" : (initialUser?.subjectId ?? "AKB"),
    email: authMode === "mock" ? "dev@akl.local" : undefined,
    initials:
      authMode === "mock"
        ? "AD"
        : initialsFromName(initialUser?.subjectId ?? "AKB"),
    roles: initialUser?.roles ?? [],
    capabilities: initialUser?.capabilities ?? [],
  }));
  const [settingsValues, setSettingsValues] =
    useState<StratosSettingsCoreValues>(() =>
      createSettingsValues({
        authModeLabel,
        language,
        user: {
          name:
            authMode === "mock"
              ? "AKB Dev User"
              : (initialUser?.subjectId ?? "AKB"),
          email: authMode === "mock" ? "dev@akl.local" : undefined,
          roles: initialUser?.roles ?? [],
        },
      }),
    );
  useEffect(() => {
    setActiveModule(moduleForPath(pathname));
    railSidebar.closeSidebarAfterNavigation();
  }, [pathname, railSidebar.closeSidebarAfterNavigation]);

  useEffect(() => {
    let active = true;
    fetch(withAppBasePath("/api/auth/session"), { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!active || !payload?.user) {
          return;
        }
        const name = String(
          payload.user.name ||
            payload.user.email ||
            payload.user.subjectId ||
            "AKB",
        );
        const email =
          typeof payload.user.email === "string"
            ? payload.user.email
            : undefined;
        const roles = Array.isArray(payload.user.roles)
          ? payload.user.roles.filter(
              (role: unknown): role is string => typeof role === "string",
            )
          : [];
        const groups = Array.isArray(payload.user.groups)
          ? payload.user.groups.filter(
              (group: unknown): group is string => typeof group === "string",
            )
          : [];
        const capabilities = Array.isArray(payload.user.capabilities)
          ? payload.user.capabilities.filter(
              (capability: unknown): capability is string => typeof capability === "string",
            )
          : [];
        setUserProfile({
          name,
          email,
          initials: initialsFromName(name),
          roles,
          capabilities,
        });
        setAccessInfo((current) => ({
          ...current,
          subjectId:
            typeof payload.user.subjectId === "string"
              ? payload.user.subjectId
              : current.subjectId,
          roles,
          capabilities,
          groups,
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
      const capabilities = arrayOfStrings(identity.capabilities);
      const fallbackName =
        typeof identity.display_name === "string" && identity.display_name
          ? identity.display_name
          : typeof identity.email === "string" && identity.email
            ? identity.email
            : (payload.subject_id ?? initialUser?.subjectId ?? "AKB");
      const fallbackUser: AklUserProfile = {
        name: fallbackName,
        email: typeof identity.email === "string" ? identity.email : undefined,
        initials: initialsFromName(fallbackName),
        roles: roles.length ? roles : (initialUser?.roles ?? []),
        capabilities: capabilities.length ? capabilities : (initialUser?.capabilities ?? []),
      };
      const nextValues = createSettingsValues({
        authModeLabel,
        language,
        user: fallbackUser,
      });
      const mergedProfileSettings = mergeStratosProfileSettings(
        payload,
        "akb",
        {
          accent: ["accentColor"],
          language: ["locale"],
        },
      );
      const mergedValues = settingsValuesFromCore(
        mergedProfileSettings,
        nextValues,
      );
      const nextLanguage = mergedValues.language === "en" ? "en" : "cs";
      const nextName =
        typeof mergedValues.displayName === "string" && mergedValues.displayName
          ? mergedValues.displayName
          : fallbackUser.name;
      const nextEmail =
        typeof mergedValues.email === "string" && mergedValues.email
          ? mergedValues.email
          : undefined;
      const avatarId =
        typeof mergedValues.avatarId === "string"
          ? mergedValues.avatarId
          : "teal";
      const avatarImageUrl =
        typeof mergedValues.avatarImageUrl === "string"
          ? mergedValues.avatarImageUrl
          : "";
      const avatarColor =
        typeof mergedValues.avatarColor === "string" && mergedValues.avatarColor
          ? avatarColorForValue(mergedValues.avatarColor)
          : avatarColorForValue(avatarId);

      setSettingsValues(mergedValues);
      setSettingsDirty(false);
      setSettingsSaveError(null);
      setUserProfile({
        name: nextName,
        email: nextEmail,
        initials: initialsFromName(nextName),
        roles: fallbackUser.roles,
        capabilities: fallbackUser.capabilities,
        avatarColor,
        avatarId,
        avatarImageUrl,
      });
      setAccessInfo({
        subjectId:
          typeof identity.subject_id === "string"
            ? identity.subject_id
            : (payload.subject_id ?? initialUser?.subjectId ?? ""),
        roles: fallbackUser.roles,
        capabilities: fallbackUser.capabilities,
        groups,
        permissions,
      });
      setLanguage(nextLanguage);
      const appMode = mergedProfileSettings.settingsMode;
      if (isSettingsSurfaceMode(appMode)) {
        setSettingsMode(appMode);
      }
      const profileId = mergedProfileSettings.rolePreviewProfileId;
      if (typeof profileId === "string") {
        setRolePreview((current) => {
          if (!current.canUse) {
            return current;
          }
          const profile = current.profiles.find(
            (item) => item.id === profileId,
          );
          return {
            ...current,
            profileId,
            label: profile?.label ?? (profileId ? current.label : ""),
            roles: profile?.roles ?? (profileId ? current.roles : []),
          };
        });
      }
    },
    [
      authModeLabel,
      initialUser?.roles,
      initialUser?.subjectId,
      language,
      rolePreview.canUse,
      setLanguage,
    ],
  );

  const persistProfileSettings = useCallback(
    async (
      values: StratosSettingsCoreValues,
      options: {
        mode?: SettingsSurfaceMode;
        rolePreviewProfileId?: string;
      } = {},
    ): Promise<ProfileSettingsPayload> => {
      const core = settingsCoreForPayload(values);
      const saved = await profileSettingsClient.save(
        createStratosProfileSettingsPayload(core, "akb", {
          settingsMode: options.mode ?? settingsMode,
          rolePreviewProfileId:
            options.rolePreviewProfileId ?? rolePreview.profileId,
        }),
      );
      broadcastStratosProfileSettingsUpdate({
        accent: typeof core.accent === "string" ? core.accent : undefined,
        avatarImageUrl:
          typeof core.avatarImageUrl === "string"
            ? core.avatarImageUrl
            : undefined,
        displayName:
          typeof core.displayName === "string" ? core.displayName : undefined,
        email: typeof core.email === "string" ? core.email : undefined,
        language: typeof core.language === "string" ? core.language : undefined,
        source: "akb",
        themeColor:
          typeof core.accentColor === "string" ? core.accentColor : undefined,
      });
      return saved as ProfileSettingsPayload;
    },
    [profileSettingsClient, rolePreview.profileId, settingsMode],
  );

  useEffect(() => {
    let active = true;
    profileSettingsClient
      .get()
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
  }, [applyProfileSettings, profileSettingsClient]);

  useEffect(() => {
    const refreshProfile = () => {
      void profileSettingsClient
        .get()
        .then((payload) =>
          applyProfileSettings(payload as ProfileSettingsPayload),
        )
        .catch(() => undefined);
    };
    const unsubscribe = subscribeStratosProfileSettingsUpdate((update) => {
      if (update.source !== "akb") {
        refreshProfile();
      }
    });
    const handleFocus = () => refreshProfile();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshProfile();
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [applyProfileSettings, profileSettingsClient]);

  useEffect(() => {
    if (settingsDirty) {
      return;
    }
    setSettingsValues((current) => ({
      ...current,
      displayName: userProfile.name,
      email: userProfile.email ?? "",
      role:
        userProfile.roles.length > 0
          ? userProfile.roles.join(", ")
          : authModeLabel,
      language,
    }));
  }, [authModeLabel, language, settingsDirty, userProfile]);

  const accessibleNavigation = useMemo(
    () =>
      navigation[language].filter((item) =>
        canAccessWorkspaceRoute(userProfile.roles, item.href, userProfile.capabilities),
      ),
    [language, userProfile.capabilities, userProfile.roles],
  );
  const railDefinitions: Array<{
    id: ShellModuleId;
    label: string;
    icon: typeof UserRound;
  }> = [
    {
      id: "operations",
      label: copy.moduleOperations,
      icon: ListChecks,
    },
    {
      id: "documents",
      label: copy.moduleDocuments,
      icon: Database,
    },
    {
      id: "ai",
      label: copy.moduleAi,
      icon: Bot,
    },
    {
      id: "intelligence",
      label: copy.moduleIntelligence,
      icon: Network,
    },
    {
      id: "governance",
      label: copy.moduleGovernance,
      icon: ShieldCheck,
    },
  ];
  const railItems = railDefinitions.flatMap((definition) => {
    const routes = moduleRouteGroups[definition.id];
    const preferredRoute = accessibleNavigation.find(
      (item) => item.href === moduleRootRoutes[definition.id],
    );
    const firstRoute =
      preferredRoute ??
      accessibleNavigation.find((item) => routes.includes(item.href));
    return firstRoute
      ? [
          {
            ...definition,
            href: firstRoute.href,
          },
        ]
      : [];
  });
  const activeModuleLabel =
    railItems.find((item) => item.id === activeModule)?.label ??
    copy.workspaceTitle;
  const activeModuleRoutes = moduleRouteGroups[activeModule];
  const activeSubmenuItem = accessibleNavigation
    .filter(
      (item) =>
        pathname === item.href ||
        (item.href !== "/" && pathname.startsWith(`${item.href}/`)),
    )
    .sort((left, right) => right.href.length - left.href.length)[0];
  const activeTopbarContext = activeSubmenuItem?.label ?? activeModuleLabel;
  const workspaceGroups = useMemo<WorkspaceNavGroup[]>(() => {
    const groupLabel = moduleGroupLabel(activeModule, copy);
    return [
      {
        id: activeModule,
        label: groupLabel,
        items: accessibleNavigation
          .filter((item) => activeModuleRoutes.includes(item.href))
          .map((item) => navItemToWorkspaceItem(item, activeSubmenuItem?.href)),
      },
    ];
  }, [accessibleNavigation, activeModule, activeModuleRoutes, activeSubmenuItem?.href, copy]);
  const commandCenterItems = useMemo<CommandCenterItem[]>(() => {
    const openRoute = (href: string) => {
      router.push(href);
      setCommandCenterOpen(false);
    };
    const navigationItems: CommandCenterItem[] = accessibleNavigation.map(
      (item) => {
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
            onSelect: () => openRoute(item.href),
          },
          actions: [
            {
              id: `go:${item.href}`,
              label: copy.commandGo,
              hint: "Enter",
              onSelect: () => openRoute(item.href),
            },
          ],
        };
      },
    );
    const quickActions: CommandCenterItem[] = [];
    if (canAccessWorkspaceRoute(userProfile.roles, "/documents/new", userProfile.capabilities)) {
      quickActions.push({
        id: "action:new-document",
        type: "action",
        title: language === "cs" ? "Založit dokument" : "Create document",
        subtitle: copy.moduleDocuments,
        detail:
          language === "cs"
            ? "Zadat metadata a pokračovat nahráním první verze."
            : "Enter metadata and continue by uploading the first version.",
        section: copy.commandTools,
        icon: <FilePlus2 size={18} aria-hidden="true" />,
        tone: "green",
        keywords: ["draft", "document", "koncept"],
        primaryAction: {
          id: "new-document",
          label: copy.commandOpen,
          hint: "Enter",
          onSelect: () => openRoute("/documents/new"),
        },
      });
    }
    quickActions.push({
        id: "knowledge:chat",
        type: "report",
        title: language === "cs" ? "Dotaz se zdroji" : "Ask with citations",
        subtitle: copy.moduleKnowledge,
        detail:
          language === "cs"
            ? "Otevřít znalostní chat s citacemi."
            : "Open knowledge chat with citations.",
        section: copy.commandKnowledge,
        icon: <Bot size={18} aria-hidden="true" />,
        tone: "purple",
        keywords: ["rag", "citace", "citations", "chat"],
        primaryAction: {
          id: "open-chat",
          label: copy.commandOpen,
          hint: "Enter",
          onSelect: () => openRoute("/chat"),
        },
      });
    return [...navigationItems, ...quickActions];
  }, [accessibleNavigation, copy, language, router, userProfile.roles]);

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

  const handleSettingsValueChange = (
    key: StratosSettingsCoreValueKey,
    value: StratosSettingsCoreValue,
  ) => {
    setSettingsValues((current) => {
      if (key === "avatarId" && typeof value === "string") {
        return {
          ...current,
          avatarColor: avatarColorForValue(value),
          [key]: value,
        };
      }
      return { ...current, [key]: value };
    });
    setSettingsDirty(true);
    setSettingsSaveError(null);
  };

  const handleSettingsModeChange = (mode: SettingsSurfaceMode) => {
    setSettingsMode(mode);
    setSettingsSaveError(null);
    persistProfileSettings(settingsValues, {
      mode,
      rolePreviewProfileId: rolePreview.profileId,
    })
      .then((payload) => applyProfileSettings(payload))
      .catch(() => setSettingsDirty(true));
  };

  const handleSettingsSave = async () => {
    const nextRolePreviewProfileId = rolePreview.profileId;
    try {
      setSettingsSaveError(null);
      const savedProfile = await persistProfileSettings(settingsValues, {
        mode: settingsMode,
        rolePreviewProfileId: nextRolePreviewProfileId,
      });
      if (
        rolePreview.canUse &&
        nextRolePreviewProfileId !== savedRolePreviewProfileId
      ) {
        const response = await fetch(
          withAppBasePath("/api/auth/role-preview"),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ profileId: nextRolePreviewProfileId }),
          },
        );
        if (!response.ok) {
          throw new Error(copy.saveFailed);
        }
        window.location.reload();
        return;
      }
      applyProfileSettings(savedProfile);
      setSettingsDirty(false);
    } catch {
      setSettingsDirty(true);
      setSettingsSaveError(copy.saveFailed);
    }
  };

  const handleRolePreviewChange = (profileId: string) => {
    const profile = rolePreview.profiles.find((item) => item.id === profileId);
    setRolePreview((current) => ({
      ...current,
      active: Boolean(profileId),
      profileId,
      label: profile?.label ?? "",
      roles: profile?.roles ?? [],
    }));
    setSettingsDirty(true);
    setSettingsSaveError(null);
  };

  if (isEmbeddedPath) {
    return <main className="akb-embed-shell">{children}</main>;
  }

  if (isEmployeeChatOnly({ roles: userProfile.roles, capabilities: userProfile.capabilities })) {
    return (
      <div className="akb-employee-portal-shell">
        <ProjectTopbar
          apiModeLabel={apiModeLabel}
          authModeLabel={authModeLabel}
          commandCenterLabel={copy.commandCenterOpen}
          commandCenterPlaceholder={copy.commandCenterPlaceholder}
          healthLabel={copy.healthOk}
          language={language}
          onCommandCenterOpen={() => setCommandCenterOpen(true)}
          onLogout={handleLogout}
          onSettingsOpen={() => setSettingsOpen(true)}
          projectName={copy.assistantBrand}
          user={userProfile}
          workspaceName="AKB"
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
            preview: copy.commandCenterPreview,
          }}
          onQueryChange={setCommandCenterQuery}
          onClose={() => setCommandCenterOpen(false)}
        />
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
            saveError={settingsSaveError}
            userInitials={userProfile.initials}
            values={settingsValues}
          />
        ) : null}
      </div>
    );
  }

  return (
    <StratosUiAppShell
      className="stratos-akb-shell"
      sidebarOpen={shellSidebarOpen}
      sidebarCloseLabel={copy.closeSidebar}
      showSidebarClose={false}
      onSidebarChange={handleSidebarOpenChange}
      topbarPlacement="global"
      rail={
        <AppRail
          workspaceMark={
            <Link href="/" aria-label="AKB">
              AKB
            </Link>
          }
          activeItemId={activeModule}
          panelOpen={shellSidebarOpen}
          mobileFallback="bottom"
          mobileAriaLabel={
            language === "cs" ? "Moduly AKB" : "AKB modules"
          }
          items={railItems.map<AppRailItem>((item) => ({
            id: item.id,
            icon: item.icon,
            label: item.label,
            tooltip: item.label,
          }))}
          onItemSelect={(itemId) => {
            const item = railItems.find((candidate) => candidate.id === itemId);
            if (!item) {
              return;
            }
            const shouldNavigate =
              !railSidebar.isOverlayViewport() && item.id !== activeModule;
            railSidebar.selectRailItem(item.id);
            if (shouldNavigate) {
              router.push(item.href);
            }
          }}
          onMobileItemSelect={(itemId) => {
            const item = railItems.find((candidate) => candidate.id === itemId);
            if (item) {
              railSidebar.selectMobileRailItem(item.id);
            }
          }}
        />
      }
      sidebar={
        <WorkspaceSidebar
          title={activeModuleLabel}
          subtitle={copy.workspaceSubtitle}
          closeLabel={copy.closeSidebar}
          onClose={railSidebar.closeSidebar}
          footer={copy.workspaceFooter}
        >
          <WorkspaceNav
            key={activeModule}
            groups={workspaceGroups}
            ariaLabel={
              language === "cs"
                ? "Navigace pracovní plochy"
                : "Workspace navigation"
            }
            onNavigate={railSidebar.closeSidebarAfterNavigation}
            renderLink={({
              href,
              className,
              children: linkChildren,
              onClick,
              ariaCurrent,
              title,
              target,
              rel,
            }) => (
              <Link
                href={href}
                className={className}
                onClick={onClick}
                aria-current={ariaCurrent}
                title={title}
                target={target}
                rel={rel}
              >
                {linkChildren}
              </Link>
            )}
          />
        </WorkspaceSidebar>
      }
      topbar={
        <>
          <ProjectTopbar
            apiModeLabel={apiModeLabel}
            authModeLabel={authModeLabel}
            commandCenterLabel={copy.commandCenterOpen}
            commandCenterPlaceholder={copy.commandCenterPlaceholder}
            healthLabel={copy.healthOk}
            language={language}
            onCommandCenterOpen={() => setCommandCenterOpen(true)}
            onLogout={handleLogout}
            mobileMenuOpen={shellSidebarOpen}
            onMobileMenuOpen={railSidebar.toggleSidebar}
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
              preview: copy.commandCenterPreview,
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
              saveError={settingsSaveError}
              userInitials={userProfile.initials}
              values={settingsValues}
            />
          ) : null}
        </>
      }
    >
      {children}
    </StratosUiAppShell>
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
  const input =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const profiles = Array.isArray(input.profiles)
    ? input.profiles
        .filter(
          (profile): profile is Record<string, unknown> =>
            typeof profile === "object" && profile !== null,
        )
        .map((profile) => ({
          id: String(profile.id ?? ""),
          label: String(profile.label ?? ""),
          description: String(profile.description ?? ""),
          roles: Array.isArray(profile.roles)
            ? profile.roles.filter(
                (role): role is string => typeof role === "string",
              )
            : [],
        }))
        .filter((profile) => profile.id && profile.label)
    : [];
  const profileId = typeof input.profileId === "string" ? input.profileId : "";
  const selectedProfile = profiles.find((profile) => profile.id === profileId);
  return {
    canUse: Boolean(input.canUse),
    active: Boolean(input.active),
    profileId,
    label:
      typeof input.label === "string"
        ? input.label
        : (selectedProfile?.label ?? ""),
    roles: Array.isArray(input.roles)
      ? input.roles.filter((role): role is string => typeof role === "string")
      : (selectedProfile?.roles ?? []),
    profiles,
  };
}

function settingsValuesFromCore(
  core: Record<string, unknown>,
  fallback: StratosSettingsCoreValues,
): StratosSettingsCoreValues {
  const avatarId = stringSetting(
    core.avatarId,
    stringSetting(core.avatarColor, stringSetting(fallback.avatarId, "teal")),
  );
  const avatarColor = stringSetting(
    core.avatarColor,
    avatarColorForValue(avatarId),
  );
  return {
    avatarId,
    avatarColor,
    avatarImageUrl: stringSetting(
      core.avatarImageUrl,
      stringSetting(fallback.avatarImageUrl, ""),
    ),
    displayName: stringSetting(core.displayName, fallback.displayName),
    email: stringSetting(core.email, fallback.email),
    role: stringSetting(core.role, fallback.role),
    language: core.language === "en" || core.locale === "en" ? "en" : "cs",
    theme: stringSetting(core.theme, stringSetting(fallback.theme, "system")),
    accent: stringSetting(
      core.accent,
      stringSetting(core.accentColor, stringSetting(fallback.accent, "teal")),
    ),
    highContrast: booleanSetting(
      core.highContrast,
      booleanSetting(fallback.highContrast, false),
    ),
    timezone: stringSetting(
      core.timezone,
      stringSetting(fallback.timezone, "Europe/Prague"),
    ),
    notifyTimezone: booleanSetting(
      core.notifyTimezone,
      booleanSetting(fallback.notifyTimezone, true),
    ),
    weekStart: stringSetting(
      core.weekStart,
      stringSetting(fallback.weekStart, "monday"),
    ),
    timeFormat: stringSetting(
      core.timeFormat,
      stringSetting(fallback.timeFormat, "24h"),
    ),
    dateFormat: stringSetting(
      core.dateFormat,
      stringSetting(fallback.dateFormat, "dd.mm.yyyy"),
    ),
    compactMode: booleanSetting(
      core.compactMode,
      booleanSetting(fallback.compactMode, false),
    ),
    commandHints: booleanSetting(
      core.commandHints,
      booleanSetting(fallback.commandHints, true),
    ),
    flyoutToasts: booleanSetting(
      core.flyoutToasts,
      booleanSetting(fallback.flyoutToasts, true),
    ),
    markdown: booleanSetting(
      core.markdown,
      booleanSetting(fallback.markdown, true),
    ),
    keyboardShortcuts: booleanSetting(
      core.keyboardShortcuts,
      booleanSetting(fallback.keyboardShortcuts, true),
    ),
  };
}

function settingsCoreForPayload(
  values: StratosSettingsCoreValues,
): Record<string, unknown> {
  const core: Record<string, unknown> = { ...values };
  const language = typeof values.language === "string" ? values.language : "cs";
  const accent = typeof values.accent === "string" ? values.accent : "teal";
  const avatarId =
    typeof values.avatarId === "string" ? values.avatarId : "teal";
  core.locale = language;
  core.accentColor = accent;
  core.avatarColor =
    typeof values.avatarColor === "string" && values.avatarColor
      ? values.avatarColor
      : avatarColorForValue(avatarId);
  return core;
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isSettingsSurfaceMode(value: unknown): value is SettingsSurfaceMode {
  return value === "modal" || value === "sidebar" || value === "fullscreen";
}

function moduleForPath(pathname: string): ShellModuleId {
  const entry = (
    Object.entries(moduleRouteGroups) as Array<[ShellModuleId, string[]]>
  ).find(([, routes]) =>
    routes.some(
      (route) =>
        pathname === route || (route !== "/" && pathname.startsWith(route)),
    ),
  );
  return entry?.[0] ?? "operations";
}

function moduleGroupLabel(
  moduleId: ShellModuleId,
  copy: Record<string, string>,
) {
  if (moduleId === "documents") {
    return copy.groupDocuments;
  }
  if (moduleId === "ai") {
    return copy.groupAi;
  }
  if (moduleId === "knowledge") {
    return copy.groupKnowledge;
  }
  if (moduleId === "intelligence") {
    return copy.groupIntelligence;
  }
  if (moduleId === "governance") {
    return copy.groupGovernance;
  }
  return copy.groupWorkspace;
}

function createSettingsValues({
  authModeLabel,
  language,
  user,
}: {
  authModeLabel: string;
  language: AklLanguage;
  user: Pick<AklUserProfile, "name" | "email" | "roles">;
}): StratosSettingsCoreValues {
  return {
    avatarId: "teal",
    avatarColor: avatarColorForValue("teal"),
    avatarImageUrl: "",
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
    keyboardShortcuts: true,
  };
}

function avatarColorForValue(value: string): string {
  if (/^#[0-9a-f]{3,8}$/i.test(value)) {
    return value;
  }
  return avatarColors[value] ?? avatarColors.teal;
}

function navItemToWorkspaceItem(
  item: (typeof navigation)[AklLanguage][number],
  activeHref: string | undefined,
): WorkspaceNavGroup["items"][number] {
  const Icon = item.icon;
  return {
    id: item.href,
    href: item.href,
    label: item.label,
    icon: <Icon size={16} aria-hidden="true" />,
    active: activeHref === item.href,
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
