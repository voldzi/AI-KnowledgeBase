import type { WebProfile } from "@/lib/api/config";

/** Ports do not isolate cookies. Each host application owns its entire OIDC flow. */
export function authCookieNames(profile: WebProfile = "platform") {
  const prefix = profile === "chat" ? "akb_chat" : "akb_platform";
  return {
    session: `${prefix}_session`,
    sync: `${prefix}_sso_sync`,
    attempt: `${prefix}_sso_attempt`,
    signedOut: `${prefix}_sso_signed_out`,
    state: `${prefix}_oidc_state`,
    pkce: `${prefix}_oidc_pkce`,
  } as const;
}
