import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import "./helpers/next-server-navigation";
import { POST } from "../src/app/api/assistant/reports/export/route";

const policyHash = `sha256:${"a".repeat(64)}`;
const report = {
  artifact_id: "rpt_security", title: "Source policy report",
  columns: [{ key: "obligation", label: "Obligation", type: "text" }, { key: "owner", label: "Owner", type: "text" }],
  rows: [{ row_id: "row_1", cells: { obligation: "Notify", owner: "Source owner" }, citations: [{
    document_id: "doc_source", document_version_id: "ver_source", chunk_id: "chunk_source",
    document_title: "Source document", version_label: "1.0", page_number: 7, section_path: ["Article 2"],
    policy_binding_id: "pol_source", policy_version: "information-policy-2.0.0", policy_hash: policyHash,
  }] }],
};

for (const format of ["pdf", "xlsx"] as const) {
  for (const scenario of ["allowed", "revoked", "stale", "no_export", "watermark", "unavailable", "missing_policy_second", "uncited_row", "wrong_version", "root_only", "invalid_citation"] as const) {
    test(`${format} export ${scenario} uses current PDP and retained source policy coordinates`, async (t) => {
      const previous = { ...process.env };
      const previousFetch = globalThis.fetch;
      Object.assign(process.env, {
        AKL_ENV: "development", AKL_AUTH_MODE: "mock", AKL_API_CLIENT_MODE: "production", AKL_DEV_ACCESS_TOKEN: "",
        ...Object.fromEntries(["REGISTRY", "INGESTION", "RAG", "GOVERNANCE", "EVALUATION"].map(
          (service) => [`AKL_${service}_API_BASE_URL`, `https://${service.toLowerCase()}.example/api/v1`],
        )),
      });
      t.after(() => {
        for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
        Object.assign(process.env, previous); globalThis.fetch = previousFetch;
      });
      let authorizationCalls = 0;
      const submitted = structuredClone(report);
      if (scenario === "missing_policy_second") submitted.rows[0].citations.push({ ...submitted.rows[0].citations[0], policy_hash: "" });
      if (scenario === "uncited_row") {
        submitted.artifact_id = "rpt_registry_forged";
        submitted.rows.push({ row_id: "uncited", cells: { obligation: "Secret uncited source", owner: "Secret owner" }, citations: [] });
      }
      if (scenario === "wrong_version") submitted.rows[0].citations[0].document_version_id = "ver_hidden";
      if (scenario === "invalid_citation") submitted.rows[0].citations.push({ ...submitted.rows[0].citations[0], chunk_id: "" });
      globalThis.fetch = async (input, init) => {
        assert.equal(String(input), "https://registry.example/api/v1/authz/check");
        assert.equal(init?.cache, "no-store");
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.action, "rag.export");
        assert.deepEqual(payload.resource, { document_id: "doc_source", document_version_id: scenario === "wrong_version" ? "ver_hidden" : "ver_source" });
        authorizationCalls++;
        if (scenario === "unavailable") return Response.json({ error: { code: "unavailable", message: "Unavailable" } }, { status: 503 });
        return Response.json({ allowed: scenario !== "revoked" && scenario !== "wrong_version", reason_codes: scenario === "revoked" ? ["ACCESS_REVOKED"] : [], constraints: {
          document_id: "doc_source", document_version_id: scenario === "root_only" ? undefined : "ver_source",
          policy_binding_id: "pol_source", policy_version: "information-policy-2.0.0",
          policy_hash: scenario === "stale" ? `sha256:${"b".repeat(64)}` : policyHash,
          obligations: scenario === "no_export" ? ["NO_EXPORT"] : scenario === "watermark" ? ["WATERMARK"] : [],
        } });
      };
      const response = await POST(new NextRequest("https://akb.example/api/assistant/reports/export", { method: "POST", body: JSON.stringify({ report: submitted, format }) }));
      if (["missing_policy_second", "uncited_row", "invalid_citation"].includes(scenario)) assert.equal(authorizationCalls, 0);
      else assert.ok(authorizationCalls >= 1, await response.clone().text());
      if (scenario !== "allowed") {
        assert.ok(response.status >= 400, await response.clone().text());
        assert.match(response.headers.get("content-type") ?? "", /json/);
        assert.equal((await response.text()).includes("Notify"), false);
        return;
      }
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get("x-stratos-policy-bindings"), "pol_source");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const content = Buffer.from(await response.arrayBuffer()).toString("latin1");
      assert.ok(content.startsWith(format === "pdf" ? "%PDF-" : "PK"));
      for (const coordinate of ["doc_source", "ver_source", "chunk_source", "pol_source", "information-policy-2.0.0"]) assert.ok(content.includes(coordinate), coordinate);
      // PDF can wrap the long hash across text operators; XLSX retains it whole.
      assert.ok(content.includes(format === "pdf" ? "sha256:" : policyHash));
    });
  }
}
