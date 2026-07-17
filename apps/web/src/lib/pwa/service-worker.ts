export interface ChatServiceWorkerOptions {
  version: string;
}

export function createChatServiceWorker({
  version,
}: ChatServiceWorkerOptions): string {
  const cacheVersion = safeVersion(version);
  return `
const CACHE_PREFIX = "akb-chat-static-";
const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(cacheVersion)};
const OFFLINE_URL = "/offline.html";
const SAFE_PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/akb-chat-192.png",
  "/icons/akb-chat-512.png",
  "/icons/akb-chat-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SAFE_PRECACHE.map((path) => new Request(path, { cache: "reload" })))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/documents/")
    || url.pathname.includes("/source/")
    || url.pathname.includes("/export")
  ) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached || new Response("AKB Chat je offline.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      })
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(async (cached) => {
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      })
    );
    return;
  }

  if (
    url.pathname === "/manifest.webmanifest"
    || url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});
`.trim();
}

function safeVersion(version: string): string {
  const normalized = version.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  return normalized || "development";
}
