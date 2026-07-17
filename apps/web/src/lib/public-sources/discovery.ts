import "server-only";

import { publicSourceCollection, type PublicSourceCollection } from "./catalog";

const MAX_REDIRECTS = 5;
const PAGE_TIMEOUT_MS = 20_000;
const PAGE_MAX_BYTES = 2 * 1024 * 1024;

export interface PublicSourceCandidate {
  title: string;
  sourceUrl: string;
  canonicalUrl: string;
}

export interface PublicSourceDiscoveryResult {
  collectionId: string;
  candidates: PublicSourceCandidate[];
  pagesVisited: number;
  warnings: string[];
}

type Fetcher = typeof fetch;

export async function discoverPublicSourceCollection(
  collectionId: string,
  fetcher: Fetcher = fetch,
): Promise<PublicSourceDiscoveryResult> {
  const collection = publicSourceCollection(collectionId);
  if (!collection) throw new Error("Unknown public source collection.");
  if (collection.syncMode === "api_required") {
    return {
      collectionId,
      candidates: [],
      pagesVisited: 0,
      warnings: [collection.licenseNote],
    };
  }

  const fixed = (collection.fixedDocuments ?? []).map((document) => ({
    title: normalizeTitle(document.title, document.url),
    sourceUrl: normalizedAllowedUrl(document.url, collection).toString(),
    canonicalUrl: normalizedAllowedUrl(
      document.canonicalUrl ?? document.url,
      collection,
    ).toString(),
  }));
  if (collection.syncMode === "fixed") {
    return {
      collectionId,
      candidates: deduplicateCandidates(fixed).slice(0, collection.maxDocuments),
      pagesVisited: 0,
      warnings: [],
    };
  }

  const pages = collection.seedUrls.map((url) => normalizedAllowedUrl(url, collection));
  const queued = new Set(pages.map(String));
  const visited = new Set<string>();
  const candidates = [...fixed];
  const warnings: string[] = [];

  while (
    pages.length > 0
    && visited.size < collection.maxPages
    && candidates.length < collection.maxDocuments
  ) {
    const pageUrl = pages.shift();
    if (!pageUrl || visited.has(pageUrl.toString())) continue;
    visited.add(pageUrl.toString());
    try {
      const response = await safeFetch(pageUrl, collection, fetcher);
      const html = await readBoundedText(response, PAGE_MAX_BYTES);
      for (const anchor of extractAnchors(html, response.url || pageUrl.toString())) {
        let url: URL;
        try {
          url = normalizedAllowedUrl(anchor.href, collection);
        } catch {
          continue;
        }
        if (looksLikeDocument(url, anchor.text)) {
          const sourceUrl = directDocumentUrl(url);
          candidates.push({
            title: normalizeTitle(anchor.text, sourceUrl.toString()),
            sourceUrl: sourceUrl.toString(),
            canonicalUrl: canonicalSourceUrl(sourceUrl).toString(),
          });
          continue;
        }
        if (
          visited.size + pages.length < collection.maxPages
          && isCrawlPage(url, collection)
          && !queued.has(url.toString())
        ) {
          queued.add(url.toString());
          pages.push(url);
        }
      }
    } catch (error) {
      warnings.push(`${pageUrl.toString()}: ${errorMessage(error)}`);
    }
  }

  return {
    collectionId,
    candidates: deduplicateCandidates(candidates).slice(0, collection.maxDocuments),
    pagesVisited: visited.size,
    warnings: warnings.slice(0, 20),
  };
}

export function assertPublicSourceUrl(collectionId: string, value: string): URL {
  const collection = publicSourceCollection(collectionId);
  if (!collection) throw new Error("Unknown public source collection.");
  return normalizedAllowedUrl(value, collection);
}

