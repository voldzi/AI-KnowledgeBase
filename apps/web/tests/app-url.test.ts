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
    assert.equal(withAppBasePath("/akb"), "/akb");
  });

  it("keeps absolute URLs untouched", () => {
    process.env.NEXT_PUBLIC_AKL_BASE_PATH = "/akb";

    assert.equal(withAppBasePath("https://stratos.zeleznalady.cz/akb/api/health"), "https://stratos.zeleznalady.cz/akb/api/health");
  });
});
