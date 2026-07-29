const TOKEN_PATTERN = /[\p{Letter}\p{Number}]+/gu;

/**
 * Matches inflected Czech and English concept labels without maintaining
 * sentence-level command lists. Callers still own the bounded domain catalog.
 */
export function matchesSemanticConcept(
  normalizedText: string,
  terms: readonly string[],
): boolean {
  const textTokens = semanticTokens(normalizedText);
  if (!textTokens.length) return false;
  return terms.some((term) => {
    const termTokens = semanticTokens(term);
    return termTokens.length > 0
      && termTokens.every((termToken) => (
        textTokens.some((textToken) => sameLexeme(textToken, termToken))
      ));
  });
}

export function semanticTokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .match(TOKEN_PATTERN) ?? [];
}

function sameLexeme(left: string, right: string): boolean {
  if (left === right) return true;
  const shorter = Math.min(left.length, right.length);
  if (shorter < 4) return false;
  const requiredPrefix = shorter <= 5 ? 4 : shorter - 1;
  let shared = 0;
  while (shared < shorter && left[shared] === right[shared]) shared += 1;
  return shared >= requiredPrefix;
}
