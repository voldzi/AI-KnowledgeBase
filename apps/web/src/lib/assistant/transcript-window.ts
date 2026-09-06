export const TRANSCRIPT_WINDOW_SIZE = 60;

/** Bounds rendering only. The full authorized history stays in application state. */
export function transcriptWindow(messageCount: number, requestedEnd: number | null) {
  const end = Math.min(messageCount, Math.max(0, requestedEnd ?? messageCount));
  return { start: Math.max(0, end - TRANSCRIPT_WINDOW_SIZE), end, isLatest: end === messageCount };
}
