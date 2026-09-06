import "server-only";

import { createHash } from "node:crypto";
import { parseDocumentProfileInput, parseDocumentVersionProfileDraft } from "@/lib/documents/document-profile-validation";
import { parseDocumentInformationPolicy } from "@/lib/stratos/information-policy";
import { ApiClientError, type ApiRequestContext } from "@/lib/types";
import { publicSourceCollection } from "./catalog";
import type { ApprovedPublicSourceCollection, PreparedPublicSource, PreparePublicSourceRequest } from "./approved-collections";

const MAX_RESPONSE_BYTES = 256 * 1024;
const SCHEMA = "stratos-official-source-collections-1";

function unavailable(context: ApiRequestContext): never {
  throw new ApiClientError("Schválené kolekce nejsou nyní dostupné. Obnovte jejich seznam nebo kontaktujte správce STRATOS.", 503, "PUBLIC_SOURCE_APPROVAL_UNAVAILABLE", context.correlationId ?? "public-source-approval");
}
function record(value: unknown, keys: string[], context: ApiRequestContext): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) unavailable(context);
  return value as Record<string, unknown>;
}
function text(value: unknown, context: ApiRequestContext, max = 300): string {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) unavailable(context);
  return value;
}

export function officialSourceRecordId(collectionId: string, canonicalUrl: string): string {
  return `official-source:${createHash("sha256").update(`${collectionId}\n${canonicalUrl}`).digest("hex")}`;
}

/** Never follows redirects with the actor's bearer and never falls back to an unapproved catalog. */
async function centralRequest(path: string, context: ApiRequestContext, body: unknown | undefined,
  fetcher: typeof fetch, endpoint: string | undefined): Promise<unknown> {
  if (!context.accessToken || context.serviceClientId || !endpoint) unavailable(context);
  let url: URL;
  try {
    url = new URL(endpoint.replace(/\/+$/, "") + path);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) unavailable(context);
  } catch { unavailable(context); }
  try {
    const response = await fetcher(url, {
      method: body === undefined ? "GET" : "POST", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${context.accessToken}`,
        "X-Correlation-ID": context.correlationId ?? context.requestId ?? "public-source-approval" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if ([401, 403, 409, 422, 429].includes(response.status)) {
      const conflict = response.status === 409;
      throw new ApiClientError(conflict ? "Schválení kolekce se změnilo. Obnovte seznam a výběr zopakujte." : "STRATOS nepovolil přípravu tohoto veřejného zdroje.", response.status,
        conflict ? "PUBLIC_SOURCE_APPROVAL_STALE" : "PUBLIC_SOURCE_APPROVAL_DENIED", context.correlationId ?? "public-source-approval");
    }
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json") || !response.body) unavailable(context);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_RESPONSE_BYTES) unavailable(context);
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    unavailable(context);
  }
}

export async function listApprovedPublicSourceCollections(context: ApiRequestContext, fetcher: typeof fetch = fetch,
  endpoint = process.env.AKL_STRATOS_OFFICIAL_SOURCES_URL): Promise<ApprovedPublicSourceCollection[]> {
  const result = record(await centralRequest("/collections", context, undefined, fetcher, endpoint), ["schemaVersion", "collections"], context);
  if (result.schemaVersion !== SCHEMA || !Array.isArray(result.collections) || result.collections.length > 100) unavailable(context);
  const seen = new Set<string>();
  return result.collections.map((value): ApprovedPublicSourceCollection => {
    const item = record(value, ["collectionId", "revision", "displayName", "authorityDisplayName", "ownerDisplayName", "gestorDisplayName", "reviewRuleLabel", "profile", "tlp"], context);
    const profile = record(item.profile, ["id", "revision"], context);
    const collectionId = text(item.collectionId, context, 160);
    if (!publicSourceCollection(collectionId) || seen.has(collectionId) || profile.id !== "akb.official-public-reference" || profile.revision !== "1" || item.tlp !== "TLP:CLEAR") unavailable(context);
    seen.add(collectionId);
    return { collectionId, revision: text(item.revision, context, 160), displayName: text(item.displayName, context),
      authorityDisplayName: text(item.authorityDisplayName, context), ownerDisplayName: text(item.ownerDisplayName, context),
      gestorDisplayName: text(item.gestorDisplayName, context), reviewRuleLabel: text(item.reviewRuleLabel, context),
      profile: { id: "akb.official-public-reference", revision: "1" }, tlp: "TLP:CLEAR" };
  });
}

export function validatePreparedPublicSource(value: unknown, request: PreparePublicSourceRequest, context: ApiRequestContext): PreparedPublicSource {
  const body = record(value, ["schemaVersion", "collectionId", "collectionRevision", "sourceUrl", "canonicalUrl", "title", "documentType", "documentProfile", "documentVersionProfile", "informationPolicy"], context);
  const collection = publicSourceCollection(request.collectionId);
  if (!collection || body.schemaVersion !== "stratos-official-source-preparation-1" || body.collectionId !== request.collectionId
      || body.collectionRevision !== request.expectedCollectionRevision || body.sourceUrl !== request.sourceUrl || body.canonicalUrl !== request.canonicalUrl
      || body.title !== request.title || body.documentType !== collection.documentType) unavailable(context);
  try {
    const root = parseDocumentProfileInput(body.documentProfile, { documentType: collection.documentType, sourceSystem: "AKB_OFFICIAL_SOURCE" });
    const version = parseDocumentVersionProfileDraft(body.documentVersionProfile, root);
    const policy = parseDocumentInformationPolicy(body.informationPolicy);
    if (root.profile.id !== "akb.official-public-reference" || root.provenance.sourceRecordId !== officialSourceRecordId(request.collectionId, request.canonicalUrl)
        || policy.handlingClass !== "PUBLIC" || policy.tlp !== "TLP:CLEAR" || policy.audience.scopeType !== "organization"
        || version.domain_evidence.collectionId !== request.collectionId || version.domain_evidence.canonicalSourceUrl !== request.canonicalUrl
        || version.domain_evidence.sourceKind !== (collection.documentType === "regulation" ? "regulation" : "reference")
        || !root.authorship.some((author) => author.id === version.domain_evidence.authorityReference && ["organization", "external_authority"].includes(author.kind))
        || (request.effectiveFrom !== null && version.lifecycle.effectiveFrom !== request.effectiveFrom)
        || version.lifecycle.effectiveTo !== request.effectiveTo) unavailable(context);
    return { ...(body as unknown as PreparedPublicSource), documentProfile: root, documentVersionProfile: version, informationPolicy: policy };
  } catch (error) {
    if (error instanceof ApiClientError && error.code === "PUBLIC_SOURCE_APPROVAL_UNAVAILABLE") throw error;
    unavailable(context);
  }
}

export async function preparePublicSource(request: PreparePublicSourceRequest, context: ApiRequestContext, fetcher: typeof fetch = fetch,
  endpoint = process.env.AKL_STRATOS_OFFICIAL_SOURCES_URL): Promise<PreparedPublicSource> {
  text(request.expectedCollectionRevision, context, 160);
  const result = await centralRequest("/sources/prepare", context, { schemaVersion: "stratos-official-source-prepare-1", ...request }, fetcher, endpoint);
  return validatePreparedPublicSource(result, request, context);
}
