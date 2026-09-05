"use client";

import { PageHeader } from "@/components/page-header";
import { useLanguage } from "@/lib/i18n";

export function WorkspacePageLoading({
  title,
  description,
  loadingTitle,
  loadingDetail,
}: {
  title: { cs: string; en: string };
  description: { cs: string; en: string };
  loadingTitle: { cs: string; en: string };
  loadingDetail: { cs: string; en: string };
}) {
  const { language } = useLanguage();

  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="dashboard-loading" role="status" aria-busy="true" aria-live="polite">
        <section className="panel dashboard-loading__status">
          <div className="dashboard-loading__indicator" aria-hidden="true" />
          <div>
            <h2>{loadingTitle[language]}</h2>
            <p>{loadingDetail[language]}</p>
          </div>
        </section>
        <div className="dashboard-loading__grid" aria-hidden="true">
          <div className="dashboard-loading__placeholder" />
          <div className="dashboard-loading__placeholder" />
          <div className="dashboard-loading__placeholder dashboard-loading__placeholder--wide" />
        </div>
      </div>
    </>
  );
}
