#!/usr/bin/env python3
"""Prepare a separate, persistent Docker Desktop integration test installation.

Uses the repositories' Dockerfiles and Compose service definitions. Generated
credentials/configuration stay under ignored data/local-acceptance, mode 0600.
Does not read either repository's .env or touch existing containers/volumes.
"""
from __future__ import annotations

import argparse
import base64
import copy
import json
import os
from pathlib import Path
import secrets
import subprocess
import uuid
import ssl

import yaml

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "data/local-acceptance"
PROJECT = "akb-stratos-test"
ISSUER = "https://login.akb.localhost:18081/realms/stratos"


def prepare_tls() -> None:
    """Private test CA; never install it into the host trust store."""
    tls = STATE / "tls"
    tls.mkdir(exist_ok=True, mode=0o700)
    if not (tls / "server.pem").exists():
        commands = [
            ["req", "-x509", "-newkey", "rsa:3072", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "365", "-subj", "/CN=AKB isolated acceptance CA", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"],
            ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=login.akb.localhost"],
            ["x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.pem", "-days", "90", "-extfile", "server.ext"],
        ]
        (tls / "server.ext").write_text("subjectAltName=DNS:login.akb.localhost,DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n")
        previous = os.umask(0o077)
        try:
            for command in commands:
                subprocess.run(["openssl", *command], cwd=tls, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        finally:
            os.umask(previous)
    default_ca = ssl.get_default_verify_paths().cafile
    if not default_ca: raise SystemExit("A public CA bundle is required for additive local trust")
    (tls / "ca-bundle.pem").write_text(Path(default_ca).read_text() + "\n" + (tls / "ca.pem").read_text())


def private_json(path: Path, value: object) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write("\n")
    path.chmod(0o600)


def prepare(stratos: Path) -> None:
    if not (stratos / "apps/api/Dockerfile").is_file():
        raise SystemExit("Expected the actual STRATOS checkout")
    stratos_npmrc = stratos / ".npmrc"
    if not stratos_npmrc.is_file():
        raise SystemExit("STRATOS Docker build requires its protected .npmrc")
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    prepare_tls()
    credential_path = STATE / "credentials.json"
    credentials = json.loads(credential_path.read_text()) if credential_path.exists() else {}
    for key in ("budget_session", "pf_session", "postgres", "minio", "keycloak", "operator", "break_glass", "policy", "session", "session_store", "session_encryption", "upload", "ingestion", "llm_gateway", "ticket", "jwt", "renderer", "budget_cursor", "pf_cursor", "pf_policy", "pf_availability", "pf_budget", "projectflow_source_state", "archflow_source_state", "svc-ingestion", "svc-akb-web-ingestion", "akb-rag-service", "stratos-akb-service", "stratos-projectflow-akb-service", "stratos-archflow-akb-service"):
        credentials.setdefault(key, secrets.token_hex(32))
    for key in ("operator_subject", "break_glass_subject", "projectflow_service_subject", "archflow_service_subject"):
        credentials.setdefault(key, str(uuid.uuid4()))
    private_json(credential_path, credentials)
    c = credentials
    access_path = STATE / "access.md"
    access_path.touch(mode=0o600, exist_ok=True)
    access_path.chmod(0o600)
    access_path.write_text("# Soukromé přihlášení do izolovaného lokálního testu\n\n"
        "Pouze pro Docker projekt `akb-stratos-test`. Nejde o produkční účet.\n\n"
        "STRATOS: http://localhost:3240\nAKB: http://localhost:3220/akb\nChat: http://localhost:3221\n\n"
        f"Uživatel: `operator`\n\nHeslo: `{c['operator']}`\n\n"
        "Účet je správce přístupů z běžného bootstrapu; automaticky neobchází dokumentové politiky.\n")
    base_path = ROOT / "infra/docker-compose/docker-compose.dev.yml"
    base = yaml.safe_load(base_path.read_text())
    selected = ["postgres", "qdrant", "opensearch", "minio", "keycloak", "web", "registry-api", "ingestion-service", "rag-retrieval-service", "llm-gateway-service", "evaluation-service", "governance-service"]
    services = {k: copy.deepcopy(base["services"][k]) for k in selected}
    for name, s in services.items():
        s.pop("ports", None)
        s["labels"] = {"akb.environment": "local-acceptance", "akb.synthetic-only": "true"}
        if "build" in s:
            s["build"]["context"] = str((base_path.parent / s["build"]["context"]).resolve())
            s["image"] = f"akb-acceptance/{name}:local"
        s["volumes"] = [str((base_path.parent / v.split(":", 1)[0]).resolve()) + ":" + v.split(":", 1)[1] if v.startswith("../") else v for v in s.get("volumes", [])]
        s["extra_hosts"] = ["host.docker.internal:host-gateway"]
        e = s.setdefault("environment", {})
        if name not in {"postgres", "qdrant", "opensearch", "minio", "keycloak"}:
            e.update(AKL_ENV="development", AKL_AUTH_MODE="oidc", AKL_IDENTITY_MODE="external_oidc", AKL_OIDC_ISSUER=ISSUER, AKL_OIDC_AUDIENCE="akl-api", AKL_OIDC_JWKS_URL=ISSUER + "/protocol/openid-connect/certs", OTEL_SDK_DISABLED="true")
        for key in list(e):
            if key.startswith("AKL_STRATOS_") and key.endswith("_URL") or key == "AKL_WEB_STRATOS_AUTH_ME_URL":
                old = e[key]
                if "host.docker.internal:4000" in old:
                    e[key] = old.split(":-", 1)[1].removesuffix("}").replace("host.docker.internal:4000", "stratos-api:4000")
        e.update({k: v for k, v in {"AKB_POLICY_SERVICE_TOKEN": c["policy"], "AKL_WEB_SESSION_STORE_SECRET": c["session_store"], "AKL_WEB_SESSION_ENCRYPTION_KEY": c["session_encryption"], "AKL_WEB_UPLOAD_SIGNING_SECRET": c["upload"], "AKL_INGESTION_AUTHORIZATION_SECRET": c["ingestion"], "AKL_WEB_SESSION_SECRET": c["session"], "STRATOS_CONTENT_SECURITY_REQUIRED": "true", "AKL_OBJECT_STORAGE_MODE": "s3", "AKL_S3_ENDPOINT": "http://minio:9000", "AKL_S3_ACCESS_KEY_ID": "akb_acceptance", "AKL_S3_SECRET_ACCESS_KEY": c["minio"]}.items() if k in e})
    services["postgres"]["environment"].update(POSTGRES_PASSWORD=c["postgres"])
    services["postgres"]["ports"] = ["127.0.0.1:15440:5432"]
    services["minio"].update(image="minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e", ports=["127.0.0.1:19040:9000", "127.0.0.1:19041:9001"])
    services["minio"]["environment"].update(MINIO_ROOT_USER="akb_acceptance", MINIO_ROOT_PASSWORD=c["minio"])
    services["opensearch"]["environment"].update(OPENSEARCH_JAVA_OPTS="-Xms512m -Xmx512m", DISABLE_SECURITY_PLUGIN="true", DISABLE_INSTALL_DEMO_CONFIG="true")
    services["keycloak"].update(image="quay.io/keycloak/keycloak:26.7.3@sha256:ff4257d0d64efbe99ed1ddfaf07765cc3c36dc7518bf8324d41961327f441c54", ports=["127.0.0.1:18081:18081"], volumes=[f"{STATE / 'realm.json'}:/opt/keycloak/data/import/realm.json:ro"])
    services["keycloak"]["networks"] = {"app_zone": {"aliases": ["login.akb.localhost"]}, "data_zone": {}, "management_zone": {}}
    services["keycloak"]["environment"].update(KC_DB_PASSWORD=c["postgres"], KEYCLOAK_ADMIN_PASSWORD=c["keycloak"], KC_HTTP_PORT="18081", KC_HOSTNAME="http://login.akb.localhost:18081", JAVA_OPTS_KC_HEAP="-Xms128m -Xmx384m")
    services["keycloak"]["environment"].update(KC_HTTP_PORT="18080", KC_HTTPS_PORT="18081", KC_HOSTNAME="https://login.akb.localhost:18081", KC_HTTPS_CERTIFICATE_FILE="/run/akb-test/server.pem", KC_HTTPS_CERTIFICATE_KEY_FILE="/run/akb-test/server.key")
    services["keycloak"]["volumes"] += [f"{STATE / 'tls/server.pem'}:/run/akb-test/server.pem:ro", f"{STATE / 'tls/server.key'}:/run/akb-test/server.key:ro"]
    services["registry-api"]["environment"].update(
        AKL_DATABASE_URL=f"postgresql+psycopg://akl_platform:{c['postgres']}@postgres:5432/akl_registry",
        AKL_AUTO_CREATE_SCHEMA="false",
        AKL_TRUSTED_SERVICE_CLIENT_IDS="akb-rag-service,stratos-akb-service,stratos-projectflow-akb-service,stratos-archflow-akb-service,svc-budget-controlled-rules,svc-ingestion",
        AKL_SERVICE_CLIENT_ROUTE_GRANTS="akb-rag-service=authz|audit|idempotency,stratos-akb-service=stratos-budget-upload,stratos-projectflow-akb-service=stratos-source-intake,stratos-archflow-akb-service=stratos-source-intake,svc-budget-controlled-rules=controlled-rules-read,svc-ingestion=authz|audit|documents-read|ingestion-status",
        AKL_STRATOS_SOURCE_INTAKE_AUTHORITY_URL="http://stratos-api:4000/api/v1/information-governance/source-document-intake/authorize",
        AKL_STRATOS_SERVICE_POLICY_BINDING_ID="pb_akb_local_service_audit_20260906",
        AKB_POLICY_SERVICE_TOKEN=c["policy"],
    )
    services["registry-api"]["ports"] = ["127.0.0.1:18001:8000"]
    services["registry-api"]["environment"].update(AKL_OIDC_ISSUER=ISSUER, AKL_OIDC_JWKS_URL=ISSUER + "/protocol/openid-connect/certs")
    services["registry-api"]["build"]["args"] = {"SOURCE_DATE_EPOCH": subprocess.check_output(["git", "show", "-s", "--format=%ct", "HEAD"], cwd=ROOT, text=True).strip()}
    # Governance uses the existing bearer boundary, not an OIDC auth-mode enum.
    services["governance-service"]["environment"]["AKL_AUTH_MODE"] = "bearer"
    for name, client in [("ingestion-service", "svc-ingestion"), ("rag-retrieval-service", "akb-rag-service")]:
        services[name]["environment"].update(AKL_REGISTRY_SERVICE_TOKEN_URL=ISSUER + "/protocol/openid-connect/token", AKL_REGISTRY_SERVICE_CLIENT_ID=client, AKL_REGISTRY_SERVICE_CLIENT_SECRET=c[client])
    services["ingestion-service"]["environment"].update(AKL_INGESTION_OBJECT_STORAGE_MODE="s3", AKL_INGESTION_DOCLING_MODE="off", AKL_LLM_GATEWAY_TOKEN=c["llm_gateway"])
    services["rag-retrieval-service"]["environment"].update(AKL_RAG_AUTHZ_MODE="registry", AKL_RAG_RETRIEVER_MODE="qdrant", AKL_RAG_FULLTEXT_MODE="opensearch", AKL_RAG_LLM_CLIENT_MODE="http", AKL_LLM_GATEWAY_TOKEN=c["llm_gateway"])
    services["llm-gateway-service"].pop("depends_on", None)
    services["llm-gateway-service"]["environment"].update(AKL_AUTH_MODE="bearer", AKL_SERVICE_TOKEN=c["llm_gateway"], AKL_LLM_ENABLED_PROVIDERS="ollama", AKL_LLM_DEFAULT_PROVIDER="ollama", AKL_OLLAMA_BASE_URL="http://host.docker.internal:11434", AKL_OLLAMA_BASE_URLS="http://host.docker.internal:11434", AKL_LLM_ALLOW_MODEL_PULL="false")
    services["llm-gateway-service"]["environment"]["AKL_LLM_MODEL_PROVIDER_MAP"] = json.dumps({"gemma4:12b-mlx": "ollama", "bge-m3": "ollama"})
    web = services["web"]
    app_urls = {"NEXT_PUBLIC_AKB_URL": "http://localhost:3220/akb", "NEXT_PUBLIC_CHAT_URL": "http://localhost:3221", "NEXT_PUBLIC_STRATOS_HOME_URL": "http://localhost:3240", "NEXT_PUBLIC_PROJECTFLOW_URL": "http://localhost:3231", "NEXT_PUBLIC_ARCHFLOW_URL": "http://localhost:3232"}
    web["build"] = {"context": str(ROOT), "dockerfile": "apps/web/Dockerfile", "args": {**app_urls, "NEXT_PUBLIC_AKL_BASE_PATH": "/akb", "AKL_IMAGE_SERVICE": "web"}}
    web["ports"] = ["127.0.0.1:3220:3000"]
    web["environment"].update(AKL_API_CLIENT_MODE="production", AKL_WEB_BASE_PATH="/akb", AKL_WEB_PUBLIC_BASE_URL="http://localhost:3220/akb", AKL_WEB_OIDC_ISSUER=ISSUER, AKL_WEB_OIDC_CLIENT_ID="akl-web", AKL_WEB_SESSION_SECRET=c["session"], AKL_WEB_INGESTION_TOKEN_URL=ISSUER + "/protocol/openid-connect/token", AKL_WEB_INGESTION_CLIENT_SECRET=c["svc-akb-web-ingestion"], STRATOS_CONTENT_SECURITY_MODE="clamd", STRATOS_CONTENT_SECURITY_REQUIRED="true", AKL_STRATOS_OFFICIAL_SOURCES_URL="http://stratos-api:4000/api/v1/integrations/akb/official-sources")
    web["healthcheck"]["test"] = ["CMD-SHELL", "wget -qO- http://$${HOSTNAME}:3000/akb/api/health >/dev/null || exit 1"]
    # Keep the existing app/data network separation. The dev web reaches local
    # S3 through Docker Desktop's published loopback port, as other host bridges do.
    web["environment"]["AKL_S3_ENDPOINT"] = "http://host.docker.internal:19040"
    services["chat-web"] = copy.deepcopy(web)
    chat = services["chat-web"]
    chat["image"] = "akb-acceptance/chat-web:local"
    chat["build"]["args"] = {**app_urls, "NEXT_PUBLIC_AKL_BASE_PATH": "", "AKL_IMAGE_SERVICE": "chat-web"}
    chat["ports"] = ["127.0.0.1:3221:3000"]
    chat["environment"].update(AKL_WEB_PROFILE="chat", AKL_WEB_BASE_PATH="", AKL_WEB_PUBLIC_BASE_URL="http://localhost:3221", AKL_WEB_OIDC_CLIENT_ID="akb-chat-web")
    chat["healthcheck"]["test"] = ["CMD-SHELL", "wget -qO- http://$${HOSTNAME}:3000/api/health >/dev/null || exit 1"]
    services["clamav"] = {"image": "clamav/clamav:1.5.4@sha256:f0954d679017eb6d48221e2b2be3ac5457bf278a844f39b672376f55a085f591", "platform": "linux/amd64", "restart": "unless-stopped", "volumes": ["clamav-data:/var/lib/clamav"], "networks": ["app_zone"], "healthcheck": {"test": ["CMD", "/usr/local/bin/clamdcheck.sh"], "interval": "10s", "timeout": "5s", "retries": 3, "start_period": "180s"}}
    services["stratos-postgres"] = {"image": "postgres:18.6-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2", "restart": "unless-stopped", "environment": {"POSTGRES_USER": "stratos", "POSTGRES_DB": "stratos", "POSTGRES_PASSWORD": c["postgres"]}, "volumes": ["stratos-postgres:/var/lib/postgresql"], "ports": ["127.0.0.1:15441:5432"], "networks": ["data_zone"], "healthcheck": {"test": ["CMD", "pg_isready", "-U", "stratos", "-d", "stratos"], "interval": "5s", "timeout": "5s", "retries": 20}}
    sb = yaml.safe_load((stratos / "docker-compose.yml").read_text())
    names = ["api", "web", "archflow", "projectflow-api", "projectflow-web", "report-renderer"]
    for name in names:
        s = copy.deepcopy(sb["services"][name])
        s.pop("container_name", None)
        s.pop("profiles", None)
        s.pop("ports", None)
        s["build"]["context"] = str(stratos)
        s["image"] = f"akb-acceptance/stratos-{name}:local"
        s["networks"] = ["app_zone", "data_zone"] if name.endswith("api") else ["app_zone"]
        deps = s.get("depends_on", {})
        if isinstance(deps, list): deps = {d: {"condition": "service_started"} for d in deps}
        s["depends_on"] = {"stratos-" + d: rule for d, rule in deps.items()}
        s["environment"].update(OTEL_SDK_DISABLED="true", STRATOS_REPORT_RENDERER_TOKEN=c["renderer"], STRATOS_REPORT_RENDERER_URL="http://stratos-report-renderer:4020")
        services["stratos-" + name] = s
    api = services["stratos-api"]
    api["ports"] = ["127.0.0.1:14001:4000"]
    api["environment"].update(DATABASE_URL=f"postgresql://stratos:{c['postgres']}@stratos-postgres:5432/stratos?schema=public", APP_ENV="test", JWT_SECRET=c["jwt"], BUDGET_AUTH_MODE="oidc", BUDGET_OIDC_ISSUER=ISSUER, BUDGET_OIDC_JWKS_URL=ISSUER + "/protocol/openid-connect/certs", BUDGET_OIDC_AUDIENCE="budget-web", APP_BASE_URL="http://localhost:3240", BUDGET_PUBLIC_BASE_URL="http://localhost:3240", ARCHFLOW_PUBLIC_BASE_URL="http://localhost:3232", APP_ALLOWED_ORIGINS="http://localhost:3240,http://localhost:3231,http://localhost:3232,http://localhost:3220,http://localhost:3221", AKL_REGISTRY_BASE_URL="http://registry-api:8000/api/v1", AKL_RAG_BASE_URL="http://rag-retrieval-service:8080/api/v1", BUDGET_AKB_RAG_BASE_URL="http://rag-retrieval-service:8080/api/v1", AKB_POLICY_SERVICE_TOKEN=c["policy"], BUDGET_AKB_UPLOAD_TICKET_KEY=c["ticket"], BUDGET_AKB_DOCUMENT_INTAKE_ENABLED="true", STRATOS_BOOTSTRAP_ADMIN_SUBJECT=c["operator_subject"], STRATOS_BOOTSTRAP_ADMIN_EMAIL="operator@acceptance.invalid", STRATOS_BOOTSTRAP_ADMIN_DISPLAY_NAME="Správce lokálního testu", STRATOS_BREAK_GLASS_ADMIN_SUBJECT=c["break_glass_subject"], STRATOS_BREAK_GLASS_ADMIN_EMAIL="break-glass@acceptance.invalid", STRATOS_BREAK_GLASS_ADMIN_DISPLAY_NAME="Nouzový správce lokálního testu")
    api["depends_on"]["stratos-postgres"] = {"condition": "service_healthy"}
    api["environment"]["BUDGET_DIRECTOR_CURSOR_HMAC_SECRET"] = c["budget_cursor"]
    api["environment"]["BUDGET_SESSION_ENCRYPTION_KEY"] = base64.b64encode(bytes.fromhex(c["budget_session"])).decode()
    api["environment"].update(
        BUDGET_AKB_WEB_BASE_URL="http://web:3000/akb",
        BUDGET_AKB_OIDC_TOKEN_URL=ISSUER + "/protocol/openid-connect/token",
        BUDGET_AKB_OIDC_CLIENT_ID="stratos-akb-service",
        BUDGET_AKB_OIDC_CLIENT_SECRET=c["stratos-akb-service"],
        PROJECTFLOW_POLICY_SERVICE_TOKEN=c["pf_policy"],
        PROJECTFLOW_AVAILABILITY_SERVICE_TOKEN=c["pf_availability"],
        PROJECTFLOW_SERVICE_TOKEN=c["pf_budget"],
        PROJECTFLOW_AKB_SOURCE_INTAKE_ENABLED="true",
        PROJECTFLOW_AKB_SERVICE_SUBJECT_ID=c["projectflow_service_subject"],
        PROJECTFLOW_SOURCE_INTAKE_AUTHORITY_URL="http://stratos-projectflow-api:4010/api/internal/source-document-intake/authorize",
        ARCHFLOW_AKB_SOURCE_INTAKE_ENABLED="true",
        ARCHFLOW_AKB_SOURCE_INTAKE_BASE_URL="http://web:3000/akb",
        ARCHFLOW_AKB_SERVICE_SUBJECT_ID=c["archflow_service_subject"],
        ARCHFLOW_AKB_UPLOAD_STATE_KEY=c["archflow_source_state"],
        ARCHFLOW_AKB_OIDC_TOKEN_URL=ISSUER + "/protocol/openid-connect/token",
        ARCHFLOW_AKB_OIDC_CLIENT_ID="stratos-archflow-akb-service",
        ARCHFLOW_AKB_OIDC_CLIENT_SECRET=c["stratos-archflow-akb-service"],
        ARCHFLOW_AKB_OIDC_AUDIENCE="akl-api",
        ARCHFLOW_AKB_OIDC_SCOPE="service_ingestion",
    )
    api["healthcheck"] = {"test": ["CMD-SHELL", "wget -qO- http://127.0.0.1:4000/health/ready >/dev/null"], "interval": "20s", "timeout": "5s", "retries": 10}
    sw = services["stratos-web"]
    sw["ports"] = ["127.0.0.1:3240:3000"]
    args = {"NEXT_PUBLIC_API_URL": "http://localhost:14001", "NEXT_PUBLIC_CHAT_URL": "http://localhost:3221", "NEXT_PUBLIC_AKB_URL": "http://localhost:3220/akb", "NEXT_PUBLIC_PROJECTFLOW_URL": "http://localhost:3231", "NEXT_PUBLIC_ARCHFLOW_URL": "http://localhost:3232", "BUDGET_API_INTERNAL_URL": "http://stratos-api:4000", "BUDGET_PUBLIC_BASE_URL": "http://localhost:3240", "BUDGET_OIDC_ISSUER": ISSUER, "BUDGET_OIDC_CLIENT_ID": "budget-web", "NEXT_PUBLIC_BUDGET_PUBLIC_BASE_URL": "http://localhost:3240", "NEXT_PUBLIC_BUDGET_OIDC_ISSUER": ISSUER, "NEXT_PUBLIC_BUDGET_OIDC_CLIENT_ID": "budget-web", "NEXT_PUBLIC_BUDGET_OIDC_SCOPES": "openid profile email"}
    sw["build"]["args"] = args
    # Use the production browser BFF path; direct API requests with cookies are
    # a different origin and cannot replace the session boundary.
    args["NEXT_PUBLIC_API_URL"] = "/api"
    sw["environment"].update(args)
    arch = services["stratos-archflow"]
    arch["ports"] = ["127.0.0.1:3232:3002"]
    arch["build"]["args"] = {"NEXT_PUBLIC_API_URL": "http://localhost:14001", "NEXT_PUBLIC_EXECUTIVE_CENTER_URL": "http://localhost:3240", "NEXT_PUBLIC_STRATOS_HOME_URL": "http://localhost:3240", "NEXT_PUBLIC_PROJECTFLOW_URL": "http://localhost:3231", "NEXT_PUBLIC_AKB_URL": "http://localhost:3220/akb", "NEXT_PUBLIC_CHAT_URL": "http://localhost:3221", "NEXT_PUBLIC_ARCHFLOW_BASE_PATH": ""}
    pf = services["stratos-projectflow-api"]
    pf["ports"] = ["127.0.0.1:14010:4010"]
    pf["environment"].update(APP_ENV="test", PROJECTFLOW_DATABASE_URL=f"postgresql://stratos:{c['postgres']}@stratos-postgres:5432/projectflow", PROJECTFLOW_AUTH_MODE="oidc", PROJECTFLOW_OIDC_ISSUER=ISSUER, PROJECTFLOW_OIDC_JWKS_URL=ISSUER + "/protocol/openid-connect/certs", PROJECTFLOW_OIDC_CLIENT_ID="projectflow-web", PROJECTFLOW_OIDC_AUDIENCE="projectflow-web", PROJECTFLOW_PUBLIC_BASE_URL="http://localhost:3231", NEXT_PUBLIC_PROJECTFLOW_BASE_PATH="", PROJECTFLOW_SESSION_COOKIE_PATH="/", BUDGET_API_INTERNAL_URL="http://stratos-api:4000", PROJECTFLOW_POLICY_DECISION_URL="http://stratos-api:4000/api/v1/policy/decisions", CORS_ORIGIN="http://localhost:3231")
    pf["depends_on"]["stratos-postgres"] = {"condition": "service_healthy"}
    pf["environment"]["PROJECTFLOW_DIRECTOR_CURSOR_HMAC_SECRET"] = c["pf_cursor"]
    pf["environment"]["PROJECTFLOW_SESSION_ENCRYPTION_KEY"] = base64.b64encode(bytes.fromhex(c["pf_session"])).decode()
    pf["environment"].update(
        PROJECTFLOW_POLICY_SERVICE_TOKEN=c["pf_policy"],
        PROJECTFLOW_AVAILABILITY_SERVICE_TOKEN=c["pf_availability"],
        PROJECTFLOW_SERVICE_TOKEN=c["pf_budget"],
        PROJECTFLOW_AKB_SOURCE_INTAKE_ENABLED="true",
        PROJECTFLOW_AKB_SOURCE_INTAKE_BASE_URL="http://web:3000/akb",
        PROJECTFLOW_AKB_SERVICE_SUBJECT_ID=c["projectflow_service_subject"],
        PROJECTFLOW_AKB_UPLOAD_STATE_KEY=c["projectflow_source_state"],
        PROJECTFLOW_AKB_OIDC_TOKEN_URL=ISSUER + "/protocol/openid-connect/token",
        PROJECTFLOW_AKB_OIDC_CLIENT_ID="stratos-projectflow-akb-service",
        PROJECTFLOW_AKB_OIDC_CLIENT_SECRET=c["stratos-projectflow-akb-service"],
        PROJECTFLOW_AKB_OIDC_AUDIENCE="akl-api",
        PROJECTFLOW_AKB_OIDC_SCOPE="service_ingestion",
    )
    pw = services["stratos-projectflow-web"]
    pw["ports"] = ["127.0.0.1:3231:3010"]
    pa = {"NEXT_PUBLIC_STRATOS_HOME_URL": "http://localhost:3240", "NEXT_PUBLIC_ARCHFLOW_URL": "http://localhost:3232", "NEXT_PUBLIC_AKB_URL": "http://localhost:3220/akb", "NEXT_PUBLIC_CHAT_URL": "http://localhost:3221", "NEXT_PUBLIC_PROJECTFLOW_API_URL": "", "NEXT_PUBLIC_PROJECTFLOW_BASE_PATH": "", "NEXT_PUBLIC_PROJECTFLOW_OIDC_ISSUER": ISSUER, "NEXT_PUBLIC_PROJECTFLOW_OIDC_CLIENT_ID": "projectflow-web", "NEXT_PUBLIC_PROJECTFLOW_OIDC_SCOPES": "openid profile email", "PROJECTFLOW_API_INTERNAL_URL": "http://stratos-projectflow-api:4010"}
    pw["build"]["args"] = pa
    pw["environment"].update(pa)
    for name, s in services.items():
        if "build" in s:
            s.setdefault("volumes", []).append(f"{STATE / 'tls/ca-bundle.pem'}:/run/akb-test-ca.pem:ro")
            s["environment"].update(NODE_EXTRA_CA_CERTS="/run/akb-test-ca.pem", SSL_CERT_FILE="/run/akb-test-ca.pem", REQUESTS_CA_BUNDLE="/run/akb-test-ca.pem")
    volumes = {v: {} for v in base["volumes"]}
    volumes.update({"stratos-postgres": {}, "clamav-data": {}})
    private_json(STATE / "compose.json", {
        "name": PROJECT,
        "services": services,
        "volumes": volumes,
        "networks": base["networks"],
        "secrets": {"github-packages-npmrc": {"file": str(stratos_npmrc)}},
    })
    realm = json.loads((ROOT / "infra/keycloak/realm-stratos.json").read_text())
    realm.update(realm="stratos", enabled=True, sslRequired="none", loginTheme="keycloak", registrationAllowed=False)
    realm["users"] = []
    clients = []
    audience_mapper = lambda audience: {"name": "aud-" + audience, "protocol": "openid-connect", "protocolMapper": "oidc-audience-mapper", "config": {"included.custom.audience": audience, "access.token.claim": "true", "id.token.claim": "false"}}
    realm["clientScopes"] = [{
        "name": "service_ingestion",
        "description": "Explicit OAuth scope requested by AKB ingestion service clients.",
        "protocol": "openid-connect",
        "attributes": {"include.in.token.scope": "true", "display.on.consent.screen": "false"},
    }]
    for client_id, port, path in [("akl-web", 3220, "/akb"), ("akb-chat-web", 3221, ""), ("budget-web", 3240, ""), ("projectflow-web", 3231, "")]:
        origin = f"http://localhost:{port}"
        clients.append({"clientId": client_id, "enabled": True, "protocol": "openid-connect", "publicClient": True, "standardFlowEnabled": True, "directAccessGrantsEnabled": False, "redirectUris": [origin + path + "/*"], "webOrigins": [origin], "attributes": {"post.logout.redirect.uris": origin + path + "/*", "pkce.code.challenge.method": "S256"}, "defaultClientScopes": ["basic", "profile", "email", "roles"], "protocolMappers": [audience_mapper(a) for a in ["akl-api", "budget-web", "projectflow-web", "stratos-access-api"]] + [{"name": "identity-audience", "protocol": "openid-connect", "protocolMapper": "oidc-hardcoded-claim-mapper", "config": {"claim.value": "employees", "claim.name": "identity_audience", "jsonType.label": "String", "access.token.claim": "true", "id.token.claim": "false"}}]})
    # ArchFlow uses Budget's server-owned OIDC client with its own public return URL.
    budget_client = next(client for client in clients if client["clientId"] == "budget-web")
    budget_client["redirectUris"].append("http://localhost:3232/*")
    budget_client["webOrigins"].append("http://localhost:3232")
    budget_client["attributes"]["post.logout.redirect.uris"] += "##http://localhost:3232/*"
    service_subjects = {
        "stratos-projectflow-akb-service": c["projectflow_service_subject"],
        "stratos-archflow-akb-service": c["archflow_service_subject"],
    }
    for client_id in ["svc-ingestion", "svc-akb-web-ingestion", "akb-rag-service", "stratos-akb-service", "stratos-projectflow-akb-service", "stratos-archflow-akb-service"]:
        clients.append({"clientId": client_id, "enabled": True, "protocol": "openid-connect", "publicClient": False, "secret": c[client_id], "serviceAccountsEnabled": True, "standardFlowEnabled": False, "directAccessGrantsEnabled": False, "defaultClientScopes": ["roles"], "optionalClientScopes": ["service_ingestion"] if client_id in service_subjects else [], "protocolMappers": [audience_mapper(a) for a in ["akl-api", "llm-gateway-service"]]})
        roles = {"svc-ingestion": ["service_ingestion"], "svc-akb-web-ingestion": ["service_akb_web_ingestion"], "akb-rag-service": ["service_rag"], "stratos-akb-service": ["service_ingestion"], "stratos-projectflow-akb-service": ["service_ingestion"], "stratos-archflow-akb-service": ["service_ingestion"]}[client_id]
        realm["users"].append({**({"id": service_subjects[client_id]} if client_id in service_subjects else {}), "username": "service-account-" + client_id, "serviceAccountClientId": client_id, "enabled": True, "realmRoles": roles})
    realm["clients"] = clients
    for user, key in [("operator", "operator"), ("break-glass", "break_glass")]:
        realm["users"].append({"id": c[key + "_subject"], "username": user, "email": user + "@acceptance.invalid", "emailVerified": True, "enabled": True, "firstName": "Lokální", "lastName": "test", "attributes": {"identity_audience": ["employees"]}, "realmRoles": ["stratos_user"], "credentials": [{"type": "password", "value": c[key], "temporary": False}]})
    private_json(STATE / "realm.json", realm)
    (STATE / ".env").write_text("")
    (STATE / ".env").chmod(0o600)
    print(f"Prepared configuration for {PROJECT}; credentials: {credential_path}.")


def compose(*args: str) -> None:
    subprocess.run(["docker", "compose", "--env-file", str(STATE / ".env"), "-p", PROJECT, "-f", str(STATE / "compose.json"), *args], cwd=STATE, check=True)


def initialize() -> None:
    """Documented local bootstrap only, always against this project's databases."""
    config = json.loads((STATE / "compose.json").read_text())
    assert config["name"] == PROJECT
    assert config["services"]["registry-api"]["environment"]["AKL_DATABASE_URL"].endswith("@postgres:5432/akl_registry")
    assert config["services"]["stratos-api"]["environment"]["DATABASE_URL"].endswith("@stratos-postgres:5432/stratos?schema=public")
    compose("run", "--rm", "--no-deps", "registry-api", "alembic", "upgrade", "head")
    # README local:db sequence: schema, access bootstrap, then database hardening.
    compose("run", "--rm", "--no-deps", "stratos-api", "pnpm", "exec", "prisma", "db", "push", "--skip-generate")
    compose("run", "--rm", "--no-deps", "stratos-api", "pnpm", "prisma:seed")
    compose("run", "--rm", "--no-deps", "stratos-api", "pnpm", "prisma:migrate:access-governance")
    compose("exec", "-T", "stratos-postgres", "sh", "-c", "psql -U stratos -d postgres -tAc \"SELECT 1 FROM pg_database WHERE datname='projectflow'\" | grep -q 1 || createdb -U stratos projectflow")
    compose("run", "--rm", "--no-deps", "stratos-projectflow-api", "node", "dist/db/migrate.js")
    compose("run", "--rm", "--no-deps", "registry-api", "python", "-c", "import os,boto3; from botocore.exceptions import ClientError; s=boto3.client('s3',endpoint_url=os.environ['AKL_S3_ENDPOINT'],aws_access_key_id=os.environ['AKL_S3_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['AKL_S3_SECRET_ACCESS_KEY']); buckets={v['Name'] for v in s.list_buckets()['Buckets']}; name=os.environ['AKL_S3_BUCKET']; s.create_bucket(Bucket=name) if name not in buckets else None; print('Local acceptance bucket ready')")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "initialize", "build", "compose"])
    parser.add_argument("--stratos-root", type=Path, default=ROOT.parent / "STRATOS")
    args, rest = parser.parse_known_args()
    if args.action == "prepare":
        if rest: parser.error("Unexpected arguments")
        prepare(args.stratos_root.resolve())
    elif args.action == "build":
        if not rest: parser.error("Name the application images to build sequentially")
        configuration = json.loads((STATE / "compose.json").read_text())
        if any(name not in configuration["services"] or "build" not in configuration["services"][name] for name in rest):
            parser.error("Build accepts only named buildable services from the local project")
        for name in rest:
            compose("build", name)
    elif args.action == "initialize":
        if rest: parser.error("Unexpected arguments")
        initialize()
    else:
        if not (STATE / "compose.json").is_file(): raise SystemExit("Run prepare first")
        if "--" in rest: rest.remove("--")
        raise SystemExit(subprocess.call(["docker", "compose", "--env-file", str(STATE / ".env"), "-p", PROJECT, "-f", str(STATE / "compose.json"), *rest], cwd=STATE))


if __name__ == "__main__":
    main()
