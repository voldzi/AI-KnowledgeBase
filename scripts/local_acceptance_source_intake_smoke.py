#!/usr/bin/env python3
"""Read-only proof of real source bridge boundaries in the shared Docker stack.

Uses the existing Budget test service only to prove it cannot impersonate the
new sources. Does not provision identities, store files, admit documents or
claim positive ProjectFlow/ArchFlow acceptance.
"""
import json
import subprocess
import time
import http.client
import urllib.request
import urllib.error
from local_acceptance import STATE, PROJECT


def inside(service, executable, code):
    return json.loads(subprocess.check_output(["docker","compose","--env-file",str(STATE/'.env'),
        "-p",PROJECT,"-f",str(STATE/'compose.json'),"exec","-T",service,executable,
        "-c" if executable=="python" else "-e",code],text=True))


# Compose starts processes before Next.js is necessarily accepting requests.
deadline=time.monotonic()+60
while True:
    try:
        with urllib.request.urlopen("http://localhost:3220/akb/api/health",timeout=5) as ready:
            if ready.status==200: break
    except (OSError, http.client.HTTPException):
        pass
    if time.monotonic()>=deadline: raise SystemExit("AKB did not become healthy before source smoke")
    time.sleep(1)

results={}
for operation,path in {
    "anonymous_prepare":"/api/stratos/source-upload/preflight",
    "anonymous_confirm":"/api/stratos/source-upload/sessions/test-session/confirm",
    "anonymous_status":"/api/stratos/source-upload/documents/test-document/status",
}.items():
    request=urllib.request.Request("http://localhost:3220/akb"+path,data=b'{}',headers={'Content-Type':'application/json'},method='POST')
    try:
        with urllib.request.urlopen(request,timeout=15) as response: results[operation]={'status':response.status}
    except urllib.error.HTTPError as error: results[operation]={'status':error.code,'code':json.loads(error.read())['error']['code']}
results['budget_cannot_impersonate_source']=inside('stratos-api','node',r'''
(async()=>{
  const e=process.env;
  const tokenResponse=await fetch(e.BUDGET_AKB_OIDC_TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'client_credentials',client_id:e.BUDGET_AKB_OIDC_CLIENT_ID,client_secret:e.BUDGET_AKB_OIDC_CLIENT_SECRET})});
  if(!tokenResponse.ok) { console.log(JSON.stringify({token_status:tokenResponse.status}));return; }
  const token=(await tokenResponse.json()).access_token;
  const response=await fetch('http://web:3000/akb/api/stratos/source-upload/preflight',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({document:{external_system:'STRATOS_PROJECTFLOW'}})});
  const result=await response.json();
  console.log(JSON.stringify({token_status:200,status:response.status,code:result.error?.code}));
})().catch(()=>{console.log(JSON.stringify({error:'unavailable'}));process.exitCode=1;});
''')
results['registry_boundary']=inside('registry-api','python',r'''
import json,urllib.request,urllib.error
from app.config import get_settings
from app.database import SessionLocal
from app.models import Document,DocumentVersion
from sqlalchemy import select,func
s=get_settings()
with SessionLocal() as db:
    counts={"documents":db.scalar(select(func.count()).select_from(Document)),"versions":db.scalar(select(func.count()).select_from(DocumentVersion))}
print(json.dumps({"source_authority_configured":bool(s.stratos_source_intake_authority_url),"auth_mode":s.auth_mode,"stored_counts":counts}))
''')
print(json.dumps(results,indent=2))
expected=all(results[name]['status']==401 for name in ('anonymous_prepare','anonymous_confirm','anonymous_status'))
expected=expected and results['budget_cannot_impersonate_source']=={'token_status':200,'status':403,'code':'SOURCE_SYSTEM_NOT_ALLOWED'}
expected=expected and results['registry_boundary']['auth_mode']=='oidc' and not results['registry_boundary']['source_authority_configured']
raise SystemExit(0 if expected else 1)
