import assert from "node:assert/strict";
import test from "node:test";

import { controlledDocumentationBridgeError } from "../src/app/api/controlled-documentation/errors";
import {
  controlledDocumentationErrorMessage,
  controlledDocumentationWarningLabel,
  controlledPackageRuleProgress,
} from "../src/lib/controlled-documentation/presentation";
import { ApiClientError } from "../src/lib/types";

test("controlledDocumentationBridgeError preserves Next redirects", () => {
  const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
    digest: "NEXT_REDIRECT;replace;/api/auth/login;307;",
  });

  assert.throws(
    () =>
      controlledDocumentationBridgeError(
        redirectError,
        "CONTROLLED_DOCUMENTATION_REQUEST_FAILED",
        "Request failed.",
      ),
    (error) => error === redirectError,
  );
});

test("controlledDocumentationBridgeError preserves typed upstream errors", async () => {
  const response = controlledDocumentationBridgeError(
    new ApiClientError(
      "Rule is not authorized.",
      403,
      "CONTROLLED_RULE_NOT_AUTHORIZED",
      "trace-controlled-rule",
    ),
    "CONTROLLED_DOCUMENTATION_REQUEST_FAILED",
    "Request failed.",
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: "CONTROLLED_RULE_NOT_AUTHORIZED",
      message: "Request failed.",
      trace_id: "trace-controlled-rule",
    },
  });
});

test("controlled-documentation errors and warnings are human readable", () => {
  assert.match(
    controlledDocumentationErrorMessage(
      "CONTROLLED_DOCUMENT_ACCESS_DENIED",
      "fallback",
    ),
    /Nemáte oprávnění/,
  );
  assert.doesNotMatch(
    controlledDocumentationWarningLabel(
      "NO_APPLICABLE_AUTHORIZED_CONTROLLED_DOCUMENT_PACKAGE",
    ),
    /NO_APPLICABLE/,
  );
});

test("package publication waits for every proposed rule review", () => {
  const progress = controlledPackageRuleProgress("package-1", [
    {
      extraction_id: "extraction-1",
      package_id: "package-1",
      source_type: "internal_directive",
      authority_rank: 60,
      proposal: {
        rule_id: "rule-1",
        normative_key: "procurement.limit",
        category: "financial_limit",
        title: "Limit",
        value: 100000,
        unit: null,
        currency: "CZK",
        vat_basis: "including_vat",
        conditions: [],
        exceptions: [],
        responsible_roles: [],
        required_evidence: [],
        confidence: 0.9,
        citation: {
          document_id: "doc-1",
          document_version_id: "version-1",
          chunk_id: "chunk-1",
          section_path: [],
          page_number: 1,
          article_number: null,
          paragraph_number: null,
          quoted_text: "Limit činí 100 000 Kč.",
        },
      },
      verification_status: "proposed",
      verified_by: null,
      verified_at: null,
      verification_note: null,
      precedence_status: "supplemental",
      consumer_eligible: false,
    },
  ]);

  assert.equal(progress.pending, 1);
  assert.equal(progress.readyForPublication, false);
});

test("controlledDocumentationBridgeError does not disclose unknown failures", async () => {
  const response = controlledDocumentationBridgeError(
    new Error("private upstream detail"),
    "CONTROLLED_DOCUMENTATION_REQUEST_FAILED",
    "Request failed.",
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: {
      code: "CONTROLLED_DOCUMENTATION_REQUEST_FAILED",
      message: "Request failed.",
    },
  });
});
