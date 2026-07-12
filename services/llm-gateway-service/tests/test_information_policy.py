import pytest

from app.errors import GatewayError
from app.information_policy import enforce_provider_policy


def metadata(*, handling_class: str = "INTERNAL", obligations: list[str] | None = None):
    return {
        "policy_version": "information-policy-2.0.0",
        "legal_classification": "NONE",
        "handling_class": handling_class,
        "obligations": obligations or [],
    }


def test_local_provider_accepts_restricted_content() -> None:
    enforce_provider_policy(provider="ollama", metadata=metadata(handling_class="RESTRICTED"))


@pytest.mark.parametrize("obligation", ["NO_EXTERNAL_AI", "LOCAL_PROCESSING_ONLY"])
def test_external_provider_rejects_forbidden_obligation(obligation: str) -> None:
    with pytest.raises(GatewayError) as error:
        enforce_provider_policy(provider="openai", metadata=metadata(obligations=[obligation]))
    assert error.value.code == "EXTERNAL_AI_DENIED"
    assert error.value.status_code == 403


def test_external_provider_rejects_restricted_content() -> None:
    with pytest.raises(GatewayError) as error:
        enforce_provider_policy(provider="openai", metadata=metadata(handling_class="RESTRICTED"))
    assert error.value.code == "EXTERNAL_AI_DENIED"


def test_external_provider_requires_policy_binding() -> None:
    with pytest.raises(GatewayError) as error:
        enforce_provider_policy(provider="openai", metadata={"purpose": "unbound_request"})
    assert error.value.code == "POLICY_BINDING_REQUIRED"


def test_unknown_obligation_is_fail_closed() -> None:
    with pytest.raises(GatewayError) as error:
        enforce_provider_policy(provider="ollama", metadata=metadata(obligations=["UNKNOWN_ACTION"]))
    assert error.value.code == "POLICY_OBLIGATION_UNKNOWN"


def test_unknown_policy_version_is_fail_closed() -> None:
    value = metadata()
    value["policy_version"] = "future-policy"
    with pytest.raises(GatewayError) as error:
        enforce_provider_policy(provider="ollama", metadata=value)
    assert error.value.code == "POLICY_VERSION_UNKNOWN"
