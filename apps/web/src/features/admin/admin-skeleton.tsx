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
    registryDetail: "Health endpoint dostupný v mock režimu",
    ingestionDetail: "Klient úloh je nakonfigurovaný",
    ragDetail: "Klient dotazů s citacemi je nakonfigurovaný",
    title: "Administrace",
    readOnly: "jen čtení",
    roleMappings: "Mapování rolí",
    roleMappingsDetail: "Plánovaná plocha pro role admin, document_manager, reviewer, reader a auditor.",
    oidcSetup: "Nastavení OIDC",
    oidcDetail: "Produkce musí používat OIDC/JWT. Mock auth je blokovaný při AKL_ENV=production.",
    policyHints: "Policy hinty",
    policyHintsDetail: "Frontend skrývá akce podle autorizačních kontrol Registry API, ne podle lokální autority."
  },
  en: {
    online: "online",
    registryDetail: "Health endpoint reachable in mock mode",
    ingestionDetail: "Job client configured",
    ragDetail: "Citation query client configured",
    title: "Administration",
    readOnly: "read only",
    roleMappings: "Role mappings",
    roleMappingsDetail: "Planned surface for admin, document_manager, reviewer, reader and auditor roles.",
    oidcSetup: "OIDC setup",
    oidcDetail: "Production must use OIDC/JWT. Mock auth is blocked when AKL_ENV=production.",
    policyHints: "Policy hints",
    policyHintsDetail: "Frontend hides actions using Registry API authorization checks, not local authority."
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function AdminSkeleton({ authorization }: AdminSkeletonProps) {
  const { language } = useLanguage();
  const copy = adminCopy[language];

  return (
    <div className="stack">
      <section className="grid grid--three">
        <MetricCard icon={ServerCog} label="Registry API" value={copy.online} detail={copy.registryDetail} tone="success" />
        <MetricCard icon={ServerCog} label="Ingestion Service" value={copy.online} detail={copy.ingestionDetail} tone="success" />
        <MetricCard icon={ServerCog} label="RAG Retrieval" value={copy.online} detail={copy.ragDetail} tone="success" />
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
