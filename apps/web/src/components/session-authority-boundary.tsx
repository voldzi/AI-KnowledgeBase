"use client";

import { useEffect, useState, type ReactNode } from "react";
import { StratosSignInState } from "@voldzi/stratos-ui";
import { monitorStratosSession, probeStratosSession, type StratosSsoFailure } from "@voldzi/stratos-ui/auth";
import { withAppBasePath } from "@/lib/app-url";
import type { WebProfile } from "@/lib/api/config";
import {
  recoverSessionAuthority,
  sessionAuthorityFingerprint,
  type SessionAuthority,
} from "@/lib/session-authority-recovery";

/** Unmount protected content on invalid authority; late responses cannot restore it. */
export function SessionAuthorityBoundary({ children, authMode, webProfile, initialUser }: {
  children: ReactNode;
  authMode: "oidc" | "mock";
  webProfile: WebProfile;
  initialUser?: SessionAuthority | null;
}) {
  const [failure, setFailure] = useState<StratosSsoFailure | null>(null);
  const [reloading, setReloading] = useState(false);
  const [monitorRevision, setMonitorRevision] = useState(0);
  const initialFingerprint = initialUser ? sessionAuthorityFingerprint(initialUser) : null;
  useEffect(() => {
    if (authMode !== "oidc" || !initialFingerprint) return;
    const recovery = new AbortController();
    const monitor = monitorStratosSession({
      read: signal => probeStratosSession<{ authenticated: boolean; user?: SessionAuthority }>(withAppBasePath("/api/auth/session"), signal),
      verified: payload => {
        if (!payload.authenticated || !payload.user?.subjectId) {
          monitor.stop(); setFailure("signed-out");
        } else if (sessionAuthorityFingerprint(payload.user) !== initialFingerprint) {
          monitor.stop(); setReloading(true); window.location.reload();
        }
      },
      invalid: reason => {
        setFailure(reason);
        if (reason !== "verification-unavailable") return;
        void recoverSessionAuthority({
          read: signal => probeStratosSession(withAppBasePath("/api/auth/session"), signal),
          expectedFingerprint: initialFingerprint,
          signal: recovery.signal,
        }).then(result => {
          if (result === "verified") {
            setFailure(null);
            setMonitorRevision(revision => revision + 1);
          } else if (result === "changed") {
            setReloading(true);
            window.location.reload();
          } else if (result === "signed-out") {
            setFailure("signed-out");
          }
        }).catch(error => {
          if (!(error instanceof DOMException && error.name === "AbortError")) setFailure("verification-unavailable");
        });
      },
    });
    void monitor.check();
    return () => {
      recovery.abort();
      monitor.stop();
    };
  }, [authMode, initialFingerprint, monitorRevision]);

  // Initial navigation stays with the server page guard, which performs OIDC.
  // Hiding its children before it renders would also suppress that redirect.
  if (authMode === "oidc" && (failure || reloading)) {
    return <main data-testid="session-authority-guard">
      <StratosSignInState applicationName={webProfile === "chat" ? "AKB Chat" : "AKB"}
        failure={failure} busy={reloading}
        onSignIn={() => {
          if (failure === "verification-unavailable" || failure === "access-denied") window.location.reload();
          else window.location.assign(withAppBasePath("/api/auth/login"));
        }} />
    </main>;
  }
  return children;
}
