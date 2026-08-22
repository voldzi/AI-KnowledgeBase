import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasAllowedSessionRequestOrigin,
  requiresSessionOriginCheck,
} from "../src/lib/auth/csrf";

const publicBaseUrl = "https://stratos.example/akb";

describe("session request origin protection", () => {
  it("requires an exact configured origin for cookie-authenticated writes", () => {
    const request = {
      method: "POST",
      pathname: "/api/documents",
      origin: "https://stratos.example",
      referer: "https://stratos.example/akb/documents",
      secFetchSite: "same-origin",
      secFetchMode: "cors",
      secFetchDest: "empty",
      hasServerSession: true,
    };

    assert.equal(requiresSessionOriginCheck(request), true);
    assert.equal(hasAllowedSessionRequestOrigin(request, publicBaseUrl), true);
    assert.equal(
      hasAllowedSessionRequestOrigin(
        { ...request, origin: "https://attacker.example" },
        publicBaseUrl,
      ),
      false,
    );
    assert.equal(
      hasAllowedSessionRequestOrigin(
        { ...request, origin: null, referer: null, secFetchSite: null },
        publicBaseUrl,
      ),
      false,
    );
  });

  it("accepts an opaque Origin only for a verified same-origin login navigation", () => {
    const request = {
      method: "POST",
      pathname: "/akb/api/auth/login",
      origin: "null",
      referer: null,
      secFetchSite: "same-origin",
      secFetchMode: "navigate",
      secFetchDest: "document",
      hasServerSession: true,
    };

    assert.equal(hasAllowedSessionRequestOrigin(request, publicBaseUrl), true);
    assert.equal(
      hasAllowedSessionRequestOrigin(
        { ...request, pathname: "/akb/api/documents" },
        publicBaseUrl,
      ),
      false,
    );
    assert.equal(
      hasAllowedSessionRequestOrigin(
        { ...request, secFetchSite: "cross-site" },
        publicBaseUrl,
      ),
      false,
    );
    assert.equal(
      hasAllowedSessionRequestOrigin(
        { ...request, secFetchMode: "cors", secFetchDest: "empty" },
        publicBaseUrl,
      ),
      false,
    );
  });

  it("accepts an exact same-origin browser navigation when Origin is omitted", () => {
    const request = {
      method: "POST",
      pathname: "/akb/api/auth/login",
      origin: null,
      referer: "https://stratos.example/akb/api/auth/login?return_to=%2Fdashboard",
      secFetchSite: "same-origin",
      secFetchMode: "navigate",
      secFetchDest: "document",
      hasServerSession: true,
    };

    assert.equal(hasAllowedSessionRequestOrigin(request, publicBaseUrl), true);
    assert.equal(
      hasAllowedSessionRequestOrigin(
        { ...request, referer: "https://attacker.example/login" },
        publicBaseUrl,
      ),
      false,
    );
    assert.equal(
      hasAllowedSessionRequestOrigin({ ...request, secFetchSite: null }, publicBaseUrl),
      false,
    );
  });

  it("covers base-path API routes", () => {
    const request = {
      method: "DELETE",
      pathname: "/akb/api/auth/sessions/device-1",
      origin: "https://stratos.example",
      referer: null,
      secFetchSite: null,
      secFetchMode: null,
      secFetchDest: null,
      hasServerSession: true,
    };

    assert.equal(requiresSessionOriginCheck(request), true);
    assert.equal(hasAllowedSessionRequestOrigin(request, publicBaseUrl), true);
  });

  it("does not interfere with reads or bearer-only integrations", () => {
    assert.equal(
      requiresSessionOriginCheck({
        method: "GET",
        pathname: "/api/documents",
        origin: null,
        referer: null,
        secFetchSite: null,
        secFetchMode: null,
        secFetchDest: null,
        hasServerSession: true,
      }),
      false,
    );
    assert.equal(
      hasAllowedSessionRequestOrigin(
        {
          method: "POST",
          pathname: "/api/v1/integrations/controlled-rules-read/rules",
          origin: null,
          referer: null,
          secFetchSite: null,
          secFetchMode: null,
          secFetchDest: null,
          hasServerSession: false,
        },
        publicBaseUrl,
      ),
      true,
    );
  });
});
