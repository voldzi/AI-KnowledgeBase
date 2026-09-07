#!/usr/bin/env python3
"""Fail closed on stale or vulnerable AKB runtime dependencies and write evidence."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "apps/web"
NODE_VERSION = "26.8.1"
PNPM_VERSION = "11.19.0"
UV_VERSION = "0.12.9"
PIP_AUDIT_VERSION = "2.10.0"
PYTHON_VERSION = "3.12.14"
IMAGE_MANIFEST = ROOT / "infra/dependency-images.json"
PYTHON_LOCKS = {
    name: (ROOT / f"services/{name}/requirements.txt", ROOT / f"services/{name}/requirements.c4.lock")
    for name in (
        "evaluation-service",
        "governance-service",
        "ingestion-service",
        "llm-gateway-service",
        "rag-retrieval-service",
    )
}
PYTHON_LOCKS["registry-api"] = (
    ROOT / "services/registry-api/pyproject.toml",
    ROOT / "services/registry-api/requirements.c4.lock",
)


def run(command: list[str], *, cwd: Path = ROOT, accepted: tuple[int, ...] = (0,)) -> str:
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True, timeout=300)
    if result.returncode not in accepted:
        detail = (result.stderr or result.stdout or "no output").strip()
        raise SystemExit(f"Dependency quality command failed: {command[0]} ({detail[-1200:]})")
    return result.stdout


def versions(path: Path) -> dict[str, str]:
    return dict(re.findall(r"^([A-Za-z0-9_.-]+)==([^ \\\n]+)", path.read_text(encoding="utf-8"), re.MULTILINE))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def node_components(tree: object) -> dict[str, str]:
    result: dict[str, str] = {}

    def visit(value: object, dependency_name: str | None = None) -> None:
        if isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, dict):
            name, version = value.get("name", dependency_name), value.get("version")
            if isinstance(name, str) and isinstance(version, str):
                result[name] = version
            for key in ("dependencies", "optionalDependencies"):
                dependencies = value.get(key)
                if isinstance(dependencies, dict):
                    for child_name, child in dependencies.items():
                        visit(child, child_name)
                else:
                    visit(dependencies)

    visit(tree)
    return result


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, default=ROOT / ".artifacts/quality")
parser.add_argument(
    "--verify-image-registry",
    action="store_true",
    help="Resolve every immutable infrastructure image in its source registry.",
)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)

expected_tools = {"pnpm": PNPM_VERSION, "uv": UV_VERSION, "pip-audit": PIP_AUDIT_VERSION}
actual_tools = {
    "node": run(["node", "--version"]).strip().removeprefix("v"),
    "pnpm": run(["pnpm", "--version"]).strip(),
    "uv": run(["uv", "--version"]).split()[1],
    "pip-audit": run(["pip-audit", "--version"]).split()[1],
}
for name, expected in expected_tools.items():
    if actual_tools[name] != expected:
        raise SystemExit(f"Dependency quality requires {name} {expected}, found {actual_tools[name]}")
if actual_tools["node"] != NODE_VERSION:
    raise SystemExit(f"Dependency quality requires Node {NODE_VERSION}, found {actual_tools['node']}")


def require_text(path: Path, fragments: tuple[str, ...]) -> None:
    content = path.read_text(encoding="utf-8")
    missing = [fragment for fragment in fragments if fragment not in content]
    if missing:
        raise SystemExit(f"Dependency parity failed for {path.relative_to(ROOT)}: missing {missing}")


image_manifest = json.loads(IMAGE_MANIFEST.read_text(encoding="utf-8"))
images = image_manifest.get("images")
if not isinstance(images, dict) or not images:
    raise SystemExit("Infrastructure dependency image manifest is empty")
for name, reference in images.items():
    if not isinstance(reference, str) or not re.search(r"@sha256:[0-9a-f]{64}$", reference):
        raise SystemExit(f"Infrastructure image is not immutable: {name}")
    if ":latest" in reference:
        raise SystemExit(f"Infrastructure image uses a floating latest tag: {name}")

require_text(ROOT / ".node-version", (NODE_VERSION,))
require_text(WEB / "package.json", (f'"packageManager": "pnpm@{PNPM_VERSION}"', f'"node": ">={NODE_VERSION} <27"'))
for dockerfile in (WEB / "Dockerfile", ROOT / "infra/ci/local-fast-check/Dockerfile.web"):
    require_text(dockerfile, (images["node-alpine"], f"pnpm-{PNPM_VERSION}.tgz"))
for dockerfile in (
    ROOT / "infra/ci/local-fast-check/Dockerfile.python",
    *(ROOT / f"services/{name}/Dockerfile" for name in PYTHON_LOCKS),
):
    require_text(dockerfile, (images["python"],))
require_text(ROOT / "services/platform-infrastructure/Dockerfile", (images["python"],))
require_text(
    ROOT / "infra/ci/gitea-runner/Dockerfile",
    (images["gitea-act-runner"], images["docker-cli"], images["node-bookworm"], images["python"]),
)
env_example = (ROOT / ".env.example").read_text(encoding="utf-8")
for name in (
    "caddy", "postgresql", "qdrant", "opensearch", "minio-local-s3",
    "keycloak", "prometheus", "grafana", "loki", "ollama",
):
    if images[name] not in env_example:
        raise SystemExit(f".env.example is not aligned with image manifest: {name}")
for compose_path in (
    ROOT / "infra/docker-compose/docker-compose.dev.yml",
    ROOT / "infra/docker-compose/docker-compose.prod-like.yml",
):
    require_text(
        compose_path,
        tuple(images[name] for name in (
            "caddy", "postgresql", "qdrant", "minio-local-s3", "keycloak",
            "prometheus", "grafana", "loki", "ollama",
        )),
    )
require_text(ROOT / "infra/docker-compose/docker-compose.dev.yml", (images["opensearch"],))
require_text(ROOT / "infra/docker-compose/docker-compose.docker-home.yml", (images["caddy"], images["qdrant"]))
require_text(
    ROOT / "scripts/local_acceptance.py",
    (images["postgresql"], images["minio-local-s3"], images["keycloak"], images["clamav"]),
)
for path in ROOT.glob("infra/rerankers/docker-compose*.yml"):
    content = path.read_text(encoding="utf-8")
    if "text-embeddings-inference" in content and images["text-embeddings-inference"] not in content:
        raise SystemExit(f"Reranker image drift in {path.relative_to(ROOT)}")
    if "alpine/socat" in content and images["socat"] not in content:
        raise SystemExit(f"Proxy image drift in {path.relative_to(ROOT)}")
    if "llama.cpp" in content and images["llama-cpp-server"] not in content:
        raise SystemExit(f"llama.cpp image drift in {path.relative_to(ROOT)}")
require_text(
    ROOT / ".github/workflows/ci.yml",
    (
        f'node-version: "{NODE_VERSION}"',
        f"version: {PNPM_VERSION}",
        f'python-version: "{PYTHON_VERSION}"',
        f"uv=={UV_VERSION}",
        f"pip-audit=={PIP_AUDIT_VERSION}",
        "--require-hashes",
    ),
)

node_audit = json.loads(run(["pnpm", "audit", "--prod", "--audit-level", "low", "--json"], cwd=WEB, accepted=(0, 1)))
node_counts = node_audit.get("metadata", {}).get("vulnerabilities")
if not isinstance(node_counts, dict) or node_audit.get("advisories") is None:
    raise SystemExit("Node dependency audit was incomplete")
if any(value for value in node_counts.values()):
    raise SystemExit("Node production dependencies contain unresolved advisories")
node_outdated = json.loads(run(["pnpm", "outdated", "--format", "json"], cwd=WEB, accepted=(0, 1)))
if node_outdated:
    raise SystemExit("Node direct dependencies are not current")

python_audits: dict[str, object] = {}
python_freshness: dict[str, object] = {}
with tempfile.TemporaryDirectory(prefix="akb-dependency-quality-") as temp:
    temporary = Path(temp)
    for name, (dependency_input, lock) in PYTHON_LOCKS.items():
        audit = json.loads(run(["pip-audit", "--disable-pip", "--no-deps", "-r", str(lock), "--format", "json"]))
        findings = [finding for item in audit.get("dependencies", []) for finding in item.get("vulns", [])]
        if findings:
            raise SystemExit(f"Python dependency audit failed for {name}")
        python_audits[name] = {"packages": len(audit.get("dependencies", [])), "vulnerabilities": 0}
        candidate = temporary / f"{name}.lock"
        run([
            "uv", "pip", "compile", "--upgrade", "--no-build", "--no-emit-index-url",
            "--python-version", "3.12", "--python-platform", "x86_64-manylinux_2_28",
            "--output-file", str(candidate), str(dependency_input),
        ])
        current, latest = versions(lock), versions(candidate)
        drift = {package: {"current": current.get(package), "latest": latest.get(package)}
                 for package in sorted(current.keys() | latest.keys()) if current.get(package) != latest.get(package)}
        if drift:
            raise SystemExit(f"Python dependencies are not current for {name}: {json.dumps(drift, sort_keys=True)}")
        python_freshness[name] = {"packages": len(current), "outdated": 0}

    reranker_requirements = ROOT / "infra/rerankers/gte-native-requirements.txt"
    reranker_versions = versions(reranker_requirements)
    for package in ("sentence-transformers", "torch"):
        with urlopen(f"https://pypi.org/pypi/{package}/json", timeout=30) as response:
            latest = json.load(response)["info"]["version"]
        if reranker_versions.get(package) != latest:
            raise SystemExit(
                f"Native reranker dependency is not current: {package} "
                f"{reranker_versions.get(package)} -> {latest}"
            )
    reranker_lock = temporary / "gte-native.lock"
    run([
        "uv", "pip", "compile", "--upgrade", "--no-build", "--generate-hashes",
        "--python-version", "3.12", "--output-file", str(reranker_lock),
        str(reranker_requirements),
    ])
    reranker_audit = json.loads(run([
        "pip-audit", "--disable-pip", "--no-deps", "-r", str(reranker_lock),
        "--format", "json",
    ]))
    reranker_findings = [
        finding
        for item in reranker_audit.get("dependencies", [])
        for finding in item.get("vulns", [])
    ]
    if reranker_findings:
        raise SystemExit("Python dependency audit failed for native reranker")

docling_input = (ROOT / "services/ingestion-service/requirements-docling.in").read_text(encoding="utf-8")
match = re.search(r"docling-slim\[[^]]+\]==([0-9.]+)", docling_input)
with urlopen("https://pypi.org/pypi/docling-slim/json", timeout=30) as response:
    docling_latest = json.load(response)["info"]["version"]
if match is None or match.group(1) != docling_latest:
    raise SystemExit(f"Docling Slim is not current: {match.group(1) if match else 'missing'} -> {docling_latest}")
docling_lock = ROOT / "services/ingestion-service/requirements-docling.c4.lock"
docling_audit = json.loads(run(["pip-audit", "--disable-pip", "--no-deps", "-r", str(docling_lock), "--format", "json"]))
docling_findings = [finding for item in docling_audit.get("dependencies", []) for finding in item.get("vulns", [])]
if docling_findings:
    raise SystemExit("Python dependency audit failed for Docling")

node_tree = json.loads(run(["pnpm", "list", "--prod", "--depth", "Infinity", "--json"], cwd=WEB))
registry_verified = False
if args.verify_image_registry:
    def verify_image(reference: str) -> None:
        run(["docker", "buildx", "imagetools", "inspect", reference])

    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(verify_image, images.values()))
    registry_verified = True
components: dict[tuple[str, str, str], dict[str, str]] = {}
for name, version in node_components(node_tree).items():
    encoded = "%40" + name[1:] if name.startswith("@") else name
    purl = f"pkg:npm/{encoded}@{version}"
    components[("npm", name, version)] = {"type": "library", "name": name, "version": version, "purl": purl, "bom-ref": purl}
for _, lock in PYTHON_LOCKS.values():
    for name, version in versions(lock).items():
        purl = f"pkg:pypi/{name.lower().replace('_', '-')}@{version}"
        components[("pypi", name, version)] = {"type": "library", "name": name, "version": version, "purl": purl, "bom-ref": purl}

lock_files = [WEB / "pnpm-lock.yaml", *(lock for _, lock in PYTHON_LOCKS.values()), docling_lock]
revision = run(["git", "rev-parse", "HEAD"]).strip()
evidence = {
    "schemaVersion": "akb-dependency-quality-1",
    "revision": revision,
    "workingTreeDirty": bool(run(["git", "status", "--porcelain"]).strip()),
    "tools": actual_tools,
    "locks": {str(path.relative_to(ROOT)): "sha256:" + sha256(path) for path in lock_files},
    "node": {"vulnerabilities": node_counts, "outdated": node_outdated},
    "python": {
        "audits": {
            **python_audits,
            "docling": {"packages": len(docling_audit.get("dependencies", [])), "vulnerabilities": 0},
            "native-reranker": {"packages": len(reranker_audit.get("dependencies", [])), "vulnerabilities": 0},
        },
        "freshness": python_freshness,
    },
    "doclingSlim": {"current": match.group(1), "latest": docling_latest},
    "infrastructureImages": {
        "reviewedAt": image_manifest["reviewedAt"],
        "count": len(images),
        "immutable": True,
        "registryVerified": registry_verified,
        "externalProductionServices": image_manifest["externalProductionServices"],
        "exceptions": image_manifest["exceptions"],
    },
    "externalArtifacts": {"@voldzi/stratos-ui": "0.5.3; immutable STRATOS handoff 6170bbc"},
}
(output / "dependency-security.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
(output / "sbom.cdx.json").write_text(json.dumps({
    "bomFormat": "CycloneDX",
    "specVersion": "1.6",
    "version": 1,
    "metadata": {"component": {"type": "application", "name": "AKB", "version": revision}},
    "components": sorted(components.values(), key=lambda item: item["purl"]),
}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"components": len(components), "nodeOutdated": 0, "pythonOutdated": 0, "vulnerabilities": 0, "output": str(output)}))