async function safeFetch(
  input: URL,
  collection: PublicSourceCollection,
  fetcher: Fetcher,
): Promise<Response> {
  let current = normalizedAllowedUrl(input.toString(), collection);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetcher(current, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document;q=0.9,*/*;q=0.1",
        "User-Agent": "STRATOS-AKB-Public-Sources/1.0 (+https://stratos.zeleznalady.cz/akb)",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Official source returned a redirect without Location.");
      current = normalizedAllowedUrl(new URL(location, current).toString(), collection);
      continue;
    }
    if (!response.ok) throw new Error(`Official source returned HTTP ${response.status}.`);
    return response;
  }
  throw new Error("Official source exceeded the redirect limit.");
}

function normalizedAllowedUrl(value: string, collection: PublicSourceCollection): URL {
  const url = new URL(value);
  url.hash = "";
  if (url.protocol !== "https:") throw new Error("Only HTTPS official sources are allowed.");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIpAddress(hostname)) throw new Error("IP-address sources are not allowed.");
  if (!collection.allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    throw new Error("The source host is not approved for this collection.");
  }
  return url;
}

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function isCrawlPage(url: URL, collection: PublicSourceCollection): boolean {
  if (looksLikeDocument(url, "")) return false;
  return collection.crawlPathPrefixes.some((prefix) => url.pathname.startsWith(prefix));
}

function looksLikeDocument(url: URL, text: string): boolean {
  const path = `${url.pathname}${url.search}`.toLowerCase();
  return /\.(pdf|docx)(?:$|[?#])/.test(path)
    || /(?:[?&](?:ext|format)=\.?(?:pdf|docx))(?:&|$)/.test(path)
    || /\b(pdf|docx)\b/i.test(text);
}

function directDocumentUrl(input: URL): URL {
  const url = new URL(input);
  if (url.hostname === "archi.gov.cz" && url.searchParams.get("do") === "media") {
    const media = url.searchParams.get("image") ?? url.searchParams.get("media");
    if (media && /\.(pdf|docx)$/i.test(media)) {
      return new URL(`/_media/${media.replace(/^\/+/, "")}`, url.origin);
    }
  }
  return url;
}

function extractAnchors(html: string, baseUrl: string): Array<{ href: string; text: string }> {
  const anchors: Array<{ href: string; text: string }> = [];
  const pattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>([^<]{0,160})/gi;
  for (const match of html.matchAll(pattern)) {
    const rawHref = match[1] ?? match[2] ?? match[3] ?? "";
    if (!rawHref || /^(?:mailto|tel|javascript|data):/i.test(rawHref)) continue;
    try {
      anchors.push({
        href: new URL(decodeHtml(rawHref), baseUrl).toString(),
        text: decodeHtml(stripTags(`${match[4] ?? ""} ${match[5] ?? ""}`)),
      });
    } catch {
      // Ignore invalid links from the source page.
    }
  }
  return anchors;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function normalizeTitle(value: string, sourceUrl: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (
    cleaned
    && !/^\[?\s*(?:pdf|docx)\s*\]?$/i.test(cleaned)
    && !/^(?:st[aá]hnout|download)\s*(?:pdf|docx|doc)?$/i.test(cleaned)
    && !/^https?:\/\//i.test(cleaned)
  ) {
    return cleaned.slice(0, 300);
  }
  const url = new URL(sourceUrl);
  const filename = decodeURIComponent(url.pathname.split("/").pop() || "Dokument");
  return filename.replace(/\.(pdf|docx)$/i, "").replace(/[-_]+/g, " ").slice(0, 300);
}

function deduplicateCandidates(candidates: PublicSourceCandidate[]): PublicSourceCandidate[] {
  const result = new Map<string, PublicSourceCandidate>();
  for (const candidate of candidates) {
    const key = canonicalCandidateKey(candidate.sourceUrl);
    if (!result.has(key)) result.set(key, candidate);
  }
  return [...result.values()].sort((left, right) => left.title.localeCompare(right.title, "cs"));
}

function canonicalCandidateKey(value: string): string {
  return canonicalSourceUrl(new URL(value)).toString();
}

function canonicalSourceUrl(input: URL): URL {
  const url = new URL(input);
  url.hash = "";
  url.searchParams.delete("tmstv");
  return url;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > maxBytes) throw new Error("Source page is too large.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("Source page is too large.");
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown discovery error.";
}
