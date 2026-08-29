from __future__ import annotations

import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
RETIRED_ROLES = {"service_governance", "service_llm_gateway"}


class RetiredIdentityCleanupTests(unittest.TestCase):
    def test_clean_bootstraps_do_not_create_retired_identities(self) -> None:
        for realm_name in ("realm-stratos.json", "realm-akl.json"):
            realm = json.loads((ROOT / "infra/keycloak" / realm_name).read_text())
            roles = {item["name"] for item in realm["roles"]["realm"]}
            self.assertTrue(RETIRED_ROLES.isdisjoint(roles))
        stratos = json.loads((ROOT / "infra/keycloak/realm-stratos.json").read_text())
        clients = {item["clientId"] for item in stratos["clients"]}
        self.assertNotIn("stratos-akl-adapter", clients)

    def test_retired_roles_cannot_reenter_registry_or_web_authorization(self) -> None:
        guarded_sources = (
            "services/registry-api/app/permissions.py",
            "services/registry-api/app/api.py",
            "apps/web/src/lib/auth/authorization.ts",
            "apps/web/src/features/admin/admin-skeleton.tsx",
        )
        for relative in guarded_sources:
            source = (ROOT / relative).read_text()
            for role in RETIRED_ROLES:
                self.assertNotIn(role, source, f"{role} remains active in {relative}")

    def test_legacy_aliases_are_tombstones_not_active_roles(self) -> None:
        baseline = json.loads(
            (ROOT / "contracts/stratos/access-governance/v1/keycloak-baseline.json").read_text()
        )
        self.assertTrue(
            {"akl_service_governance", "akl_service_llm_gateway"}.issubset(
                baseline["deprecatedRealmRoles"]
            )
        )
        self.assertTrue(
            {"akl_service_governance", "akl_service_llm_gateway"}.isdisjoint(
                baseline["realmRoles"]
            )
        )

    def test_replacement_boundaries_are_explicit_and_narrow(self) -> None:
        env = (ROOT / ".env.example").read_text()
        self.assertIn(
            "stratos-akb-service=stratos-budget-upload", env
        )
        self.assertNotIn("stratos-akl-adapter", env)
        governance = (ROOT / "services/governance-service/.env.example").read_text()
        llm = (ROOT / "services/llm-gateway-service/.env.example").read_text()
        self.assertIn("AKL_SERVICE_TOKEN=", governance)
        self.assertIn("AKL_SERVICE_TOKEN=", llm)
        self.assertIn(
            "AKL_LLM_GATEWAY_ALLOWED_CALLER_ROLES=service_ingestion,service_rag",
            llm,
        )


if __name__ == "__main__":
    unittest.main()
