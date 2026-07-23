import assert from "node:assert/strict";
import test from "node:test";

import { parseEvaluationCaseIds } from "../src/lib/evaluation-run-request";

test("evaluation case ids preserve validated caller order", () => {
  assert.deepEqual(
    parseEvaluationCaseIds([
      "public_information_systems_law",
      "digital_services_law"
    ]),
    {
      ok: true,
      caseIds: ["public_information_systems_law", "digital_services_law"]
    }
  );
});

test("evaluation case ids remain optional", () => {
  assert.deepEqual(parseEvaluationCaseIds(undefined), {
    ok: true,
    caseIds: undefined
  });
});

test("evaluation case ids reject malformed and duplicate values", () => {
  assert.equal(parseEvaluationCaseIds("public_information_systems_law").ok, false);
  assert.equal(parseEvaluationCaseIds([""]).ok, false);
  assert.equal(parseEvaluationCaseIds(["case-a", "case-a"]).ok, false);
  assert.equal(parseEvaluationCaseIds(["case-a", 7]).ok, false);
});
