"use client";

import { KeyRound, ServerCog, ShieldCheck, UserCog } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type { AuthorizationHint } from "@/lib/types";

interface AdminSkeletonProps {
  authorization: AuthorizationHint;
}

const adminCopy = {
  cs: {
    online: "online",
    registryDetail: "Evidence dokumentů je dostupná",
    ingestionDetail: "Zpracování dokumentů je nakonfigurované",
    ragDetail: "Dotazy s citacemi jsou nakonfigurované",
    title: "Administrace",
    readOnly: "jen čtení",
    roleMappings: "Mapování rolí",
    roleMappingsDetail: "Plánovaná plocha pro role admin, document_manager, reviewer, reader a auditor.",
    oidcSetup: "Nastavení OIDC",
    oidcDetail: "Produkce musí používat OIDC/JWT. Mock auth je blokovaný při AKL_ENV=production.",
    policyHints: "Oprávnění akcí",
    policyHintsDetail: "Aplikace ukazuje jen akce, které má aktuální uživatel povolené."
  },
  en: {
    online: "online",
    registryDetail: "Document registry is available",
    ingestionDetail: "Document processing is configured",
    ragDetail: "Citation-backed queries are configured",
    title: "Administration",
    readOnly: "read only",
    roleMappings: "Role mappings",
    roleMappingsDetail: "Planned surface for admin, document_manager, reviewer, reader and auditor roles.",
    oidcSetup: "OIDC setup",
    oidcDetail: "Production must use OIDC/JWT. Mock auth is blocked when AKL_ENV=production.",
    policyHints: "Action permissions",
    policyHintsDetail: "The app shows only actions that the current user is allowed to use."
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function AdminSkeleton({ authorization }: AdminSkeletonProps) {
  const { language } = useLanguage();
  const copy = adminCopy[language];

  return (
    <div className="stack">
      <section className="grid grid--three">
        <MetricCard icon={ServerCog} label={language === "cs" ? "Dokumenty" : "Documents"} value={copy.online} detail={copy.registryDetail} tone="success" />
        <MetricCard icon={ServerCog} label={language === "cs" ? "Zpracování" : "Processing"} value={copy.online} detail={copy.ingestionDetail} tone="success" />
        <MetricCard icon={ServerCog} label={language === "cs" ? "Citace" : "Citations"} value={copy.online} detail={copy.ragDetail} tone="success" />
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>{copy.title}</h2>
          <StatusBadge value={authorization.can_manage_admin ? "valid" : "draft"} label={authorization.can_manage_admin ? "admin.manage" : copy.readOnly} />
        </div>
        <div className="panel__body grid grid--three">
          <div className="timeline-item">
            <UserCog size={18} aria-hidden="true" />
            <strong>{copy.roleMappings}</strong>
            <span>{copy.roleMappingsDetail}</span>
          </div>
          <div className="timeline-item">
            <KeyRound size={18} aria-hidden="true" />
            <strong>{copy.oidcSetup}</strong>
            <span>{copy.oidcDetail}</span>
          </div>
          <div className="timeline-item">
            <ShieldCheck size={18} aria-hidden="true" />
            <strong>{copy.policyHints}</strong>
            <span>{copy.policyHintsDetail}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
