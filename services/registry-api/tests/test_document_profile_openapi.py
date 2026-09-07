from pathlib import Path

import yaml


def test_admission_readiness_schema_is_a_resolvable_response_component(client):
    stored = yaml.safe_load((Path(__file__).parents[1] / "openapi.yaml").read_text())
    runtime = client.app.openapi()
    name = "DocumentIntakeReadinessResponse"
    path = "/api/v1/integrations/ingestion/readiness"
    assert name not in stored["components"].get("securitySchemes", {})
    assert stored["components"]["schemas"][name] == runtime["components"]["schemas"][name]
    assert stored["paths"][path] == runtime["paths"][path]

    def validate_references(value):
        if isinstance(value, dict):
            reference = value.get("$ref", "")
            if reference.startswith("#/components/schemas/"):
                assert reference.rsplit("/", 1)[-1] in stored["components"]["schemas"], reference
            for child in value.values():
                validate_references(child)
        elif isinstance(value, list):
            for child in value:
                validate_references(child)

    validate_references(stored)
