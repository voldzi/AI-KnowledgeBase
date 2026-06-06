"use client";

import { Languages } from "lucide-react";

import { languageLabels, type AklLanguage } from "@/lib/i18n";

interface LanguageSwitcherProps {
  language: AklLanguage;
  setLanguage: (language: AklLanguage) => void;
}

export function LanguageSwitcher({ language, setLanguage }: LanguageSwitcherProps) {
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
