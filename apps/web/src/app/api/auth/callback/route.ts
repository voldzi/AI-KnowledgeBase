import { authCookieNames } from "@/lib/auth/cookies";
import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  exchangeAuthorizationCode,
  buildPublicAppUrl,
  normalizeReturnToForPublicBase,
  safeReturnToFromState,
  parseState,
  verifiedSessionFromTokens,
} from "@/lib/auth/oidc";
import {
  centralSsoSyncCookieOptions,
  createCentralSsoSyncMarker,
  createServerSession,
  resolveServerSession,
  revokeServerSession,
  serverSessionCookieOptions,
  serverSessionDeadline,
  synchronizeServerSession,
} from "@/lib/auth/server-session";
import { manualLoginUrl } from "@/lib/auth/login-navigation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getAklConfig();
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(authCookieNames(config.webProfile).state)?.value;
  const codeVerifier = request.cookies.get(authCookieNames(config.webProfile).pkce)?.value;
  const previousSelector = request.cookies.get(authCookieNames(config.webProfile).session)?.value;
  const returnTo = normalizeReturnToForPublicBase(
    config,
    safeReturnToFromState(state, "/"),
  );

  if (!state || state !== expectedState || !codeVerifier) {
    console.warn("OIDC callback rejected due to invalid state.");
    return redirectToLogin(config, returnTo);
  }

  let parsedState;
  try {
    parsedState = parseState(state);
    if (!parsedState.nonce) throw new Error("Missing state nonce.");
  } catch {
    console.warn("OIDC callback rejected due to malformed state.");
    return redirectToLogin(config, returnTo);
  }

  if (error) {
    if (parsedState.mode === "silent") {
      console.info("Silent STRATOS SSO requires interactive authentication.");
    } else {
      console.warn("Interactive OIDC authorization was not completed.");
    }
    if (parsedState.mode === "silent" && previousSelector) {
      await revokeServerSession(config, previousSelector, "central_sso_unavailable").catch(() => null);
    }
    return redirectToLogin(config, returnTo);
  }

  if (!code) {
    console.warn("OIDC callback rejected because the authorization code is missing.");
    return redirectToLogin(config, returnTo);
  }

  let tokens;
  try {
    tokens = await exchangeAuthorizationCode(config, code, codeVerifier);
  } catch {
    console.error("OIDC callback token exchange failed.");
    return redirectToLogin(config, returnTo);
  }

  let session;
  try {
    session = await verifiedSessionFromTokens(config, tokens, parsedState.nonce);
  } catch {
    console.warn("OIDC callback identity validation failed.");
    return redirectToLogin(config, returnTo);
  }
  const previousSession =
    parsedState.mode === "silent" && previousSelector
      ? await resolveServerSession(config, previousSelector).catch(() => null)
      : null;
  if (parsedState.mode === "silent" && !previousSession) {
    // Silent synchronization cannot replace an expired or revoked BFF session.
    return redirectToLogin(config, returnTo);
  }
  let persistent = session.rememberDevice === true;
  const priorDeadline = previousSession?.oidc.subjectId === session.subjectId ? previousSession.absoluteExpiresAt : undefined;
  const nowMs = Date.now();
  let selector: string;
  let absoluteExpiresAt: number;
  try {
    if (previousSelector && previousSession?.oidc.subjectId === session.subjectId) {
      const synchronized = await synchronizeServerSession(config, previousSelector, previousSession, session, nowMs);
      selector = previousSelector;
      persistent = synchronized.persistent;
      absoluteExpiresAt = synchronized.absoluteExpiresAt;
    } else {
      if (previousSelector) await revokeServerSession(config, previousSelector, "central_sso_replaced");
      selector = await createServerSession(config, session, persistent, nowMs, priorDeadline);
      absoluteExpiresAt = serverSessionDeadline(config, session, persistent, nowMs, priorDeadline);
    }
  } catch {
    console.error("OIDC callback could not create a server session.");
    return redirectToLogin(config, returnTo);
  }
  const response = redirectTo(buildPublicAppUrl(config, returnTo));
  response.cookies.set(authCookieNames(config.webProfile).state, "", { ...serverSessionCookieOptions(config, false), maxAge: 0 });
  response.cookies.set(authCookieNames(config.webProfile).pkce, "", { ...serverSessionCookieOptions(config, false), maxAge: 0 });
  response.cookies.set(authCookieNames(config.webProfile).session, selector, serverSessionCookieOptions(config, persistent, absoluteExpiresAt, nowMs));
  for (const name of [authCookieNames(config.webProfile).attempt, authCookieNames(config.webProfile).signedOut]) response.cookies.set(name, "", { ...serverSessionCookieOptions(config, false), maxAge: 0 });
  response.cookies.set(
    authCookieNames(config.webProfile).sync,
    await createCentralSsoSyncMarker(config, selector),
    centralSsoSyncCookieOptions(config),
  );
  return response;
}

function redirectToLogin(config: ReturnType<typeof getAklConfig>, returnTo: string) {
  const loginUrl = manualLoginUrl(config, returnTo);
  const response = redirectTo(loginUrl);
  const expired = { ...serverSessionCookieOptions(config, false), maxAge: 0 };
  response.cookies.set(authCookieNames(config.webProfile).state, "", expired);
  response.cookies.set(authCookieNames(config.webProfile).pkce, "", expired);
  response.cookies.set(authCookieNames(config.webProfile).session, "", expired);
  response.cookies.set(authCookieNames(config.webProfile).sync, "", expired);
  response.cookies.set(authCookieNames(config.webProfile).attempt, "1", serverSessionCookieOptions(config, false));
  return response;
}

function redirectTo(targetUrl: string) {
  const response = NextResponse.redirect(targetUrl, 303);
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}
