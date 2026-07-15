import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { getAklConfig } from "@/lib/api/config";
import { getOptionalServerRequestContext } from "@/lib/api/server";

import "@voldzi/stratos-ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AKB Platform",
  description: "Web Frontend for AI Knowledge Base"
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
      </body>
    </html>
  );
}
