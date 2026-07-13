import type { PublicDocumentMetadata } from "@/lib/public-documents";
import { normalizePublicSlug } from "@/lib/public-documents";

export interface PublicDocumentPageModel {
  title: string;
  description: string | null;
  documentType: string;
  versionLabel: string;
  publishedAt: string;
  validity: string;
  filename: string;
  mimeType: string;
  fileSize: string;
  sha256: string;
  downloadHref: string;
}

export function buildPublicDocumentPageModel(
  metadata: PublicDocumentMetadata,
  publicSlug: string,
  basePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH ?? ""
): PublicDocumentPageModel {
  const slug = normalizePublicSlug(publicSlug);
  const snapshot = metadata.snapshot;
  return {
    title: snapshot.title,
    description: snapshot.description,
    documentType: snapshot.documentType,
    versionLabel: snapshot.versionLabel,
    publishedAt: formatPublicDate(snapshot.publishedAt, true),
    validity: formatValidity(snapshot.validFrom, snapshot.validTo),
    filename: snapshot.file.filename,
    mimeType: snapshot.file.mimeType,
    fileSize: formatFileSize(snapshot.file.sizeBytes),
    sha256: snapshot.file.sha256,
    downloadHref: `${normalizeBasePath(basePath)}/api/public/documents/${encodeURIComponent(slug)}/source`
  };
}

export function formatPublicDate(value: string, includeTime = false): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Neuvedeno";
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "long",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
    timeZone: "Europe/Prague"
  }).format(parsed);
}

export function formatValidity(validFrom: string | null, validTo: string | null): string {
  if (!validFrom && !validTo) return "Bez omezení platnosti";
  if (validFrom && validTo) return `${formatPublicDate(validFrom)} – ${formatPublicDate(validTo)}`;
  if (validFrom) return `Od ${formatPublicDate(validFrom)}`;
  return `Do ${formatPublicDate(validTo as string)}`;
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = sizeBytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

export function publicDocumentPageHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'",
    "Content-Type": "text/html; charset=utf-8",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
}

export function renderPublicDocumentPage(document: PublicDocumentPageModel): string {
  const description = document.description
    ? `<p class="description">${escapeHtml(document.description)}</p>`
    : "";
  return htmlDocument(
    `${document.title} | STRATOS AKB`,
    `<article class="card" aria-labelledby="document-title">
      <header class="header">
        ${brandMarkup()}
        <span class="badge">Veřejně publikováno</span>
      </header>
      <section class="intro">
        <p class="eyebrow">Veřejný dokument</p>
        <h1 id="document-title">${escapeHtml(document.title)}</h1>
        ${description}
      </section>
      <dl class="metadata">
        ${metadataItem("Typ dokumentu", document.documentType)}
        ${metadataItem("Verze", document.versionLabel)}
        ${metadataItem("Publikováno", document.publishedAt)}
        ${metadataItem("Platnost", document.validity)}
      </dl>
      <section class="file" aria-labelledby="file-title">
        <div>
          <p class="eyebrow">Schválený soubor</p>
          <h2 id="file-title">${escapeHtml(document.filename)}</h2>
          <p>${escapeHtml(document.mimeType)} · ${escapeHtml(document.fileSize)}</p>
        </div>
        <a class="download" href="${escapeHtml(document.downloadHref)}">↓&nbsp; Stáhnout ověřenou verzi</a>
      </section>
      <details class="integrity">
        <summary>Kontrolní otisk souboru</summary>
        <code>${escapeHtml(document.sha256)}</code>
      </details>
      <aside class="notice" aria-label="Informace o veřejném přístupu">
        Tato stránka zpřístupňuje pouze explicitně schválenou neměnnou verzi.
        Dostupnost se znovu ověřuje při každém načtení stránky i stažení souboru.
      </aside>
      <footer>STRATOS AKB · veřejná publikační hranice</footer>
    </article>`
  );
}

export function renderPublicDocumentUnavailablePage(): string {
  return htmlDocument(
    "Dokument není dostupný | STRATOS AKB",
    `<section class="card unavailable" aria-labelledby="unavailable-title">
      ${brandMarkup()}
      <div class="unavailable-copy">
        <p class="eyebrow">Veřejný dokument</p>
        <h1 id="unavailable-title">Dokument není dostupný</h1>
        <p>Dokument neexistuje, jeho veřejná publikace byla odvolána nebo nyní nelze bezpečně ověřit její platnost.</p>
        <p class="fail-closed">Z bezpečnostních důvodů nebyl zobrazen žádný obsah ani metadata.</p>
      </div>
    </section>`
  );
}

