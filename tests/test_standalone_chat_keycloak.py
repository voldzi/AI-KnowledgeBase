import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_standalone_chat_client_is_exact_public_pkce_client() -> None:
    realm = json.loads((ROOT / "infra/keycloak/realm-stratos.json").read_text())
    clients = {
        client["clientId"]: client
        for client in realm["clients"]
    }
    client = clients["akb-chat-web"]

    assert client["enabled"] is True
    assert client["publicClient"] is True
    assert client["standardFlowEnabled"] is True
    assert client["directAccessGrantsEnabled"] is False
    assert client["serviceAccountsEnabled"] is False
    assert client["redirectUris"] == [
        "https://chat.zeleznalady.cz/api/auth/callback"
    ]
    assert client["webOrigins"] == ["https://chat.zeleznalady.cz"]
    assert client["attributes"]["pkce.code.challenge.method"] == "S256"
    assert (
        client["attributes"]["post.logout.redirect.uris"]
        == "https://chat.zeleznalady.cz/*"
    )

    audience_mappers = {
        mapper["name"]: mapper["config"]["included.client.audience"]
        for mapper in client["protocolMappers"]
        if mapper["protocolMapper"] == "oidc-audience-mapper"
    }
    assert audience_mappers == {
        "akl-api audience": "akl-api",
        "budget-web audience": "budget-web",
        "stratos-access-api audience": "stratos-access-api",
    }


def test_live_reconciliation_ensures_standalone_chat_client() -> None:
    script = (
        ROOT / "infra/keycloak/update-stratos-public-routing.sh"
    ).read_text()

    assert "ensure_akb_chat_client" in script
    assert "-s publicClient=true" in script
    assert "-s standardFlowEnabled=true" in script
    assert "-s directAccessGrantsEnabled=false" in script
    assert "-s serviceAccountsEnabled=false" in script
    assert "https://chat.zeleznalady.cz/api/auth/callback" in script
    assert "pkce.code.challenge.method" in script
    assert "akl-api audience" in script
    assert "budget-web audience" in script
    assert "stratos-access-api audience" in script
    assert 'ensure_audience_mapper "$id" "budget-web audience" "budget-web"' in script
    assert (
        'ensure_audience_mapper "$id" "stratos-access-api audience" '
        '"stratos-access-api"'
    ) in script
    assert '\\"included.client.audience\\":\\"$audience\\"' in script
    assert '\\"id\\":\\"$mapper_id\\"' in script
    assert '-f "$mapper_payload_file"' in script
    assert "--fields config" not in script
    assert 'config.\\"included.client.audience\\"' not in script
    assert "did not persist audience" in script
    assert "KEYCLOAK_USE_BOOTSTRAP_ADMIN_SERVICE" in script
    assert "cleanup_bootstrap_client" in script
