import type { DocumentVersion } from "@/lib/types";
import { formatDate } from "@/lib/format";
import type { AklLanguage } from "@/lib/i18n";

function lifecycle(version: DocumentVersion): Record<string, unknown> | null {
  const value = version.document_profile_snapshot?.lifecycle;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sourceStart(version: DocumentVersion): string | null {
  const value = lifecycle(version);
  if (value?.mode !== "record") return version.valid_from ?? "";
  return typeof value.recordedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.recordedOn) ? value.recordedOn : null;
}

export function documentVersionTimeline(version: DocumentVersion, language: AklLanguage): string {
  if (lifecycle(version)?.mode === "record") {
    return `${language === "cs" ? "Záznam ze dne" : "Recorded on"} ${formatDate(sourceStart(version), language)}`;
  }
  return `${language === "cs" ? "Účinnost" : "Effective"} ${formatDate(version.valid_from, language)} – ${formatDate(version.valid_to, language)}`;
}

export function documentVersionPublicationLabel(version: DocumentVersion | undefined, language: AklLanguage): string | undefined {
  return version?.status === "valid" && lifecycle(version)?.mode === "record"
    ? language === "cs" ? "Zveřejněný záznam" : "Published record" : undefined;
}

export function latestDocumentVersion(versions: DocumentVersion[]): DocumentVersion | undefined {
  return [...versions].sort((left, right) => right.created_at.localeCompare(left.created_at)
    || right.document_version_id.localeCompare(left.document_version_id))[0];
}

export function selectedDocumentVersion(versions: DocumentVersion[], requestedId: string | null | undefined): DocumentVersion | undefined {
  if (requestedId) return versions.find((version) => version.document_version_id === requestedId);
  return effectiveDocumentVersion(versions) ?? latestDocumentVersion(versions);
}

/** Presentation-only projection of Registry's publication timeline; never an access grant. */
export function effectiveDocumentVersion(
  versions: DocumentVersion[],
  applicableOn = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
): DocumentVersion | undefined {
  const latestStarted = versions.filter((version) => (
    version.status === "valid" || (version.published_at && ["superseded", "archived", "cancelled"].includes(version.status))
  ) && sourceStart(version) !== null && sourceStart(version)! <= applicableOn).sort((left, right) =>
    (sourceStart(right) ?? "").localeCompare(sourceStart(left) ?? "")
    || Date.parse(right.published_at ?? right.created_at) - Date.parse(left.published_at ?? left.created_at)
    || Date.parse(right.created_at) - Date.parse(left.created_at)
    || right.document_version_id.localeCompare(left.document_version_id)
  )[0];
  return latestStarted?.status === "valid" && (!latestStarted.valid_to || latestStarted.valid_to >= applicableOn)
    ? latestStarted : undefined;
}
