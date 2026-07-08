import { NextRequest, NextResponse } from "next/server";

import {
  AKB_BROWSER_SESSION_COOKIE,
  buildRootLoginPath,
  isAppRootPath,
} from "@/lib/auth/root-login-redirect";

export function proxy(request: NextRequest) {
  if (!isAppRootPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (request.cookies.has(AKB_BROWSER_SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = buildRootLoginPath();
  loginUrl.search = "";
  loginUrl.searchParams.set("return_to", "/");
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/", "/akb", "/akb/"],
};
