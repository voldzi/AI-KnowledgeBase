"use client";

import { Button, ButtonLink, StratosAuthErrorPage } from "@voldzi/stratos-ui";
import { LogIn, RefreshCw } from "lucide-react";

import { withAppBasePath } from "@/lib/app-url";

export default function ChatError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main role="alert">
      <StratosAuthErrorPage
        applicationName="AI KnowledgeBase"
        state="verification-unavailable"
        title="Přístup do AKB se nepodařilo ověřit"
        message="Centrální STRATOS access projection je nedostupná nebo odmítla aktuální přihlášení. AKB zůstává bezpečně uzavřené a nezpřístupní žádné zdroje bez platného rozhodnutí."
        actions={
          <>
            <Button type="button" variant="primary" onClick={reset}>
              <RefreshCw size={16} />
              Zkusit znovu
            </Button>
            <ButtonLink href={withAppBasePath("/api/auth/logout")} variant="secondary">
              <LogIn size={16} />
              Odhlásit a přihlásit znovu
            </ButtonLink>
          </>
        }
      />
    </main>
  );
}
