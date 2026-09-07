import "./helpers/next-server-navigation";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it } from "node:test";
import { NextRequest } from "next/server";

import { POST } from "../src/app/api/controlled-document/ingestion/route";
import { POST as preflightPOST } from "../src/app/api/controlled-document/upload/preflight/route";
import { canonicalDocumentSnapshot } from "../src/lib/documents/document-profile";
import { ingestionJobIdForIdempotencyKey } from "../src/lib/ingestion/service-identity";
import { parseInformationPolicy, policyHash } from "../src/lib/stratos/information-policy";
import { CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE, createUploadPreflightDecision, createUploadReceipt,
  getUploadSettings, persistUploadedObject, verifyUploadToken } from "../src/lib/upload/preflight";
import { contractVersionProfile, nativeContractSnapshot } from "./fixtures/document-profiles";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const documentId = "doc_native_recovery";
const actor = "user_dev";
const versionId = "ver_native_original";
const content = Buffer.from("%PDF-1.7\nNative recovery fixture\n%%EOF\n");
const fileHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
const idempotencyKey = `controlled:${versionId}`;
const jobId = ingestionJobIdForIdempotencyKey(idempotencyKey);
const policy = parseInformationPolicy({ schemaVersion:"stratos-information-policy-2",
  policyBindingId:"pb_native_recovery_test", policyVersion:"information-policy-2.0.0", handlingClass:"INTERNAL",
  legalClassification:"NONE", tlp:"TLP:CLEAR", pap:null, contentCategories:[], obligations:["AUDIT_ACCESS"],
  audience:{ organizationId:"org_stratos", scopeType:"organization", scopeIds:[], recipientSubjectIds:[] },
  originatorId:actor, issuedAt:"2026-09-05T00:00:00Z", reviewAt:null });
let storageRoot: string;
let session: Awaited<ReturnType<typeof upload>>;
let document: Record<string, unknown>;
let storedVersion: Record<string, unknown> | undefined;
let versionRequests: Record<string, unknown>[];
let jobRequests: Record<string, unknown>[];
let lostVersionReply: boolean;
let lostJobReply: boolean;
let allowed: boolean;
let pendingCount: number;
let currentAttemptReads: number;

async function upload(predecessor: string | null = null, includePredecessor = true) {
  const settings = getUploadSettings();
  const decision = createUploadPreflightDecision({ document_id:documentId, document_profile:contractVersionProfile(),
    file_name:"contract.pdf", file_size:content.length, file_type:"application/pdf", sha256:fileHash,
    policy_binding_id:policy.policyBindingId, policy_version:policy.policyVersion, policy_hash:policyHash(policy),
    governance_actor_subject_id:actor, purpose:CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE,
    ...(includePredecessor ? {expected_current_ingestion_job_id:predecessor} : {}),
  },settings);
  const token = decision.required_headers["X-AKL-Upload-Token"];
  const payload = verifyUploadToken(token,settings);
  const file = await persistUploadedObject(payload,content,settings);
  const receipt = createUploadReceipt(token,payload,file,settings,{status:"clean",engine:"clamav",engine_version:"1.4.3",
    signature_version:"27632",scanned_at:new Date().toISOString(),duration_ms:1});
  return {token,payload,receipt};
}

function body() {
  return {document_id:documentId, document_profile:session.payload.document_profile, version_label:"1.0",
    source_file_uri:session.payload.source_file_uri, upload_token:session.token, upload_receipt:session.receipt,
    upload_session_id:session.payload.session_id, file_hash:fileHash, file_name:"contract.pdf", file_type:"application/pdf", file_size:content.length};
}
async function confirm(value: Record<string, unknown> = body()) {
  const response = await POST(new NextRequest("http://localhost/akb/api/controlled-document/ingestion",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)}));
  return {status:response.status,body:await response.json()};
}

