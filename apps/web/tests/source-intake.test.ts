import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sourceAuthorizationBody, sourceSystemForService, SOURCE_UPLOAD_PURPOSE } from "../src/lib/stratos/source-intake";
import { createUploadPreflightDecision, verifyUploadToken, type UploadSettings } from "../src/lib/upload/preflight";
import type { StratosDocumentServicePrincipal } from "../src/lib/stratos/document-service-auth";
import { contractVersionProfile } from "./fixtures/document-profiles";
import { acceptAuthorizedDocumentIntakeContent } from "../src/lib/upload/document-intake-authorization";

const service: StratosDocumentServicePrincipal={subjectId:"service-projectflow",clientId:"stratos-projectflow-akb-service",roles:["service_ingestion"],accessToken:"test-service",allowedSourceSystems:["STRATOS_PROJECTFLOW"]};
const settings: UploadSettings={objectStorageRoot:"/tmp/akb-source-unit-unused",bucket:"test",signingSecret:"explicit-source-test-signing-key",maxFileBytes:1024,publicUploadBasePath:"/api/document-intake/v1/sessions",expiresInSeconds:900};
function signed() {
  const preflight=createUploadPreflightDecision({document_id:"doc_source",file_name:"source.pdf",file_size:23,file_type:"application/pdf",sha256:`sha256:${"a".repeat(64)}`,
    document_profile:contractVersionProfile(), external_document_id:"ext_source",policy_hash:`sha256:${"b".repeat(64)}`,
    governed_document_resource_id:"gres_document",source_governed_resource_id:"gres_source",source_resource_id:"project-1",source_version:`sha256:${"a".repeat(64)}`,governance_scope:{type:"project",id:"project-1"},governance_idempotency_key:"source-revision-1",
    governance_actor_subject_id:"actor-source",governance_registered_by_subject_id:service.subjectId,governance_correlation_id:"corr-source",
    purpose:SOURCE_UPLOAD_PURPOSE,workflow_mode:"interactive",workflow_context:{source_system:"STRATOS_PROJECTFLOW",source_revision:"revision-1",version_label:"1"}},settings);
  return {preflight,payload:verifyUploadToken(preflight.required_headers["X-AKL-Upload-Token"],settings)};
}

describe("source intake service and immutable claims",()=>{
  it("binds source revision, actor, service, file and profile in the signed token",()=>{
    const {payload}=signed(); const body=sourceAuthorizationBody(payload,service);
    assert.equal(body.source_revision,"revision-1");assert.equal(body.actor_subject_id,"actor-source");
    assert.equal(body.file.sha256,payload.sha256); assert.deepEqual(body.document_profile,payload.document_profile);
  });
  for (const source of ["STRATOS_BUDGET","STRATOS_ARCHFLOW","UNKNOWN"]) it(`rejects ${source} for ProjectFlow service`,()=>{
    assert.throws(()=>sourceSystemForService(service,source));
  });
  for (const mutation of ["service","source","mode","profile"]) it(`rejects changed ${mutation} before authority`,()=>{
    const {payload}=signed();
    if(mutation==="service") payload.governance_registered_by_subject_id="other-service";
    if(mutation==="source") payload.workflow_context!.source_system="STRATOS_ARCHFLOW";
    if(mutation==="mode") payload.workflow_mode="historical_batch";
    if(mutation==="profile") payload.document_profile=null;
    assert.throws(()=>sourceAuthorizationBody(payload,service));
  });
  it("rejects an unauthorized source before reading any bytes or calling the scanner",async()=>{
    const {payload,preflight}=signed(); let accepted=false;
    payload.workflow_context!.source_system="STRATOS_ARCHFLOW";
    await assert.rejects(acceptAuthorizedDocumentIntakeContent({request:new Request("http://local.invalid/content",{method:"PUT",body:"not-read"}),
      sessionId:payload.session_id,uploadToken:preflight.required_headers["X-AKL-Upload-Token"],payload,settings},
      {registry:{} as never,getUserContext:async()=>{throw Error("must not use browser auth");},getBudgetService:async()=>service,
        acceptContent:async()=>{accepted=true;throw Error("must not scan");}}));
    assert.equal(accepted,false);
  });
});

import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
it("all published source examples validate against the exact generated JSON schema",()=>{
  const contract=JSON.parse(readFileSync(new URL("../../../contracts/stratos/source-document-intake/openapi.json",import.meta.url),"utf8"));
  const ajv=new Ajv2020({strict:false,allErrors:true});addFormats(ajv);
  const validate=ajv.compile({$ref:"#/components/schemas/SourceIntakeSourcePrepare",components:contract.components});
  for(const entity of ["project","task","status_report","need"]) {
    const example=JSON.parse(readFileSync(new URL(`../../../contracts/stratos/source-document-intake/examples/${entity}.json`,import.meta.url),"utf8"));
    assert.equal(validate(example),true,JSON.stringify(validate.errors));
    example.document.information_policy.tlp=null;
    assert.equal(validate(example),false,"The published contract must reject missing TLP");
  }
});

for (const source of ["STRATOS_BUDGET", "STRATOS_PROJECTFLOW", "STRATOS_ARCHFLOW"]) {
  it(`native intake rejects ${source} documents before reading bytes`, async () => {
    const { payload, preflight } = signed();
    payload.purpose = "controlled-document-upload";
    let accepted = false;
    await assert.rejects(acceptAuthorizedDocumentIntakeContent({
      request: new Request("http://local.invalid/content", { method: "PUT", body: "not-read" }),
      sessionId: payload.session_id, uploadToken: preflight.required_headers["X-AKL-Upload-Token"], payload, settings,
    }, {
      registry: {
        authorizeDocument: async () => ({ allowed: true }) as never,
        getDocument: async () => ({ document_profile: { provenance: { sourceSystem: source } } }) as never,
      } as never,
      getUserContext: async () => ({ subjectId: "actor-source" }),
      getBudgetService: async () => { throw Error("Native route must not infer source authority"); },
      acceptContent: async () => { accepted = true; throw Error("Must not scan"); },
    }), (error: unknown) => error instanceof Error && "code" in error && error.code === "SOURCE_INTAKE_REQUIRED");
    assert.equal(accepted, false);
  });
}
