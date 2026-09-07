import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

// Proposed wire-format fixtures only: these tests do not implement or certify
// the provider verifier, authenticated persistence or current reader authority.
const directory = new URL("../../../docs/CONTRACTS/federated-history-v1/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(name, directory), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(fixture("schema.json"));

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

test("proposed federated-history fixtures validate and bind each decision to the exact request", () => {
  const request = fixture("request.json");
  assert.equal(validate(request), true, JSON.stringify(validate.errors));
  const digest = `sha256:${createHash("sha256").update(canonical(request)).digest("hex")}`;
  for (const decision of ["allow", "deny", "stale", "unavailable"]) {
    const response = fixture(`${decision}.json`);
    assert.equal(validate(response), true, JSON.stringify(validate.errors));
    assert.equal(response.decision, decision.toUpperCase());
    assert.equal(response.request_digest, digest);
    for (const key of ["schema_version", "provider", "tenant_id", "actor_subject_id", "read_id", "nonce", "evidence_manifest_hash"]) {
      assert.equal(response[key], request[key]);
    }
    assert.deepEqual(response.authorized_references, decision === "allow" ? request.references : []);
    const lifetime = Date.parse(response.expires_at) - Date.parse(response.issued_at);
    assert.ok(lifetime > 0 && lifetime <= 30_000);
  }
});

test("proposed request schema rejects missing evidence, incomplete policy and unknown fields", () => {
  for (const mutate of [
    (request: ReturnType<typeof fixture>) => { request.references = []; },
    (request: ReturnType<typeof fixture>) => { delete request.references[0].policy_hash; },
    (request: ReturnType<typeof fixture>) => { request.references[0].policy_hash = "b".repeat(64); },
    (request: ReturnType<typeof fixture>) => { request.references.push(request.references[0]); },
    (request: ReturnType<typeof fixture>) => { request.forwarded_identity = "untrusted"; },
  ]) {
    const request = fixture("request.json");
    mutate(request);
    assert.equal(validate(request), false);
  }
});

test("proposed decision schema rejects an empty allow and a denied reference subset", () => {
  const allow = fixture("allow.json");
  allow.authorized_references = [];
  assert.equal(validate(allow), false);
  for (const name of ["deny", "stale", "unavailable"]) {
    const response = fixture(`${name}.json`);
    response.authorized_references = fixture("request.json").references;
    assert.equal(validate(response), false);
  }
});
