#!/usr/bin/env python3
"""Read-only connectivity and fail-closed intake smoke for akb-stratos-test.

Synthetic ClamAV INSTREAM checks do not store or admit a document. No secrets,
tokens, document contents or complete private configuration are printed.
"""
import json
from pathlib import Path
import subprocess
import urllib.error
import urllib.request

from local_acceptance import ROOT, STATE, PROJECT


def inside(service, executable, code):
    command = ["docker", "compose", "--env-file", str(STATE / ".env"), "-p", PROJECT,
               "-f", str(STATE / "compose.json"), "exec", "-T", service, executable,
               "-c" if executable == "python" else "-e", code]
    return json.loads(subprocess.check_output(command, text=True))


results = {}
for name, url in {
    "akb_health": "http://localhost:3220/akb/api/health",
    "akb_ready": "http://localhost:3220/akb/api/ready",
    "chat_health": "http://localhost:3221/api/health",
    "stratos_health": "http://localhost:14001/health/live",
    "stratos_ready": "http://localhost:14001/health/ready",
    "projectflow_ready": "http://localhost:14010/ready",
    "stratos_web": "http://localhost:3240",
    "projectflow_web": "http://localhost:3231",
    "archflow_web": "http://localhost:3232",
}.items():
    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            results[name] = {"http_status": response.status}
    except urllib.error.HTTPError as exc:
        results[name] = {"http_status": exc.code}
    except OSError:
        results[name] = {"error": "unreachable"}

results["stratos_admission"] = inside("stratos-api", "node", r"""
const crypto=require('node:crypto');
const {AKB_DOCUMENT_PROFILE_CATALOG:c}=require('./dist/akb-document-profile');
const {documentSnapshotHash}=require('./dist/akb-document-admission-contract');
(async()=>{
const body={schemaVersion:'stratos-document-admission-readiness-request-1',application:'AKB',requestNonce:crypto.randomUUID(),correlationId:crypto.randomUUID(),catalogRevision:c.catalogRevision,catalogHash:documentSnapshotHash(c),profiles:c.profiles.map(({id,revision})=>({id,revision})),requiredCapabilities:['atomicRegister','freshRevalidate']};
const url='http://127.0.0.1:4000/api/v1/information/resources/akb/document-admission/readiness';
const headers={'content-type':'application/json','x-correlation-id':body.correlationId,authorization:'Bearer '+process.env.AKB_POLICY_SERVICE_TOKEN};
const valid=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});const payload=await valid.json();
const invalid=await fetch(url,{method:'POST',headers,body:JSON.stringify({...body,profiles:[]})});
const anonymous=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
console.log(JSON.stringify({valid_request_status:valid.status,reason_code:payload.code,invalid_request_status:invalid.status,anonymous_status:anonymous.status}));
})().catch(()=>{console.error('Readiness smoke failed');process.exit(1)});
""")
results["akb_admission"] = inside("ingestion-service", "python", r"""
import json,os,urllib.request,urllib.parse,urllib.error
form=urllib.parse.urlencode({'grant_type':'client_credentials','client_id':os.environ['AKL_REGISTRY_SERVICE_CLIENT_ID'],'client_secret':os.environ['AKL_REGISTRY_SERVICE_CLIENT_SECRET']}).encode()
token=json.load(urllib.request.urlopen(urllib.request.Request(os.environ['AKL_REGISTRY_SERVICE_TOKEN_URL'],data=form),timeout=15))['access_token']
req=urllib.request.Request('http://registry-api:8000/api/v1/integrations/ingestion/readiness',headers={'Authorization':'Bearer '+token,'X-Correlation-ID':'local-acceptance-readiness'})
try:
 r=urllib.request.urlopen(req,timeout=15);status=r.status;body=json.load(r)
except urllib.error.HTTPError as e:status=e.code;body=json.load(e)
print(json.dumps({'http_status':status,'reason_code':body.get('code') or body.get('error',{}).get('code'),'body_keys':list(body)}))
""")
results["antivirus"] = inside("registry-api", "python", r"""
import json,socket,struct
def scan(data):
 with socket.create_connection(('clamav',3310),timeout=10) as s:
  s.settimeout(30);s.sendall(b'zINSTREAM\0'+struct.pack('>I',len(data))+data+struct.pack('>I',0));return s.recv(2048).decode().rstrip('\0')
clean=scan(b'AKB isolated acceptance clean text')
signature=b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + b'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
detected=scan(signature)
print(json.dumps({'clean_allowed':clean.endswith('OK'),'standard_test_detected':'FOUND' in detected}))
""")
print(json.dumps(results, ensure_ascii=False, indent=2))
expected = all(v.get("http_status") == 200 for k, v in results.items() if k.endswith(("_health", "_ready", "_web")))
expected = expected and results["stratos_admission"] == {"valid_request_status":503,"reason_code":"DOCUMENT_ADMISSION_CATALOG_NOT_READY","invalid_request_status":400,"anonymous_status":401}
expected = expected and results["akb_admission"]["http_status"] == 503
expected = expected and results["akb_admission"]["reason_code"] == "document_profile_admission_unavailable"
expected = expected and all(results["antivirus"].values())
raise SystemExit(0 if expected else 1)