beforeEach(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(),"akb-native-recovery-"));
  Object.assign(process.env,{AKL_ENV:"test",AKL_AUTH_MODE:"mock",AKL_API_CLIENT_MODE:"production",AKL_WEB_DEV_SUBJECT:actor,
    AKL_REGISTRY_API_BASE_URL:"http://registry.test/api/v1",AKL_INGESTION_API_BASE_URL:"http://ingestion.test/api/v1",
    AKL_RAG_API_BASE_URL:"http://rag.test/api/v1",AKL_GOVERNANCE_API_BASE_URL:"http://governance.test/api/v1",AKL_EVALUATION_API_BASE_URL:"http://evaluation.test/api/v1",
    AKL_OBJECT_STORAGE_MODE:"local",AKL_WEB_OBJECT_STORAGE_ROOT:storageRoot,AKL_S3_BUCKET:"akl-documents",
    AKL_WEB_UPLOAD_SIGNING_SECRET:"test-only-native-upload-secret",STRATOS_CONTENT_SECURITY_REQUIRED:"true",STRATOS_CONTENT_SECURITY_MODE:"clamd"});
  const snapshot = nativeContractSnapshot(documentId);
  document = {document_id:documentId,document_profile:snapshot,current_root_metadata_revision:snapshot.metadataRevision,
    current_root_snapshot_hash:`sha256:${createHash("sha256").update(canonicalDocumentSnapshot(snapshot)).digest("hex")}`,
    policy_summary:policy,policy_binding_id:policy.policyBindingId,policy_version:policy.policyVersion,policy_hash:policyHash(policy)};
  session = await upload(); storedVersion=undefined; versionRequests=[]; jobRequests=[];
  lostVersionReply=false;lostJobReply=false;allowed=true;pendingCount=0;currentAttemptReads=0;
  globalThis.fetch = async (input,init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const value = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.endsWith("/authz/check")) {
      assert.equal(value.action,"document.version.create");
      return Response.json({allowed,reason_codes:[],constraints:{}});
    }
    if (url.endsWith(`/documents/${documentId}`)) return Response.json(document);
    if (url.endsWith("/external-references/current")) {
      currentAttemptReads += 1;
      return Response.json({document_id:documentId,ingestion_attempt:null});
    }
    if (url.endsWith(`/documents/${documentId}/versions`)) {
      versionRequests.push(value);
      const replay = !!storedVersion;
      storedVersion ??= {document_id:documentId,document_version_id:versionId,source_file_uri:value.source_file_uri,
        file_hash:value.file_hash,version_label:value.version_label,status:"draft",root_metadata_revision:value.document_profile.expected_root_metadata_revision};
      if (lostVersionReply) { lostVersionReply=false; throw new Error("Lost version reply after durable persistence"); }
      return Response.json({...storedVersion,idempotent_replay:replay},{status:replay?200:201});
    }
    if (url.endsWith("/ingestion-authorization")) return Response.json({document_id:documentId,document_version_id:versionId,
      confirmed_subject_id:actor,correlation_id:value.correlation_id,idempotency_key:value.idempotency_key,authorization_token:"test-only-native-registry-authorization-proof"});
    if (url.endsWith("/ingestion/jobs")) {
      jobRequests.push(value);
      assert.equal(value.idempotency_key,idempotencyKey);
      assert.equal(new Headers(init?.headers).get("X-AKL-On-Behalf-Of"),actor);
      if (lostJobReply) {lostJobReply=false;throw new Error("Lost durable job reply");}
      return Response.json({job_id:jobId,document_id:documentId,document_version_id:versionId,status:pendingCount-- > 0 ? "pending_authorization" : "queued"});
    }
    throw new Error(`Unexpected request: ${url}`);
  };
});
afterEach(async () => {
  globalThis.fetch=originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env,originalEnv);
  await rm(storageRoot,{recursive:true,force:true});
});

