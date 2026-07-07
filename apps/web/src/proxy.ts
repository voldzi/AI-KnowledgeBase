import { NextRequest, NextResponse } from "next/server";

const OIDC_SESSION_COOKIE = "akl_session";
const appBasePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH?.replace(/\/+$/, "") ?? "";

const publicPathPrefixes = [
  "/api/",
  "/_next/",
  "/health",
  "/ready",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml"
];

function stripAppBasePath(pathname: string): string {
  if (!appBasePath) {
    return pathname;
  }
  if (pathname === appBasePath) {
    return "/";
  }
  if (pathname.startsWith(`${appBasePath}/`)) {
    return pathname.slice(appBasePath.length) || "/";
  }
  return pathname;
}

function withAppBasePath(pathname: string): string {
  if (!appBasePath) {
    return pathname;
  }
  if (pathname === "/") {
    return appBasePath;
  }
  return `${appBasePath}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function isPublicPath(pathname: string): boolean {
  return publicPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export function proxy(request: NextRequest) {
  const pathname = stripAppBasePath(request.nextUrl.pathname);
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (request.cookies.has(OIDC_SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const loginUrl = new URL(withAppBasePath("/api/auth/login"), request.url);
  if (pathname !== "/") {
    loginUrl.searchParams.set("return_to", pathname);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
