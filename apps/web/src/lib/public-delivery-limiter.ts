import { createHmac } from "node:crypto";
import { isIP } from "node:net";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_PER_CLIENT_SLUG_RATE = 30;
const DEFAULT_GLOBAL_RATE = 600;
const DEFAULT_PER_CLIENT_CONCURRENCY = 2;
const DEFAULT_GLOBAL_CONCURRENCY = 24;
const DEFAULT_MAX_RATE_KEYS = 10_000;
const MAX_FORWARDED_FOR_BYTES = 1_024;
const MAX_FORWARDED_FOR_ENTRIES = 16;

export interface PublicDeliveryLimiterSettings {
  windowMs: number;
  perClientSlugRate: number;
  globalRate: number;
  perClientConcurrency: number;
  globalConcurrency: number;
  maxRateKeys: number;
}

interface RateWindow {
  startedAt: number;
  count: number;
}

export interface PublicDeliveryLease {
  release(): void;
}

export class PublicDeliveryLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("The public delivery capacity limit has been reached.");
    this.name = "PublicDeliveryLimitError";
  }
}

export class PublicDeliveryLimiter {
  private readonly rateByClientSlug = new Map<string, RateWindow>();
  private readonly activeByClient = new Map<string, number>();
  private globalRate: RateWindow = { startedAt: 0, count: 0 };
  private globalActive = 0;

  constructor(
    private readonly settings: PublicDeliveryLimiterSettings,
    private readonly now: () => number = Date.now
  ) {}

  acquire(clientKey: string, publicSlug: string): PublicDeliveryLease {
    const now = this.now();
    this.globalRate = currentWindow(this.globalRate, now, this.settings.windowMs);
    const rateKey = `${clientKey}:${publicSlug}`;
    let clientRate = this.rateByClientSlug.get(rateKey);
    if (!clientRate || now - clientRate.startedAt >= this.settings.windowMs) {
      if (!clientRate && this.rateByClientSlug.size >= this.settings.maxRateKeys) {
        this.pruneExpired(now);
      }
      if (!clientRate && this.rateByClientSlug.size >= this.settings.maxRateKeys) {
        throw new PublicDeliveryLimitError(retryAfter(this.globalRate, now, this.settings.windowMs));
      }
      clientRate = { startedAt: now, count: 0 };
      this.rateByClientSlug.set(rateKey, clientRate);
    }

    const clientActive = this.activeByClient.get(clientKey) ?? 0;
    const retrySeconds = Math.max(
      retryAfter(this.globalRate, now, this.settings.windowMs),
      retryAfter(clientRate, now, this.settings.windowMs)
    );
    if (
      this.globalRate.count >= this.settings.globalRate ||
      clientRate.count >= this.settings.perClientSlugRate ||
      this.globalActive >= this.settings.globalConcurrency ||
      clientActive >= this.settings.perClientConcurrency
    ) {
      throw new PublicDeliveryLimitError(retrySeconds);
    }

    this.globalRate.count += 1;
    clientRate.count += 1;
    this.globalActive += 1;
    this.activeByClient.set(clientKey, clientActive + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.globalActive = Math.max(0, this.globalActive - 1);
        const active = this.activeByClient.get(clientKey) ?? 0;
        if (active <= 1) this.activeByClient.delete(clientKey);
        else this.activeByClient.set(clientKey, active - 1);
      }
    };
  }

  private pruneExpired(now: number): void {
    for (const [key, window] of this.rateByClientSlug) {
      if (now - window.startedAt >= this.settings.windowMs) {
        this.rateByClientSlug.delete(key);
      }
    }
  }
}

let limiter: PublicDeliveryLimiter | undefined;
let limiterFingerprint = "";

export function acquirePublicDeliveryLease(
  request: Request,
  publicSlug: string,
  env: Record<string, string | undefined> = process.env
): PublicDeliveryLease {
  const settings = publicDeliveryLimiterSettings(env);
  const fingerprint = JSON.stringify(settings);
  if (!limiter || limiterFingerprint !== fingerprint) {
    limiter = new PublicDeliveryLimiter(settings);
    limiterFingerprint = fingerprint;
  }
  return limiter.acquire(publicClientKey(request.headers, env), publicSlug);
}

export function publicClientKey(
  headers: Headers,
  env: Record<string, string | undefined> = process.env
): string {
  const trustedHops = nonNegativeInteger(env.AKL_PUBLIC_TRUSTED_PROXY_HOPS, 0, 10);
  const forwarded = headers.get("x-forwarded-for") ?? "";
  let clientAddress = "shared-untrusted-client";
  if (trustedHops > 0 && forwarded.length <= MAX_FORWARDED_FOR_BYTES) {
    const addresses = forwarded
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const candidateIndex = addresses.length - trustedHops;
    const candidate = addresses.length <= MAX_FORWARDED_FOR_ENTRIES ? addresses[candidateIndex] : undefined;
    if (candidate && isIP(candidate) !== 0) clientAddress = candidate;
  }
  const secret =
    env.AKL_PUBLIC_CLIENT_KEY_SECRET?.trim() ||
    env.AKL_WEB_SESSION_SECRET?.trim() ||
    "akb-development-public-client-key";
  return createHmac("sha256", secret).update(clientAddress).digest("hex").slice(0, 32);
}

export function publicDeliveryLimiterSettings(
  env: Record<string, string | undefined> = process.env
): PublicDeliveryLimiterSettings {
  return {
    windowMs: positiveInteger(env.AKL_PUBLIC_RATE_WINDOW_MS, DEFAULT_WINDOW_MS, 3_600_000),
    perClientSlugRate: positiveInteger(
      env.AKL_PUBLIC_RATE_PER_CLIENT_SLUG,
      DEFAULT_PER_CLIENT_SLUG_RATE,
      1_000_000
    ),
    globalRate: positiveInteger(env.AKL_PUBLIC_RATE_GLOBAL, DEFAULT_GLOBAL_RATE, 10_000_000),
    perClientConcurrency: positiveInteger(
      env.AKL_PUBLIC_CONCURRENCY_PER_CLIENT,
      DEFAULT_PER_CLIENT_CONCURRENCY,
      10_000
    ),
    globalConcurrency: positiveInteger(
      env.AKL_PUBLIC_CONCURRENCY_GLOBAL,
      DEFAULT_GLOBAL_CONCURRENCY,
      100_000
    ),
    maxRateKeys: positiveInteger(env.AKL_PUBLIC_LIMITER_MAX_KEYS, DEFAULT_MAX_RATE_KEYS, 1_000_000)
  };
}

export function publicRateLimitResponse(error: PublicDeliveryLimitError): Response {
  return Response.json(
    {
      error: {
        code: "PUBLIC_RATE_LIMITED",
        message: "Public document delivery is temporarily busy."
      }
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "Retry-After": String(error.retryAfterSeconds),
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}

export function streamWithPublicDeliveryLease(
  source: ReadableStream<Uint8Array>,
  lease: PublicDeliveryLease
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    lease.release();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          release();
          controller.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        release();
      }
    }
  });
}

function currentWindow(window: RateWindow, now: number, windowMs: number): RateWindow {
  return now - window.startedAt >= windowMs ? { startedAt: now, count: 0 } : window;
}

function retryAfter(window: RateWindow, now: number, windowMs: number): number {
  return Math.max(1, Math.ceil((window.startedAt + windowMs - now) / 1_000));
}

function positiveInteger(raw: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(raw ?? "");
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function nonNegativeInteger(
  raw: string | undefined,
  fallback: number,
  maximum: number
): number {
  const parsed = Number(raw ?? "");
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : fallback;
}
