import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildReturnTarget,
  documentCitationHref,
  documentDetailHref,
  requestedDocumentPage,
  resolveDocumentReturnNavigation,
  withDocumentReturnContext,
} from "../src/lib/navigation/document-navigation";

describe("document return navigation", () => {
  it("pins a citation to the exact document version, chunk and page", () => {
    const href = documentCitationHref({
      document_id: "doc_law",
      document_version_id: "ver_2023",
      chunk_id: "chunk_section_27",
      page_number: 4,
    }, { returnTo: "/controlled-documentation?valid_on=2023-07-31", origin: "controlled_documentation" });
    const url = new URL(href, "https://akb.invalid");
    assert.equal(url.pathname, "/documents/doc_law");
    assert.equal(url.searchParams.get("version"), "ver_2023");
    assert.equal(url.searchParams.get("chunk_id"), "chunk_section_27");
    assert.equal(url.searchParams.get("page"), "4");
    assert.equal(url.searchParams.get("tab"), "viewer");
    assert.equal(url.searchParams.get("return_to"), "/controlled-documentation?valid_on=2023-07-31");
  });

  it("accepts only bounded positive page numbers", () => {
    assert.equal(requestedDocumentPage("24"), 24);
    for (const value of [null, "", "0", "-1", "1.5", "Infinity", "1e5", "1000000", "4&version=other"]) {
      assert.equal(requestedDocumentPage(value), undefined, String(value));
    }
  });

  it("preserves registry and task filters through a fresh SSO request", () => {
    assert.equal(buildReturnTarget("/documents", {
      q: "AKB & STRATOS", status: ["published", "approved"], unused: undefined,
    }), "/documents?q=AKB+%26+STRATOS&status=published&status=approved");
    for (const route of ["documents", "tasks"]) {
      const page = readFileSync(new URL(`../src/app/${route}/page.tsx`, import.meta.url), "utf8");
      assert.match(page, /getServerRequestContextForPath\(buildReturnTarget\(/);
    }
  });

  it("lets the Next router add the base path exactly once for task navigation", () => {
    const workspace = readFileSync(new URL("../src/features/tasks/workflow-workspace.tsx", import.meta.url), "utf8");
    assert.match(workspace, /router\.replace\(`\/tasks\?\$\{target\}`/);
    assert.doesNotMatch(workspace, /router\.(replace|push)\(withAppBasePath/);
    const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
    assert.match(layout, /export const dynamic = "force-dynamic"/);
  });

  it("resolves the upload document before requesting its SSO context", () => {
    const page = readFileSync(new URL("../src/app/upload/page.tsx", import.meta.url), "utf8");
    assert.match(page, /getServerRequestContextForPath\(returnTo\)/);
    assert.ok(page.indexOf("const requestedDocumentId") < page.indexOf("getServerRequestContextForPath(returnTo)"));
    const target = buildReturnTarget("/upload", new URLSearchParams({ document_id: "doc_102&return_to=//foreign.invalid" }));
    const url = new URL(target, "https://akb.invalid");
    assert.equal(url.origin, "https://akb.invalid");
    assert.equal(url.pathname, "/upload");
    assert.equal(url.searchParams.get("return_to"), null);
    assert.equal(url.searchParams.get("document_id"), "doc_102&return_to=//foreign.invalid");
  });

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
