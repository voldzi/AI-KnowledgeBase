import type { PublicSourceCandidate } from "./discovery";

export function selectPublicSourceCandidates(
  candidates: PublicSourceCandidate[],
  query: string,
): PublicSourceCandidate[] {
  const terms = query
    .split(/[,;\n]+/)
    .map(normalizeSearchText)
    .filter(Boolean);
  if (terms.length === 0) return candidates;

  return candidates.filter((candidate) => {
    const searchable = normalizeSearchText([
      candidate.title,
      candidate.versionLabel,
      candidate.canonicalUrl,
      candidate.sourceUrl,
    ].filter(Boolean).join(" "));
    return terms.some((term) => searchable.includes(term));
  });
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("cs-CZ")
    .replace(/\s+/g, " ")
    .trim();
}
