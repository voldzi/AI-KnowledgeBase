import type { WebProfile } from "@/lib/api/config";

const CHAT_PAGE_PATHS = new Set(["/", "/chat", "/health", "/ready"]);
const CHAT_API_PREFIXES = [
  "/api/assistant",
  "/api/auth/callback",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
  "/api/health",
  "/api/ready",
  "/api/v1/profile/settings",
] as const;
const CHAT_STATIC_PATHS = new Set([
  "/favicon.ico",
  "/manifest.webmanifest",
  "/offline.html",
  "/sw.js",
]);

export function isChatProfile(profile: WebProfile | string | undefined): boolean {
  return profile === "chat";
}

export function isChatProfilePathAllowed(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (CHAT_PAGE_PATHS.has(path) || CHAT_STATIC_PATHS.has(path)) {
    return true;
  }
  if (
    path.startsWith("/_next/")
    || path.startsWith("/icons/")
    || path.startsWith("/images/")
  ) {
    return true;
  }
  return CHAT_API_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function isChatProfileApiPath(pathname: string): boolean {
  return normalizePath(pathname).startsWith("/api/");
}

export function chatProfileRedirectPath(pathname: string): string | null {
  const path = normalizePath(pathname);
  if (
    path === "/chat"
    || path.startsWith("/chat/")
    || path === "/assistant"
    || path.startsWith("/assistant/")
  ) {
    return "/";
  }
  return null;
}

function normalizePath(pathname: string): string {
  if (!pathname) {
    return "/";
  }
  const withoutQuery = pathname.split(/[?#]/, 1)[0] || "/";
  return withoutQuery.length > 1
    ? withoutQuery.replace(/\/+$/, "")
    : withoutQuery;
}
