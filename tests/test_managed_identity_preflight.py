import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("managed_identity_preflight", Path(__file__).parents[1] / "scripts/managed_identity_preflight.py")
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)

ISSUER = "https://identity.example/identity"


class ManagedIdentityPreflightTests(unittest.TestCase):
    def test_proposes_separate_disabled_clients_without_secret_or_write(self):
        result = preflight.prepare(ISSUER, ISSUER, "https://apps.example/akb", "https://chat.example")
        clients = result["clients"]
        self.assertEqual(len(clients), 6)
        self.assertTrue(all(c["enabled"] is False for c in clients))
        self.assertEqual(clients[0]["redirectUris"], ["https://apps.example/akb/api/auth/callback"])
        self.assertEqual(clients[1]["postLogoutUris"], ["https://chat.example"])
        self.assertEqual([c["audience"] for c in clients[2:]], ["budget-api", "projectflow-api", "archflow-api", "akl-api"])
        self.assertTrue(all("clientSecret" not in c and "rotateSecret" not in c for c in clients))

    def test_rejects_implicit_trust_insecure_urls_and_wildcards(self):
        for issuer, approved, web, chat in [
            (ISSUER, "https://foreign.example/identity", "https://apps.example/akb", "https://chat.example"),
            (ISSUER, ISSUER, "http://apps.example/akb", "https://chat.example"),
            (ISSUER, ISSUER, "https://apps.example/*", "https://chat.example"),
            (ISSUER, ISSUER, "https://apps.example/akb?token=invalid", "https://chat.example"),
            (ISSUER, ISSUER, "https://apps.example/akb", "https://apps.example/chat"),
        ]:
            with self.assertRaises(ValueError):
                preflight.prepare(issuer, approved, web, chat)

    def test_discovery_rejects_foreign_endpoint_issuer_and_missing_protocol(self):
        body = {"issuer": ISSUER, "code_challenge_methods_supported": ["S256"], "response_types_supported": ["code"], "id_token_signing_alg_values_supported": ["RS256"], "token_endpoint_auth_methods_supported": ["none", "client_secret_post"], "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"]}
        for key in ("authorization_endpoint", "token_endpoint", "jwks_uri", "userinfo_endpoint", "revocation_endpoint", "end_session_endpoint"):
            body[key] = ISSUER + "/" + key
        preflight.validate_discovery(ISSUER, body)
        for key, value in [("issuer", "https://other.example/identity"), ("token_endpoint", "https://other.example/token"), ("jwks_uri", "http://identity.example/identity/jwks"), ("code_challenge_methods_supported", ["plain"]), ("grant_types_supported", []), ("token_endpoint_auth_methods_supported", ["client_secret_post"])]:
            altered = copy.deepcopy(body)
            altered[key] = value
            with self.assertRaises(ValueError):
                preflight.validate_discovery(ISSUER, altered)


if __name__ == "__main__":
    unittest.main()