it("recovers a lost Registry reply with identical immutable version input",async () => {
  lostVersionReply=true;
  assert.equal((await confirm()).status,503);
  const replay=await confirm();
  assert.equal(replay.status,200,JSON.stringify(replay.body));
  assert.equal(replay.body.version.document_version_id,versionId);
  assert.deepEqual(versionRequests[0],versionRequests[1]);
  assert.equal(jobRequests.length,1);
  assert.equal(currentAttemptReads,0);
});
it("recovers a lost ingestion reply with stable job payload and signed predecessor",async () => {
  session=await upload("ing_previous_attempt");
  lostJobReply=true;
  assert.equal((await confirm()).status,503);
  const replay=await confirm();
  assert.equal(replay.status,200,JSON.stringify(replay.body));
  assert.deepEqual(jobRequests[0],jobRequests[1]);
  assert.equal(jobRequests[1].expected_current_ingestion_job_id,"ing_previous_attempt");
  assert.equal(currentAttemptReads,0);
});
it("two concurrent confirms retain one version and the same job identity",async () => {
  const results=await Promise.all([confirm(),confirm()]);
  assert.deepEqual(results.map(item=>item.status).sort(),[200,201],JSON.stringify(results));
  assert.deepEqual(jobRequests[0],jobRequests[1]);
});
it("denies revoked access before stored bytes can be read",async () => {
  await rm(storageRoot,{recursive:true,force:true});allowed=false;
  const result=await confirm();
  assert.equal(result.status,403);assert.equal(result.body.error.code,"UPLOAD_NOT_AUTHORIZED");
  assert.equal(versionRequests.length,0);
});
it("denies changed current root before reading unavailable bytes",async () => {
  await rm(storageRoot,{recursive:true,force:true});document.current_root_metadata_revision="changed";
  const result=await confirm();
  assert.equal(result.status,409);assert.equal(result.body.error.code,"UPLOAD_DOCUMENT_PROFILE_STALE");
  assert.equal(versionRequests.length,0);
});
it("denies a different actor before any source read or Registry version write",async () => {
  process.env.AKL_WEB_DEV_SUBJECT="other-actor";await rm(storageRoot,{recursive:true,force:true});
  const result=await confirm();assert.equal(result.status,403);assert.equal(result.body.error.code,"UPLOAD_ACTOR_MISMATCH");
  assert.equal(versionRequests.length,0);
});
it("denies profile replacement even when the upload proof itself is valid",async () => {
  const changed=structuredClone(body());changed.document_profile!.domain_evidence.contractReference="another-contract";
  const result=await confirm(changed);assert.equal(result.status,409);assert.equal(versionRequests.length,0);
});
it("reconciles a pending durable job once and reports unresolved activation",async () => {
  pendingCount=2;
  const result=await confirm();assert.equal(result.status,503);assert.equal(jobRequests.length,2);
  const replay=await confirm();assert.equal(replay.status,200,JSON.stringify(replay.body));
  assert.deepEqual(jobRequests[0],jobRequests[2]);
});
it("actual preflight signs the authoritative predecessor after current authorization",async () => {
  const response=await preflightPOST(new NextRequest("http://localhost/akb/api/controlled-document/upload/preflight",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({document_id:documentId,
      document_profile:contractVersionProfile(),file_name:"contract.pdf",file_size:content.length,file_type:"application/pdf",sha256:fileHash})}));
  const result=await response.json();assert.equal(response.status,201,JSON.stringify(result));
  const payload=verifyUploadToken(result.preflight.required_headers["X-AKL-Upload-Token"],getUploadSettings());
  assert.ok(Object.hasOwn(payload,"expected_current_ingestion_job_id"));
  assert.equal(payload.expected_current_ingestion_job_id,null);assert.equal(currentAttemptReads,1);
});

it("rejects an old session without a signed predecessor instead of guessing current state",async () => {
  session=await upload(null,false);
  const result=await confirm();assert.equal(result.status,409);assert.equal(result.body.error.code,"UPLOAD_PREDECESSOR_REQUIRED");
  assert.equal(currentAttemptReads,0);assert.equal(versionRequests.length,0);
});
