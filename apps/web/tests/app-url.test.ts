import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { withAppBasePath } from "../src/lib/app-url";

const originalBasePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH;

afterEach(() => {
  if (originalBasePath === undefined) {
    delete process.env.NEXT_PUBLIC_AKL_BASE_PATH;
  } else {
    process.env.NEXT_PUBLIC_AKL_BASE_PATH = originalBasePath;
  }
});

describe("app URL helpers", () => {
  it("adds the configured app base path to direct relative URLs", () => {
    process.env.NEXT_PUBLIC_AKL_BASE_PATH = "/akb/";

    assert.equal(withAppBasePath("/api/health"), "/akb/api/health");
    assert.equal(withAppBasePath("api/health"), "/akb/api/health");
  });

  it("does not add the configured app base path twice", () => {
    process.env.NEXT_PUBLIC_AKL_BASE_PATH = "/akb";

    assert.equal(withAppBasePath("/akb/api/documents/source/content?token=abc"), "/akb/api/documents/source/content?token=abc");
    assert.equal(withAppBasePath("/akb/documents/doc_123#versions"), "/akb/documents/doc_123#versions");
    assert.equal(withAppBasePath("/akb"), "/akb");
  });

  it("keeps absolute and page-local URLs untouched", () => {
    process.env.NEXT_PUBLIC_AKL_BASE_PATH = "/akb";

    assert.equal(withAppBasePath("https://stratos.zeleznalady.cz/akb/api/health"), "https://stratos.zeleznalady.cz/akb/api/health");
    assert.equal(withAppBasePath("mailto:support@example.test"), "mailto:support@example.test");
    assert.equal(withAppBasePath("tel:+420123456789"), "tel:+420123456789");
    assert.equal(withAppBasePath("#versions"), "#versions");
    assert.equal(withAppBasePath("?tab=viewer"), "?tab=viewer");
  });

  it("keeps document routes under the configured app base path", () => {
    process.env.NEXT_PUBLIC_AKL_BASE_PATH = "/akb";

    assert.equal(withAppBasePath("/documents/doc_123"), "/akb/documents/doc_123");
    assert.equal(withAppBasePath("/documents/doc_123#versions"), "/akb/documents/doc_123#versions");
  });
});
