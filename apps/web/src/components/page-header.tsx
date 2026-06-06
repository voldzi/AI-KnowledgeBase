"use client";

import type { ReactNode } from "react";

import { useLanguage, type AklLanguage } from "@/lib/i18n";

type LocalizedString = string | Record<AklLanguage, string>;

interface PageHeaderProps {
  title: LocalizedString;
  description: LocalizedString;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  const { language } = useLanguage();

  return (
    <header className="page-header">
      <div>
        <h1>{localized(title, language)}</h1>
        <p>{localized(description, language)}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

function localized(value: LocalizedString, language: AklLanguage): string {
  return typeof value === "string" ? value : value[language];
}