function htmlDocument(title: string, content: string): string {
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
  <style>${PUBLIC_DOCUMENT_PAGE_CSS}</style>
</head>
<body><main class="page">${content}</main></body>
</html>`;
}

function brandMarkup(): string {
  return `<div class="brand" aria-label="STRATOS AI Knowledge Base">
    <span class="brand-mark" aria-hidden="true">S</span>
    <span><strong>STRATOS</strong><small>AI Knowledge Base</small></span>
  </div>`;
}

function metadataItem(label: string, value: string): string {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] as string);
}

const PUBLIC_DOCUMENT_PAGE_CSS = String.raw`
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#132025;background:#edf3f4}*{box-sizing:border-box}body{margin:0;min-width:320px}.page{align-items:flex-start;background:radial-gradient(circle at 10% 0%,rgba(18,109,131,.12),transparent 34rem),linear-gradient(180deg,#f4f8f8,#edf3f4);display:flex;min-height:100vh;padding:clamp(24px,6vw,76px) 20px}.card{background:rgba(255,255,255,.98);border:1px solid #d6e1e4;border-radius:18px;box-shadow:0 24px 70px rgba(28,45,52,.11);margin:0 auto;max-width:920px;overflow:hidden;width:100%}.header{align-items:center;border-bottom:1px solid #e2e9eb;display:flex;gap:20px;justify-content:space-between;padding:22px clamp(22px,5vw,48px)}.brand{align-items:center;display:flex;gap:12px}.brand strong,.brand small{display:block}.brand strong{font-size:14px;letter-spacing:.08em}.brand small{color:#66777d;font-size:12px;margin-top:2px}.brand-mark{align-items:center;background:#0c5c6d;border-radius:10px;color:#fff;display:inline-flex;font-size:18px;font-weight:800;height:42px;justify-content:center;width:42px}.badge{background:#e5f6ed;border:1px solid #bce3cd;border-radius:999px;color:#17663f;font-size:12px;font-weight:800;padding:8px 12px}.intro{padding:clamp(34px,7vw,68px) clamp(22px,7vw,72px) 34px}.eyebrow{color:#126d83;font-size:12px;font-weight:800;letter-spacing:.1em;margin:0 0 10px;text-transform:uppercase}h1{font-size:clamp(30px,5vw,48px);letter-spacing:-.035em;line-height:1.08;margin:0;overflow-wrap:anywhere}.description{color:#53646b;font-size:clamp(16px,2.1vw,19px);line-height:1.65;margin:22px 0 0;max-width:72ch;white-space:pre-wrap}.metadata{display:grid;gap:1px;grid-template-columns:repeat(2,minmax(0,1fr));margin:0 clamp(22px,7vw,72px) 36px}.metadata div{border-left:2px solid #c6dde2;padding:11px 18px 16px}.metadata dt{color:#75858b;font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.metadata dd{color:#26383e;font-size:15px;font-weight:700;margin:6px 0 0;overflow-wrap:anywhere}.file{align-items:center;background:#f2f7f8;border:1px solid #d7e5e8;border-radius:14px;display:flex;gap:24px;justify-content:space-between;margin:0 clamp(22px,7vw,72px);padding:22px}.file h2{font-size:17px;margin:0;overflow-wrap:anywhere}.file p:last-child{color:#687980;font-size:13px;margin:7px 0 0}.download{align-items:center;background:#0c5c6d;border-radius:10px;color:#fff;display:inline-flex;flex:0 0 auto;font-size:14px;font-weight:800;justify-content:center;min-height:44px;padding:10px 16px;text-decoration:none}.download:hover{background:#084b59}.download:focus-visible,summary:focus-visible{outline:3px solid rgba(18,109,131,.35);outline-offset:3px}.integrity{border-bottom:1px solid #e0e8ea;color:#5a6c72;font-size:13px;margin:18px clamp(22px,7vw,72px) 0;padding:0 2px 20px}.integrity summary{cursor:pointer;font-weight:750}.integrity code{background:#f4f7f8;border-radius:8px;display:block;font-size:11px;margin-top:12px;overflow-wrap:anywhere;padding:11px}.notice{color:#52646a;font-size:13px;line-height:1.6;margin:0 clamp(22px,7vw,72px);padding:22px 0}.card footer{background:#f8fafb;border-top:1px solid #e4eaec;color:#75858b;font-size:11px;letter-spacing:.06em;padding:17px clamp(22px,5vw,48px);text-align:center;text-transform:uppercase}.unavailable{padding:clamp(32px,7vw,68px)}.unavailable-copy{margin-top:clamp(46px,9vw,90px)}.unavailable-copy>p:not(.eyebrow){color:#586a70;font-size:16px;line-height:1.65;max-width:62ch}.fail-closed{background:#f2f7f8;border-left:3px solid #126d83;font-size:13px!important;margin-top:28px;padding:14px 16px}@media(max-width:680px){.page{padding:0}.card{border:0;border-radius:0;min-height:100vh}.header,.file{align-items:stretch;flex-direction:column}.badge{align-self:flex-start}.metadata{grid-template-columns:1fr}.download{width:100%}}
`;

function normalizeBasePath(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) return "";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}
