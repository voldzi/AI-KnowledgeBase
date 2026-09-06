"use client";

import { useEffect, useState, type ReactNode } from "react";
import { StratosSignInState } from "@voldzi/stratos-ui";
import { monitorStratosSession, probeStratosSession, stratosAccessFingerprint, type StratosSsoFailure } from "@voldzi/stratos-ui/auth";
import { withAppBasePath } from "@/lib/app-url";
import type { WebProfile } from "@/lib/api/config";

type Authority = { subjectId: string; capabilities?: string[]; applicationAccess?: unknown };
const fingerprint = (user: Authority) => stratosAccessFingerprint({
  subjectId: user.subjectId, capabilities: user.capabilities ?? [], applicationAccess: user.applicationAccess ?? [],
});

/** Unmount protected content on invalid authority; late responses cannot restore it. */
export function SessionAuthorityBoundary({ children, authMode, webProfile, initialUser }: {
  children: ReactNode;
  authMode: "oidc" | "mock";
  webProfile: WebProfile;
  initialUser?: Authority | null;
}) {
  const [failure, setFailure] = useState<StratosSsoFailure | null>(null);
  const [reloading, setReloading] = useState(false);
  const initialFingerprint = initialUser ? fingerprint(initialUser) : null;
  useEffect(() => {
    if (authMode !== "oidc" || !initialFingerprint) return;
    const monitor = monitorStratosSession({
      read: signal => probeStratosSession<{ authenticated: boolean; user?: Authority }>(withAppBasePath("/api/auth/session"), signal),
      verified: payload => {
        if (!payload.authenticated || !payload.user?.subjectId) {
          monitor.stop(); setFailure("signed-out");
        } else if (fingerprint(payload.user) !== initialFingerprint) {
          monitor.stop(); setReloading(true); window.location.reload();
        }
      },
      invalid: reason => setFailure(reason),
    });
    void monitor.check();
    return monitor.stop;
  }, [authMode, initialFingerprint]);

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
