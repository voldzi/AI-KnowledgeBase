"use client";

import { Button, ButtonLink } from "@voldzi/stratos-ui";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { useState } from "react";
import { withAppBasePath } from "@/lib/app-url";

export type WorkspaceErrorProps = { error: Error & { digest?: string }; reset: () => void };

export function WorkspaceError({ error }: WorkspaceErrorProps) {
  const [retrying, setRetrying] = useState(false);
  const reference = error.digest && /^[a-zA-Z0-9_-]{1,64}$/.test(error.digest) ? error.digest : null;
  function retry() {
    setRetrying(true);
    // A boundary reset alone can replay the failed server-component payload.
    window.location.reload();
  }
  return <div className="workspace-error" role="alert">
    <AlertTriangle size={32} aria-hidden="true" />
    <h1>Stránku se nepodařilo načíst</h1>
    <p>Požadavek nebyl dokončen. Zkuste jej znovu nebo se vraťte na úvodní stránku AKB.</p>
    <div className="inline-actions">
      <Button type="button" variant="primary" disabled={retrying} onClick={retry}><RefreshCw size={18} aria-hidden="true" />{retrying ? "Načítám stránku..." : "Zkusit znovu"}</Button>
      <ButtonLink href={withAppBasePath("/")} variant="secondary"><Home size={18} aria-hidden="true" />Zpět do AKB</ButtonLink>
    </div>
    {reference ? <details><summary>Údaj pro podporu</summary><p>{reference}</p></details> : null}
  </div>;
}
