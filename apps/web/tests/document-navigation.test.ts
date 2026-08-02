import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildReturnTarget,
  documentDetailHref,
  resolveDocumentReturnNavigation,
  withDocumentReturnContext,
} from "../src/lib/navigation/document-navigation";

describe("document return navigation", () => {
  it("wires registry, controlled documentation, tasks and Intelligence entry points", () => {
    const sources = [
      "../src/features/documents/document-registry.tsx",
      "../src/features/controlled-documentation/controlled-documentation-workbench.tsx",
      "../src/features/tasks/workflow-inbox.tsx",
      "../src/features/intelligence/intelligence-workbench.tsx",
    ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
    for (const source of sources) assert.match(source, /returnTo|ReturnTo/);
    assert.match(sources[0], /origin: "registry"/);
    assert.match(sources[1], /origin: "controlled_documentation"/);
    assert.match(sources[2], /withDocumentReturnContext\(task\.href, returnTo, "tasks"\)/);
    assert.match(sources[3], /origin: "intelligence"/);
  });

  it("returns a controlled-document attachment to its exact package snapshot", () => {
    const returnTo = buildReturnTarget(
      "/controlled-documentation",
      new URLSearchParams({ domain: "public_procurement", valid_on: "2026-07-31" }),
      "controlled-package-pkg_123",
    );
    const href = documentDetailHref({
      documentId: "doc_attachment",
      returnTo,
      origin: "controlled_documentation",
    });
    const parsed = new URL(href, "https://akb.invalid");
    assert.equal(parsed.pathname, "/documents/doc_attachment");
    assert.equal(parsed.searchParams.get("return_to"), returnTo);
    assert.deepEqual(
      resolveDocumentReturnNavigation({
        returnTo: parsed.searchParams.get("return_to"),
        origin: parsed.searchParams.get("origin"),
      }),
      { href: returnTo, origin: "controlled_documentation" },
    );
  });

  it("preserves existing viewer parameters when adding task context", () => {
    const href = withDocumentReturnContext(
      "/documents/doc_123?tab=viewer&chunk_id=chunk_9#source",
      "/tasks?task=task_1&status=open",
      "tasks",
    );
    const parsed = new URL(href, "https://akb.invalid");
    assert.equal(parsed.searchParams.get("tab"), "viewer");
    assert.equal(parsed.searchParams.get("chunk_id"), "chunk_9");
    assert.equal(parsed.searchParams.get("return_to"), "/tasks?task=task_1&status=open");
    assert.equal(parsed.hash, "#source");
  });

  it("fails closed for external, mismatched and malformed return targets", () => {
    for (const input of [
      { returnTo: "https://example.com/", origin: "tasks" },
      { returnTo: "//example.com/path", origin: "tasks" },
      { returnTo: "/controlled-documentation", origin: "tasks" },
      { returnTo: "/api/admin", origin: "registry" },
      { returnTo: "/tasks\\external", origin: "tasks" },
    ]) {
      assert.deepEqual(resolveDocumentReturnNavigation(input), {
        href: "/documents",
        origin: "registry",
      });
    }
  });

  it("does not create a self-referencing document return loop", () => {
    assert.deepEqual(
      resolveDocumentReturnNavigation({
        returnTo: "/documents/doc_same?tab=viewer",
        origin: "document",
        currentDocumentId: "doc_same",
      }),
      { href: "/documents", origin: "registry" },
    );
  });

  it("keeps the registry as the fallback for direct deep links", () => {
    assert.deepEqual(
      resolveDocumentReturnNavigation({ returnTo: null, origin: null }),
      { href: "/documents", origin: "registry" },
    );
  });
});
