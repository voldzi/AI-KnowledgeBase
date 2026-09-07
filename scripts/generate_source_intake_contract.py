#!/usr/bin/env python3
"""Generate the source connector contract from the actual Registry input models."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/registry-api"))
from app.source_intake import SourcePrepare, SourceDocument, SourceFile, VersionDraft, SourceStatusRequest, SourceStatusResponse
from app.document_profile_inputs import DocumentVersionProfileInput


def ref(name): return {"$ref": f"#/components/schemas/SourceIntake{name}"}
def obj(properties, required=None): return {"type":"object", "additionalProperties":False, "properties":properties, "required":list(properties) if required is None else required}
def string(): return {"type":"string", "minLength":1}
def nullable_string(): return {"type":["string","null"]}


def generate():
    schemas={}
    for model in [SourcePrepare, SourceDocument, SourceFile, VersionDraft, SourceStatusRequest, SourceStatusResponse, DocumentVersionProfileInput]:
        schema=model.model_json_schema(ref_template="#/components/schemas/SourceIntake{model}")
        for name,value in schema.pop("$defs",{}).items(): schemas["SourceIntake"+name]=value
        schemas["SourceIntake"+model.__name__]=schema
    schemas["SourceIntakeSourceDocument"]["description"] = (
        "ArchFlow organization_unit intake requires an explicit source-authority handoff. "
        "governance_scope.id, gestor_unit, accountability.gestor(kind organization_unit).id "
        "and the sole organization_unit policy audience scope ID must match exactly. "
        "The source authority revalidates the active canonical unit at every boundary."
    )
    schemas["SourceIntakeError"] = obj({"error": {"type":"object","required":["code","message","trace_id"],"properties":{
        "code":string(),"message":string(),"trace_id":string(),"details":{"type":"object"}},"additionalProperties":True}})
    schemas["SourceIntakeConfirmRequest"]=obj({"upload_token":string(),"upload_receipt":string()})
    schemas["SourceIntakeConfirmResponse"]=obj({
        **{k:string() for k in ("document_id","external_document_id","document_version_id","ingestion_job_id","ingestion_status","document_version_status","canonical_open_url")},
        "idempotent_replay":{"type":"boolean"}})
    schemas["SourceIntakePreflightResponse"]=obj({
        **{k:string() for k in ("document_id","external_document_id","upload_session_id","upload_url","source_file_uri","expires_at","bucket","object_key","policy_binding_id","policy_version","policy_hash")},
        "upload_method":{"const":"PUT","type":"string"}, "document_profile":ref("DocumentVersionProfileInput"),
        "required_headers":obj({"Content-Type":string(),"X-AKL-Content-SHA256":string(),"X-AKL-Upload-Token":string()}),
        "required_authentication":obj({"transport":{"const":"server_to_server"},"service_bearer":{"const":True},"actor_bearer":{"const":True}}),
        "file":obj({"filename":string(),"mime_type":string(),"size_bytes":{"type":"integer","minimum":1},"sha256":string()}),
        "limits":obj({"max_file_bytes":{"type":"integer","minimum":1},"accepted_mime_types":{"type":"array","items":string()}})})
    security={"sourceService":{"type":"http","scheme":"bearer","bearerFormat":"JWT","description":"Exact source client, aud akl-api, service_ingestion. Server-to-server only."},
        "sourceActor":{"type":"apiKey","in":"header","name":"X-STRATOS-Actor-Authorization","description":"Separate current person bearer including Bearer prefix."}}
    def operation(name,input_name,output_name):
        return {"operationId":name,"security":[{"sourceService":[],"sourceActor":[]}],
            "requestBody":{"required":True,"content":{"application/json":{"schema":ref(input_name)}}},
            "responses":{**{str(code):{"description":"Exact replay" if code==200 else "Created", "content":{"application/json":{"schema":ref(output_name)}}} for code in (200,201)},
                **{str(code):{"description":description,"content":{"application/json":{"schema":ref("Error")}}} for code,description in
                   ((400,"Invalid request"),(401,"Missing or invalid credentials"),(403,"Denied actor, source or service"),(409,"Stale or conflicting immutable source"),(410,"Upload token expired"),(413,"File or request too large"),(422,"Invalid mandatory source/profile/TLP"),(429,"Rate limited"),(502,"Conflicting upstream response"),(503,"Required authority, scanner or ingestion unavailable"))}}}
    paths={"/api/stratos/source-upload/preflight":{"post":operation("prepareStratosSourceUpload","SourcePrepare","PreflightResponse")},
        "/api/stratos/source-upload/sessions/{sessionId}/confirm":{"parameters":[{"in":"path","name":"sessionId","required":True,"schema":string()}],"post":operation("confirmStratosSourceUpload","ConfirmRequest","ConfirmResponse")}}
    status_op=operation("getStratosSourceDocumentStatus","SourceStatusRequest","SourceStatusResponse")
    status_op["responses"].pop("201")
    status_op["responses"]["404"]={"description":"Source document not found"}
    paths["/api/stratos/source-upload/documents/{documentId}/status"]={"parameters":[{"in":"path","name":"documentId","required":True,"schema":string()}],"post":status_op}
    public={"openapi":"3.1.0","info":{"title":"AKB ProjectFlow and ArchFlow document intake","version":"1.0.0"},
        "servers":[{"url":"http://localhost:3220/akb","description":"Joint local Docker acceptance; production is not enabled"}],
        "paths":paths,"components":{"securitySchemes":security,"schemas":schemas}}
    authority_schemas=dict(schemas)
    fields={"schema_version":{"const":"stratos-source-intake-authorization-1"},"nonce":{"type":"string","pattern":"^[a-f0-9]{32}$"},
        "stage":{"enum":["prepare","upload","confirm"]},"document":ref("SourceDocument"),"file":ref("SourceFile"),
        "source_revision":string(),"version_profile":{"anyOf":[ref("VersionDraft"),ref("DocumentVersionProfileInput")]},
        **{key:string() for key in ("actor_subject_id","source_client_id","source_service_subject_id","correlation_id","request_hash")}}
    authority_schemas["SourceIntakeAuthorityRequest"]=obj(fields)
    authority_schemas["SourceIntakeAuthorityResponse"]=obj({"schema_version":fields["schema_version"],"allowed":{"const":True},
        "nonce":fields["nonce"],"request_hash":string(),"expires_at":{"type":"string","format":"date-time"}})
    auth_op=operation("authorizeSourceDocumentIntake","AuthorityRequest","AuthorityResponse")
    auth_op["responses"].pop("201")
    auth_op["description"]="STRATOS implementation required. Recompute request_hash over all request members except request_hash using recursively key-sorted compact UTF-8 JSON. Verify actual source record, revision, parent, attachment bytes/hash, actor token and effective policy/metadata. No echo-only authorization. Return nonce-bound decision with expiry >now and <=60 seconds."
    authority={"openapi":"3.1.0","info":{"title":"STRATOS source authority required by AKB","version":"1.0.0"},
        "x-implementation-status":"REQUIRED_ON_STRATOS_NOT_YET_JOINTLY_VERIFIED", "paths":{"/api/v1/information-governance/source-document-intake/authorize":{"post":auth_op}},
        "components":{"securitySchemes":{**security,"sourceService":{"type":"http","scheme":"bearer","description":"Existing fixed service:akb governance credential; source service is NOT the authority transport."}},"schemas":authority_schemas}}
    return {"openapi.json":public,"stratos-authority.openapi.json":authority}


if __name__ == "__main__":
    check=argparse.ArgumentParser();check.add_argument("--check",action="store_true");args=check.parse_args()
    folder=ROOT/"contracts/stratos/source-document-intake";folder.mkdir(parents=True,exist_ok=True)
    for name,value in generate().items():
        path=folder/name;content=json.dumps(value,ensure_ascii=False,indent=2)+"\n"
        if args.check:
            if not path.exists() or path.read_text()!=content: raise SystemExit(f"Stale source contract: {path}")
        else: path.write_text(content)
    print("Source intake contracts verified" if args.check else "Source intake contracts generated")
