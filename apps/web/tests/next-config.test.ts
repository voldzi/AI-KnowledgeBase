import assert from "node:assert/strict";
import { describe, it } from "node:test";

import nextConfig from "../next.config";

describe("Next.js proxy upload limits", () => {
  it("accepts the bounded 64 MiB contract-document upload envelope", () => {
    assert.equal(nextConfig.experimental?.proxyClientMaxBodySize, "64mb");
  });
});
