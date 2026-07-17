import type { Metadata, Viewport } from "next";

import { AppShell } from "@/components/app-shell";
import { PwaRegistration } from "@/components/pwa-registration";
import { getAklConfig } from "@/lib/api/config";
import { getOptionalServerRequestContext } from "@/lib/api/server";

import "@voldzi/stratos-ui/styles.css";
import "./globals.css";

export function generateMetadata(): Metadata {
  const chatProfile = getAklConfig().webProfile === "chat";
  return {
    title: chatProfile ? "AKB Chat" : "AKB Platform",
    description: chatProfile
      ? "Bezpečný znalostní asistent AKB"
      : "Web Frontend for AI Knowledge Base",
    manifest: chatProfile ? "/manifest.webmanifest" : undefined,
    appleWebApp: chatProfile
      ? {
          capable: true,
          statusBarStyle: "default",
          title: "AKB Chat",
        }
      : undefined,
  };
}

export const viewport: Viewport = {
  themeColor: "#0f766e",
  colorScheme: "light",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const config = getAklConfig();
  const initialContext = await getOptionalServerRequestContext().catch(() => null);

  return (
    <html lang="cs">
      <body>
        <AppShell
          apiMode={config.apiClientMode}
          authMode={config.authMode}
          webProfile={config.webProfile}
          initialUser={initialContext ? {
            subjectId: initialContext.subjectId,
            roles: initialContext.roles ?? [],
            groups: initialContext.groups ?? [],
            capabilities: initialContext.capabilities ?? [],
            applicationAccess: initialContext.applicationAccess ?? []
          } : null}
        >
          {children}
        </AppShell>
        {config.webProfile === "chat" ? <PwaRegistration /> : null}
      </body>
    </html>
  );
}
