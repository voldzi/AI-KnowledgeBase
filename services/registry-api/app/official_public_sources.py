from app.information_policy import InformationPolicyBinding
from app.models import Document
from app.schemas import Classification, DocumentCreate


OFFICIAL_PUBLIC_SOURCE_TAG = "official-public-reference"
OFFICIAL_PUBLIC_SOURCE_MODEL = "official-public-reference-v1"


def official_public_source_policy(policy: InformationPolicyBinding | None) -> bool:
    if policy is None:
        return False
    return bool(
        policy.handling_class == "PUBLIC"
        and policy.legal_classification == "NONE"
        and policy.tlp is None
        and policy.pap is None
        and list(policy.content_categories) == ["PUBLIC_INFORMATION"]
        and policy.audience.organization_id == "org_stratos"
        and policy.audience.scope_type == "organization"
        and not policy.audience.scope_ids
        and not policy.audience.recipient_subject_ids
    )


def official_public_source_metadata(metadata: dict[str, object]) -> bool:
    return bool(
        metadata.get("source_model") == OFFICIAL_PUBLIC_SOURCE_MODEL
        and metadata.get("source_public") is True
        and metadata.get("audience") == "organization"
        and metadata.get("anonymous_publication") is False
        and isinstance(metadata.get("collection_id"), str)
        and bool(str(metadata.get("collection_id")).strip())
        and isinstance(metadata.get("authority"), str)
        and bool(str(metadata.get("authority")).strip())
        and isinstance(metadata.get("canonical_url"), str)
        and str(metadata.get("canonical_url")).startswith("https://")
    )


def is_official_public_source_create(payload: DocumentCreate) -> bool:
    return bool(
        payload.classification == Classification.public
        and OFFICIAL_PUBLIC_SOURCE_TAG in payload.tags
        and official_public_source_metadata(payload.metadata)
        and official_public_source_policy(payload.information_policy)
        and (
            payload.governance_scope is None
            or (
                payload.governance_scope.type == "organization"
                and payload.governance_scope.id in {None, "org_stratos"}
            )
        )
    )


def is_official_public_source_document(document: Document) -> bool:
    try:
        policy = InformationPolicyBinding.model_validate(document.policy_summary)
    except ValueError:
        return False
    return bool(
        document.classification == Classification.public.value
        and OFFICIAL_PUBLIC_SOURCE_TAG in document.tags
        and official_public_source_metadata(document.document_metadata)
        and official_public_source_policy(policy)
        and document.governance_scope_type == "organization"
        and document.governance_scope_id in {None, "org_stratos"}
        and document.governance_scope_owner_subject_id is None
    )
