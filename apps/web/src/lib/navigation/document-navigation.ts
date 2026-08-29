import type { AklLanguage } from "@/lib/i18n";

export const DOCUMENT_RETURN_ORIGINS = [
  "registry",
  "controlled_documentation",
  "tasks",
  "intelligence",
  "document",
  "upload",
  "ingestion",
  "audit",
  "chat",
] as const;

export type DocumentReturnOrigin = (typeof DOCUMENT_RETURN_ORIGINS)[number];

export interface DocumentReturnNavigation {
  href: string;
  origin: DocumentReturnOrigin;
}

const FALLBACK_NAVIGATION: DocumentReturnNavigation = {
  href: "/documents",
  origin: "registry",
};

const originLabels: Record<DocumentReturnOrigin, Record<AklLanguage, string>> = {
  registry: { cs: "Zpět do registru", en: "Back to registry" },
  controlled_documentation: {
    cs: "Zpět na řízené předpisy",
    en: "Back to controlled documentation",
  },
  tasks: { cs: "Zpět k úkolům", en: "Back to tasks" },
  intelligence: { cs: "Zpět do Intelligence", en: "Back to Intelligence" },
  document: { cs: "Zpět na předchozí dokument", en: "Back to previous document" },
  upload: { cs: "Zpět k nahrávání", en: "Back to upload" },
  ingestion: { cs: "Zpět ke zpracování", en: "Back to processing" },
  audit: { cs: "Zpět k auditu", en: "Back to audit" },
  chat: { cs: "Zpět do konverzace", en: "Back to conversation" },
};

export function isDocumentReturnOrigin(value: string | null | undefined): value is DocumentReturnOrigin {
  return DOCUMENT_RETURN_ORIGINS.includes(value as DocumentReturnOrigin);
}

export function documentReturnLabel(origin: DocumentReturnOrigin, language: AklLanguage): string {
  return originLabels[origin][language];
}

export function documentReturnContextLabel(
  origin: string | null | undefined,
  language: AklLanguage,
): string | null {
  if (!isDocumentReturnOrigin(origin)) return null;
  const labels: Record<DocumentReturnOrigin, Record<AklLanguage, string>> = {
    registry: { cs: "Detail dokumentu", en: "Document detail" },
    controlled_documentation: { cs: "Řízené předpisy", en: "Controlled documentation" },
    tasks: { cs: "Dokument úkolu", en: "Task document" },
    intelligence: { cs: "Zdroj Intelligence", en: "Intelligence source" },
    document: { cs: "Související dokument", en: "Related document" },
    upload: { cs: "Nahraný dokument", en: "Uploaded document" },
    ingestion: { cs: "Zpracovávaný dokument", en: "Processing document" },
    audit: { cs: "Auditovaný dokument", en: "Audited document" },
    chat: { cs: "Citovaný dokument", en: "Cited document" },
  };
  return labels[origin][language];
}

export function resolveDocumentReturnNavigation(input: {
  returnTo: string | null | undefined;
  origin: string | null | undefined;
  currentDocumentId?: string | null;
}): DocumentReturnNavigation {
  const href = normalizeInternalReturnTarget(input.returnTo);
  const origin = isDocumentReturnOrigin(input.origin)
    ? input.origin
    : href
      ? inferDocumentReturnOrigin(href)
      : null;
  if (!href || !origin || !returnTargetMatchesOrigin(href, origin)) {
    return FALLBACK_NAVIGATION;
  }
  if (
    origin === "document" &&
    input.currentDocumentId &&
    returnPathname(href) === `/documents/${encodeURIComponent(input.currentDocumentId)}`
  ) {
    return FALLBACK_NAVIGATION;
  }
  return { href, origin };
}

export function documentDetailHref(input: {
  documentId: string;
  returnTo?: string | null;
  origin?: DocumentReturnOrigin | null;
  params?: URLSearchParams | Record<string, string | null | undefined>;
  hash?: string | null;
}): string {
  const params = input.params instanceof URLSearchParams
    ? new URLSearchParams(input.params)
    : new URLSearchParams();
  if (input.params && !(input.params instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(input.params)) {
      if (value !== null && value !== undefined && value !== "") params.set(key, value);
    }
  }
  if (input.returnTo && input.origin) {
    params.set("return_to", input.returnTo);
    params.set("origin", input.origin);
  }
  const query = params.toString();
  const hash = input.hash ? `#${input.hash.replace(/^#/, "")}` : "";
  return `/documents/${encodeURIComponent(input.documentId)}${query ? `?${query}` : ""}${hash}`;
}

export function documentCitationHref(
  citation: {
    document_id: string;
    document_version_id: string;
    chunk_id: string;
    page_number?: number | null;
  },
  navigation: { returnTo: string; origin: DocumentReturnOrigin },
): string {
  return documentDetailHref({
    documentId: citation.document_id,
    ...navigation,
    params: {
      tab: "viewer",
      version: citation.document_version_id,
      chunk_id: citation.chunk_id,
      page: citation.page_number && Number.isSafeInteger(citation.page_number) && citation.page_number > 0
        ? String(citation.page_number)
        : undefined,
    },
  });
}

export function requestedDocumentPage(value: string | null): number | undefined {
  if (!value || !/^[1-9]\d{0,5}$/.test(value)) return undefined;
  return Number(value);
}

export function withDocumentReturnContext(
  href: string,
  returnTo: string,
  origin: DocumentReturnOrigin,
): string {
  const normalized = normalizeInternalReturnTarget(href);
  if (!normalized) return href;
  const url = new URL(normalized, "https://akb.invalid");
  if (!/^\/documents\/[^/]+$/.test(url.pathname) || url.pathname === "/documents/new") {
    return href;
  }
  url.searchParams.set("return_to", returnTo);
  url.searchParams.set("origin", origin);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildReturnTarget(
  pathname: string,
  params?: URLSearchParams | Record<string, string | string[] | undefined>,
  hash?: string | null,
): string {
  const search = params instanceof URLSearchParams ? params : new URLSearchParams();
  if (params && !(params instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) value.forEach((item) => search.append(key, item));
      else if (value !== undefined) search.set(key, value);
    }
  }
  const query = search.toString();
  const normalizedHash = hash ? `#${hash.replace(/^#/, "")}` : "";
  return `${pathname}${query ? `?${query}` : ""}${normalizedHash}`;
}

function normalizeInternalReturnTarget(value: string | null | undefined): string | null {
  if (!value || value.length > 4096) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const base = new URL("https://akb.invalid");
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin || parsed.username || parsed.password) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function inferDocumentReturnOrigin(href: string): DocumentReturnOrigin | null {
  const pathname = returnPathname(href);
  if (pathname === "/documents") return "registry";
  if (pathname === "/controlled-documentation") return "controlled_documentation";
  if (pathname === "/tasks") return "tasks";
  if (pathname === "/intelligence" || pathname.startsWith("/intelligence/")) return "intelligence";
  if (/^\/documents\/[^/]+$/.test(pathname)) return "document";
  if (pathname === "/upload") return "upload";
  if (pathname === "/ingestion") return "ingestion";
  if (pathname === "/audit") return "audit";
  if (pathname === "/chat") return "chat";
  return null;
}

function returnTargetMatchesOrigin(href: string, origin: DocumentReturnOrigin): boolean {
  return inferDocumentReturnOrigin(href) === origin;
}

function returnPathname(href: string): string {
  return new URL(href, "https://akb.invalid").pathname;
}
