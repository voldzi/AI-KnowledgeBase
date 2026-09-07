import json
from pathlib import Path
import yaml
from app.source_intake import SourcePrepare

ROOT=Path(__file__).resolve().parents[3]
CONTRACT=ROOT/'contracts/stratos/source-document-intake'


def test_source_examples_match_runtime_and_published_schema():
    spec=json.loads((CONTRACT/'openapi.json').read_text())
    for example in (CONTRACT/'examples').glob('*.json'):
        value=json.loads(example.read_text())
        SourcePrepare.model_validate(value)


def test_registry_source_contract_is_runtime_exact(client):
    stored=yaml.safe_load((ROOT/'services/registry-api/openapi.yaml').read_text())
    runtime=client.app.openapi()
    for path,item in runtime['paths'].items():
        if '/stratos-source-intake/' in path:
            assert stored['paths'][path]==item
    for name in ('SourcePrepare','SourceDocument','SourceAuthorization','SourceConfirm','SourceStatusRequest','SourceStatusResponse'):
        assert stored['components']['schemas'][name]==runtime['components']['schemas'][name]


def test_public_source_routes_are_exactly_embedded_in_root_contract():
    root=json.loads((ROOT/'openapi/openapi.json').read_text())
    source=json.loads((CONTRACT/'openapi.json').read_text())
    for path,item in source['paths'].items():
        actual={key:value for key,value in root['paths'][path].items() if key!='servers'}
        assert actual==item
    for name,schema in source['components']['schemas'].items():
        assert root['components']['schemas'][name]==schema
