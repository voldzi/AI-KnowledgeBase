import "./helpers/next-server-navigation";
import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/controlled-document/documents/route";
import { PUT as assign } from "../src/app/api/documents/[documentId]/assignments/route";
import { createApiClients } from "../src/lib/api";
import { createMockContext } from "../src/lib/api/correlation";
import { budgetContractProfile } from "./fixtures/document-profiles";
import type { CreateDocumentRequest } from "../src/lib/types";
import { profileWithAssignments } from "../src/lib/documents/document-profile";

const environment = { ...process.env };
const originalFetch = globalThis.fetch;
beforeEach(() => Object.assign(process.env, { AKL_ENV:"test", AKL_AUTH_MODE:"mock", AKL_API_CLIENT_MODE:"production",
  AKL_REGISTRY_API_BASE_URL:"http://registry.test/api/v1", AKL_INGESTION_API_BASE_URL:"http://ingestion.test/api/v1",
  AKL_RAG_API_BASE_URL:"http://rag.test/api/v1", AKL_GOVERNANCE_API_BASE_URL:"http://governance.test/api/v1",
  AKL_EVALUATION_API_BASE_URL:"http://evaluation.test/api/v1" }));
afterEach(() => {
  globalThis.fetch=originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
  Object.assign(process.env,environment);
});

for (const kind of ["person","organization_unit"] as const) {
  it(`actual native create handler preserves ${kind} gestor identity, distinct from its display label`, async () => {
    const profile=budgetContractProfile();
    profile.provenance={sourceSystem:"AKB",sourceRecordId:null,sourceGovernedResourceId:null};
    profile.accountability.gestor={kind,id:"gestor-subject"};
    let captured:CreateDocumentRequest|undefined;
    globalThis.fetch=async (input, init) => {
      assert.equal(String(input),"http://registry.test/api/v1/documents");
      captured=JSON.parse(String(init?.body));
      return Response.json({document_id:"created-native-document",...captured},{status:201});
    };
    const response=await POST(new NextRequest("http://localhost/akb/api/controlled-document/documents",{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:"Native profile",document_type:"contract",
        classification:"internal",tlp:"TLP:CLEAR",document_profile:profile,
        assignments:[{role:"gestor",subject_type:kind === "person" ? "user" : "unit",subject_id:"gestor-subject",display_label:"Human-friendly label"}]})}));
    assert.equal(response.status,201,JSON.stringify(await response.json()));
    assert.ok(captured);
    assert.equal(captured.gestor_unit,kind === "organization_unit" ? "gestor-subject" : null);
    assert.equal(captured.owner_id,"subject-document-owner");
    assert.deepEqual(captured.document_profile.authorship,profile.authorship);
    const mock=createApiClients({env:{AKL_ENV:"test",AKL_API_CLIENT_MODE:"mock",AKL_AUTH_MODE:"mock"}}).registry;
    await assert.rejects(mock.createDocument({...captured,gestor_unit:"Human-friendly label"},createMockContext()),{code:"DOCUMENT_PROFILE_ASSIGNMENT_MISMATCH"});
    const accepted=await mock.createDocument(captured,createMockContext());
    assert.equal(accepted.gestor_unit,captured.gestor_unit);
  });
}

for (const endpoint of ["create", "assignments"] as const) {
  for (const invalid of ["missing", "invalid", "json"] as const) {
    it(`${endpoint} reports ${invalid} input as a client error before Registry writes`, async () => {
      let requests=0;
      globalThis.fetch=async () => { requests += 1; throw new Error("Invalid input must not reach Registry"); };
      const request=new NextRequest("http://localhost/akb/api/documents",{method: endpoint === "create" ? "POST" : "PUT",
        headers:{"Content-Type":"application/json"},body:invalid === "json" ? "{" : JSON.stringify({
          title:"Invalid profile",document_type:"contract",...(invalid === "invalid" ? {document_profile:{profile:{id:"unknown"}}} : {}),
        })});
      const response=endpoint === "create" ? await POST(request) : await assign(request,{params:Promise.resolve({documentId:"doc_test"})});
      const value=await response.json();
      assert.equal(response.status,invalid === "json" ? 400 : 422,JSON.stringify(value));
      assert.equal(value.error.code,invalid === "json" ? "INVALID_JSON" : invalid === "missing" ? "DOCUMENT_PROFILE_REQUIRED" : "DOCUMENT_PROFILE_INVALID");
      assert.equal(requests,0);
    });
  }
}

it("mock responsibility updates preserve primary owner and exact unit ID when secondary participants come first",async () => {
  const registry=createApiClients({env:{AKL_ENV:"test",AKL_API_CLIENT_MODE:"mock",AKL_AUTH_MODE:"mock"}}).registry;
  const context=createMockContext();
  const document=await registry.getDocument("doc_101",context);
  const assignments=[
    {role:"owner" as const,subject_type:"user" as const,subject_id:"secondary-owner",is_primary:false},
    {role:"gestor" as const,subject_type:"user" as const,subject_id:"secondary-gestor",is_primary:false},
    {role:"owner" as const,subject_type:"user" as const,subject_id:"primary-owner",is_primary:true},
    {role:"gestor" as const,subject_type:"unit" as const,subject_id:"unit-primary",display_label:"Unit display label",is_primary:true},
  ];
  const profile=profileWithAssignments(document.document_profile!,assignments);
  await registry.replaceDocumentAssignments(document.document_id,{assignments,document_profile:profile,
    expected_root_metadata_revision:document.current_root_metadata_revision!},context);
  const updated=await registry.getDocument(document.document_id,context);
  assert.equal(updated.owner_id,"primary-owner");assert.equal(updated.gestor_unit,"unit-primary");
  assert.equal(updated.document_profile!.accountability.ownerSubjectId,updated.owner_id);
});
