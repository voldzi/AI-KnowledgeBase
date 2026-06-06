"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  CircleHelp,
  Database,
  FileClock,
  FilePlus2,
  Gauge,
  Languages,
  LayoutDashboard,
  ListChecks,
  Search,
  Settings,
  ShieldCheck,
  UserRound
} from "lucide-react";

import { LanguageProvider, languageLabels, useLanguage, type AklLanguage } from "@/lib/i18n";

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
    { href: "/admin", label: "Správa", icon: Settings },
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
    { href: "/admin", label: "Admin", icon: Settings },
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
    healthOk: "Health OK",
    apiModeMock: "Mock API mode",
    apiModeProduction: "Production API clients",
    authModeMock: "dev auth",
    authModeOidc: "OIDC auth"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

interface AppShellProps {
  children: React.ReactNode;
  apiMode: "mock" | "production";
  authMode: "mock" | "oidc";
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
  const { language, setLanguage } = useLanguage();
  const copy = shellCopy[language];
  const apiModeLabel = apiMode === "mock" ? copy.apiModeMock : copy.apiModeProduction;
  const authModeLabel = authMode === "mock" ? copy.authModeMock : copy.authModeOidc;

  if (pathname.startsWith("/assistant")) {
    return (
      <div className="employee-shell">
        <header className="employee-topbar">
          <Link className="employee-brand" href="/assistant">
            <span className="brand__mark">ČSÚ</span>
            <span>
              <strong>{copy.assistantBrand}</strong>
              <small>{copy.assistantSubtitle}</small>
            </span>
          </Link>
          <div className="employee-topbar__actions">
            <LanguageSwitcher language={language} setLanguage={setLanguage} />
            <span className="topbar__chip">
              <Activity size={15} aria-hidden="true" />
              {copy.serviceAvailable}
            </span>
            <Link className="button" href="/help">
              <CircleHelp size={15} aria-hidden="true" />
              {copy.help}
            </Link>
            <Link className="button" href="/">
              <Settings size={15} aria-hidden="true" />
              {copy.knowledgeManagement}
            </Link>
          </div>
        </header>
        <main className="employee-content">{children}</main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand__mark">AKL</span>
          <span>
            <strong>AKL Platform</strong>
            <small>AI Knowledge Library</small>
          </span>
        </Link>
        <nav className="nav-list" aria-label="Primary">
          {navigation[language].map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link className={`nav-item ${active ? "nav-item--active" : ""}`} href={item.href} key={item.href}>
                <Icon size={17} strokeWidth={2} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar__footer">
          <div className="health-dot" aria-hidden="true" />
          <span>{apiModeLabel} · {authModeLabel}</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar__search">
            <Search size={17} strokeWidth={2} aria-hidden="true" />
            <span>{copy.searchPlaceholder}</span>
          </div>
          <div className="topbar__status">
            <LanguageSwitcher language={language} setLanguage={setLanguage} />
            <span className="topbar__chip">
              <Activity size={15} aria-hidden="true" />
              {copy.healthOk}
            </span>
            <span className="topbar__chip">
              <Gauge size={15} aria-hidden="true" />
              Europe/Prague
            </span>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}

interface LanguageSwitcherProps {
  language: AklLanguage;
  setLanguage: (language: AklLanguage) => void;
}

function LanguageSwitcher({ language, setLanguage }: LanguageSwitcherProps) {
  return (
    <div className="language-switcher" aria-label={language === "cs" ? "Jazyk aplikace" : "Application language"}>
      <Languages size={15} aria-hidden="true" />
      {(["cs", "en"] as const).map((item) => (
        <button
          className={`language-switcher__button ${language === item ? "language-switcher__button--active" : ""}`}
          key={item}
          type="button"
          aria-pressed={language === item}
          title={languageLabels[item]}
          onClick={() => setLanguage(item)}
        >
          {item.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
