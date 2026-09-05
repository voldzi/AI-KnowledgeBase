import type { JWTPayload } from "jose";

export type SessionPolicyReason = "CENTRAL_REMEMBER_DEVICE" | "CENTRAL_BROWSER_SESSION" | "REMEMBER_CLAIM_MISSING" | "REMEMBER_CLAIM_INVALID" | "SESSION_START_MISSING" | "SESSION_START_INVALID";

export interface CentralSessionPolicy {
  rememberDevice: boolean;
  centralSessionStartedAt?: number;
  sessionAbsoluteExpiresAt: number;
  sessionPolicyReason: SessionPolicyReason;
}

// Call only after access-token signature, issuer, audience and subject checks.
// ID tokens, userinfo and browser parameters are not session-policy evidence.
export function centralSessionPolicy(claims: JWTPayload, nowMs: number, previous?: CentralSessionPolicy): CentralSessionPolicy {
  const remember = claims.stratos_remember_device;
  const start = claims.stratos_session_started_at;
  const validStart = typeof start === "number" && Number.isSafeInteger(start) && start > 0 && start <= Math.floor(nowMs / 1000) + 30;
  const reason: SessionPolicyReason = remember === undefined ? "REMEMBER_CLAIM_MISSING"
    : typeof remember !== "boolean" ? "REMEMBER_CLAIM_INVALID"
      : start === undefined ? "SESSION_START_MISSING" : !validStart ? "SESSION_START_INVALID"
        : remember ? "CENTRAL_REMEMBER_DEVICE" : "CENTRAL_BROWSER_SESSION";
  if (validStart && previous?.centralSessionStartedAt !== undefined && start !== previous.centralSessionStartedAt) throw new Error("CENTRAL_SESSION_START_CHANGED");
  const persistent = reason === "CENTRAL_REMEMBER_DEVICE";
  const sourceStart = validStart ? start : previous?.centralSessionStartedAt;
  const base = sourceStart === undefined ? nowMs : Math.min(sourceStart * 1000, nowMs);
  const absolute = Math.min(base + (persistent ? 90 : 1) * 86_400_000, previous?.sessionAbsoluteExpiresAt ?? Infinity);
  if (absolute <= nowMs) throw new Error("CENTRAL_SESSION_EXPIRED");
  return { rememberDevice: persistent, centralSessionStartedAt: sourceStart, sessionAbsoluteExpiresAt: absolute, sessionPolicyReason: reason };
}
