"use client";

import { PageHeader } from "@/components/page-header";
import { useLanguage } from "@/lib/i18n";

export function DashboardLoading() {
  const { language } = useLanguage();
  const copy = language === "cs"
    ? {
        title: "Načítám provozní přehled",
        detail: "Ověřuji oprávnění a získávám aktuální údaje.",
      }
    : {
        title: "Loading the operational dashboard",
        detail: "Checking permissions and retrieving current data.",
      };

  return (
    <>
      <PageHeader
        title={{ cs: "Provozní přehled", en: "Operational dashboard" }}
        description={{
          cs: "Připravuji aktuální dokumenty, úkoly a provozní stav.",
          en: "Preparing current documents, tasks, and operational status.",
        }}
      />
      <main className="dashboard-loading" aria-busy="true" aria-live="polite">
        <section className="panel dashboard-loading__status">
          <div className="dashboard-loading__indicator" aria-hidden="true" />
          <div>
            <h2>{copy.title}</h2>
            <p>{copy.detail}</p>
          </div>
        </section>
        <div className="dashboard-loading__grid" aria-hidden="true">
          <div className="dashboard-loading__placeholder" />
          <div className="dashboard-loading__placeholder" />
          <div className="dashboard-loading__placeholder dashboard-loading__placeholder--wide" />
        </div>
      </main>
    </>
  );
}
