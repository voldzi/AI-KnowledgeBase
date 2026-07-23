const CASE_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const MAX_CASE_IDS = 200;

export type EvaluationCaseIdsResult =
  | { ok: true; caseIds: string[] | undefined }
  | { ok: false; code: "INVALID_CASE_IDS"; message: string };

export function parseEvaluationCaseIds(value: unknown): EvaluationCaseIdsResult {
  if (value === undefined || value === null) {
    return { ok: true, caseIds: undefined };
  }
  if (!Array.isArray(value) || value.length > MAX_CASE_IDS) {
    return {
      ok: false,
      code: "INVALID_CASE_IDS",
      message: `case_ids must be an array containing at most ${MAX_CASE_IDS} identifiers.`
    };
  }

  const caseIds: string[] = [];
  const seen = new Set<string>();
  for (const valueItem of value) {
    if (typeof valueItem !== "string") {
      return {
        ok: false,
        code: "INVALID_CASE_IDS",
        message: "Every case_ids item must be a string."
      };
    }
    const caseId = valueItem.trim();
    if (!CASE_ID_PATTERN.test(caseId)) {
      return {
        ok: false,
        code: "INVALID_CASE_IDS",
        message: "Every case_ids item must be a valid evaluation case identifier."
      };
    }
    if (seen.has(caseId)) {
      return {
        ok: false,
        code: "INVALID_CASE_IDS",
        message: "case_ids must not contain duplicate identifiers."
      };
    }
    seen.add(caseId);
    caseIds.push(caseId);
  }
  return { ok: true, caseIds };
}
