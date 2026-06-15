import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { getAklConfig } from "@/lib/api/config";

import "@voldzi/stratos-ui/styles.css";
import "@voldzi/stratos-ui/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AKB Platform",
  description: "Web Frontend for AI Knowledge Base"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const config = getAklConfig();

  return (
    <html lang="cs">
      <body>
        <AppShell apiMode={config.apiClientMode} authMode={config.authMode}>{children}</AppShell>
      </body>
    </html>
  );
}
