import { NextRequest, NextResponse } from "next/server";

import { hasAllowedSessionRequestOrigin } from "@/lib/auth/csrf";
import {
  chatProfileRedirectPath,
  isChatProfileApiPath,
  isChatProfilePathAllowed,
} from "@/lib/web-profile";

export function proxy(request: NextRequest) {
  const requestMetadata = {
    method: request.method,
    pathname: request.nextUrl.pathname,
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    hasServerSession: request.cookies.has("akl_session"),
  };
  if (
    !hasAllowedSessionRequestOrigin(
      requestMetadata,
      process.env.AKL_WEB_PUBLIC_BASE_URL,
    )
  ) {
    return NextResponse.json(
      {
        error: {
          code: "SESSION_REQUEST_ORIGIN_FORBIDDEN",
          message: "The state-changing session request origin is not allowed.",
        },
      },
      {
        status: 403,
        headers: {
          "cache-control": "no-store, max-age=0",
        },
      },
    );
  }

  if (process.env.AKL_WEB_PROFILE !== "chat") {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  const legacyRedirect = chatProfileRedirectPath(pathname);
  if (legacyRedirect) {
    const target = request.nextUrl.clone();
    target.pathname = legacyRedirect;
    return NextResponse.redirect(target, 308);
  }

  if (!isChatProfilePathAllowed(pathname)) {
    if (isChatProfileApiPath(pathname)) {
      return NextResponse.json(
        {
          error: {
            code: "CHAT_PROFILE_ROUTE_FORBIDDEN",
            message: "This endpoint is not available on the AKB Chat application.",
          },
        },
        {
          status: 403,
          headers: {
            "cache-control": "no-store, max-age=0",
          },
        },
      );
    }
    const target = new URL("/", request.url);
    target.searchParams.set("blocked", "1");
    return NextResponse.redirect(target, 307);
  }

  const response = NextResponse.next();
  if (
    isChatProfileApiPath(pathname)
    || request.headers.get("sec-fetch-mode") === "navigate"
  ) {
    response.headers.set("cache-control", "no-store, max-age=0");
  }
  response.headers.set("x-akb-web-profile", "chat");
  return response;
}

export const config = {
  matcher: ["/((?!_next/image).*)"],
};
