"use client";

import { AlertTriangle } from "lucide-react";

import { withAppBasePath } from "@/lib/app-url";

export default function ChatError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="akb-access-error" role="alert">
      <section className="akb-access-error__card">
        <AlertTriangle aria-hidden="true" size={30} />
        <div>
          <p className="akb-access-error__eyebrow">Ověření přístupu</p>
          <h1>Přístup do AKB se nepodařilo ověřit</h1>
          <p>
            Centrální STRATOS access projection je nedostupná nebo odmítla aktuální přihlášení.
            AKB zůstává bezpečně uzavřené a nezpřístupní žádné zdroje bez platného rozhodnutí.
          </p>
          <div className="akb-access-error__actions">
            <button type="button" onClick={reset}>Zkusit znovu</button>
            <a href={withAppBasePath("/api/auth/logout")}>Odhlásit a přihlásit znovu</a>
          </div>
        </div>
      </section>
    </main>
  );
}
