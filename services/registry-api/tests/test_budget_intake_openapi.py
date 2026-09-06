from pathlib import Path

import yaml


def test_budget_intake_openapi_matches_runtime_and_documents_actor_credential(client):
    stored = yaml.safe_load((Path(__file__).parents[1] / "openapi.yaml").read_text())
    runtime = client.app.openapi()
    path = "/api/v1/integrations/stratos-budget-upload/documents/{document_id}/intake-authorization"
    assert stored["paths"][path] == runtime["paths"][path]
    for name in (
        "StratosBudgetIntakeAuthorizationRequest", "StratosBudgetIntakeAuthorizationResponse",
        "GovernanceScope", "HTTPValidationError", "ValidationError",
    ):
        assert stored["components"]["schemas"][name] == runtime["components"]["schemas"][name]
    operation = stored["paths"][path]["post"]
    assert {"200", "403", "409", "422", "503"} <= operation["responses"].keys()
    actor = next(
        parameter for parameter in operation["parameters"]
        if parameter["name"] == "X-STRATOS-Actor-Authorization"
    )
    assert actor["in"] == "header"
    assert actor["required"] is False  # Required only for the interactive workflow.
    assert "interactive" in actor["description"]
    assert "forbidden" in actor["description"]
    assert "historical_batch" in actor["description"]
