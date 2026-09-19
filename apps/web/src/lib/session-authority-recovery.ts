import { stratosAccessFingerprint } from "@voldzi/stratos-ui/auth";

export type SessionAuthority = {
  subjectId: string;
  capabilities?: string[];
  applicationAccess?: unknown;
};

export type SessionAuthorityPayload = {
  authenticated: boolean;
  user?: SessionAuthority;
};

export type SessionRecoveryResult = "verified" | "changed" | "signed-out" | "unavailable";

export const sessionAuthorityFingerprint = (user: SessionAuthority) => stratosAccessFingerprint({
  subjectId: user.subjectId,
  capabilities: user.capabilities ?? [],
  applicationAccess: user.applicationAccess ?? [],
});

const abortError = () => new DOMException("Session recovery cancelled", "AbortError");

async function waitFor(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", cancel);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reject(abortError());
    };
    signal.addEventListener("abort", cancel, { once: true });
  });
}

/**
 * Re-check a temporarily unavailable authority while protected content stays
 * unmounted. A changed or signed-out identity is never restored in place.
 */
export async function recoverSessionAuthority({
  read,
  expectedFingerprint,
  signal,
  delaysMs = [750, 1_500, 3_000],
}: {
  read: (signal: AbortSignal) => Promise<SessionAuthorityPayload>;
  expectedFingerprint: string;
  signal: AbortSignal;
  delaysMs?: number[];
}): Promise<SessionRecoveryResult> {
  for (const delayMs of delaysMs) {
    try {
      await waitFor(delayMs, signal);
      const payload = await read(signal);
      if (!payload.authenticated || !payload.user?.subjectId) return "signed-out";
      return sessionAuthorityFingerprint(payload.user) === expectedFingerprint ? "verified" : "changed";
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    }
  }
  return "unavailable";
}
