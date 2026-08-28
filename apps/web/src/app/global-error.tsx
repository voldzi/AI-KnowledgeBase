"use client";

import { WorkspaceError, type WorkspaceErrorProps } from "@/components/workspace-error";
import "@voldzi/stratos-ui/styles.css";
import "./globals.css";

export default function GlobalError(props: WorkspaceErrorProps) {
  return <html lang="cs"><body><main><WorkspaceError {...props} /></main></body></html>;
}
