import assert from "node:assert/strict";
import test from "node:test";

import {
  PublicDeliveryLimitError,
  PublicDeliveryLimiter,
  publicClientKey,
  publicRateLimitResponse,
  streamWithPublicDeliveryLease,
  type PublicDeliveryLimiterSettings
} from "@/lib/public-delivery-limiter";

function settings(overrides: Partial<PublicDeliveryLimiterSettings> = {}): PublicDeliveryLimiterSettings {
  return {
    windowMs: 60_000,
    perClientSlugRate: 2,
    globalRate: 3,
    perClientConcurrency: 1,
    globalConcurrency: 2,
    maxRateKeys: 10,
    ...overrides
  };
}

test("public limiter enforces per-client/slug rate and emits a bounded 429", async () => {
  const limiter = new PublicDeliveryLimiter(settings());
  limiter.acquire("client-a", "public-guide").release();
  limiter.acquire("client-a", "public-guide").release();

  assert.throws(
    () => limiter.acquire("client-a", "public-guide"),
    PublicDeliveryLimitError
  );
  const response = publicRateLimitResponse(new PublicDeliveryLimitError(7));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "7");
  assert.equal((await response.json()).error.code, "PUBLIC_RATE_LIMITED");
});

test("global rate remains effective when forwarded client identities are spoofed", () => {
  const limiter = new PublicDeliveryLimiter(settings({ perClientSlugRate: 10, globalRate: 2 }));
  limiter.acquire("spoofed-a", "public-guide").release();
  limiter.acquire("spoofed-b", "public-guide").release();
  assert.throws(
    () => limiter.acquire("spoofed-c", "public-guide"),
    PublicDeliveryLimitError
  );
});

test("public limiter holds per-client and global concurrency until a lease is released", () => {
  const limiter = new PublicDeliveryLimiter(
    settings({ perClientSlugRate: 20, globalRate: 20, perClientConcurrency: 1, globalConcurrency: 2 })
  );
  const first = limiter.acquire("client-a", "document-a");
  assert.throws(() => limiter.acquire("client-a", "document-b"), PublicDeliveryLimitError);
  const second = limiter.acquire("client-b", "document-a");
  assert.throws(() => limiter.acquire("client-c", "document-a"), PublicDeliveryLimitError);
  first.release();
  const third = limiter.acquire("client-c", "document-a");
  second.release();
  third.release();
});

test("public limiter keeps its client/slug map bounded and only prunes expired windows", () => {
  let now = 1_000;
  const limiter = new PublicDeliveryLimiter(
    settings({ maxRateKeys: 1, perClientSlugRate: 20, globalRate: 20 }),
    () => now
  );
  limiter.acquire("client-a", "document-a").release();
  assert.throws(() => limiter.acquire("client-b", "document-b"), PublicDeliveryLimitError);
  now += 60_001;
  limiter.acquire("client-b", "document-b").release();
});

test("client key trusts only the configured right-hand proxy chain and never stores raw IP", () => {
  const env = {
    AKL_PUBLIC_TRUSTED_PROXY_HOPS: "1",
    AKL_PUBLIC_CLIENT_KEY_SECRET: "test-public-client-key-secret-at-least-32-characters"
  };
  const direct = publicClientKey(new Headers({ "X-Forwarded-For": "203.0.113.7" }), env);
  const prefixed = publicClientKey(
    new Headers({ "X-Forwarded-For": "198.51.100.99, 203.0.113.7" }),
    env
  );
  const different = publicClientKey(new Headers({ "X-Forwarded-For": "203.0.113.8" }), env);
  assert.equal(direct, prefixed);
  assert.notEqual(direct, different);
  assert.equal(direct.includes("203.0.113.7"), false);

  const conservativeA = publicClientKey(
    new Headers({ "X-Forwarded-For": "203.0.113.7" }),
    { ...env, AKL_PUBLIC_TRUSTED_PROXY_HOPS: "0" }
  );
  const conservativeB = publicClientKey(
    new Headers({ "X-Forwarded-For": "203.0.113.8" }),
    { ...env, AKL_PUBLIC_TRUSTED_PROXY_HOPS: "0" }
  );
  assert.equal(conservativeA, conservativeB);
});

test("stream wrapper releases concurrency on completion and cancellation", async () => {
  let releases = 0;
  const complete = streamWithPublicDeliveryLease(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
        controller.close();
      }
    }),
    { release: () => releases++ }
  );
  assert.deepEqual(new Uint8Array(await new Response(complete).arrayBuffer()), Uint8Array.from([1, 2, 3]));
  assert.equal(releases, 1);

  const cancelled = streamWithPublicDeliveryLease(
    new ReadableStream<Uint8Array>({ pull() {} }),
    { release: () => releases++ }
  );
  await cancelled.cancel();
  assert.equal(releases, 2);
});
