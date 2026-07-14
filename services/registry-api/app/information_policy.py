from __future__ import annotations

from datetime import datetime
from enum import Enum
from hashlib import sha256
import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


POLICY_SCHEMA_VERSION = "stratos-information-policy-2"
POLICY_VERSION = "information-policy-2.0.0"
ORGANIZATION_ID = "org_stratos"


class HandlingClass(str, Enum):
    public = "PUBLIC"
    internal = "INTERNAL"
    restricted = "RESTRICTED"


class TlpLabel(str, Enum):
    red = "TLP:RED"
    amber_strict = "TLP:AMBER+STRICT"
    amber = "TLP:AMBER"
    green = "TLP:GREEN"
    clear = "TLP:CLEAR"


class PapLabel(str, Enum):
    red = "PAP:RED"
    amber = "PAP:AMBER"
    green = "PAP:GREEN"
    clear = "PAP:CLEAR"


class ContentCategory(str, Enum):
    personal_data = "PERSONAL_DATA"
    financial = "FINANCIAL"
    contractual = "CONTRACTUAL"
    security = "SECURITY"
    cyber_threat = "CYBER_THREAT"
    source_code = "SOURCE_CODE"
    authentication = "AUTHENTICATION"
    audit = "AUDIT"
    public_information = "PUBLIC_INFORMATION"


class PolicyObligation(str, Enum):
    audit_access = "AUDIT_ACCESS"
    no_external_ai = "NO_EXTERNAL_AI"
    local_processing_only = "LOCAL_PROCESSING_ONLY"
    no_public_export = "NO_PUBLIC_EXPORT"
    no_export = "NO_EXPORT"
    watermark = "WATERMARK"
    encrypt_at_rest = "ENCRYPT_AT_REST"
    recipient_confirmation = "RECIPIENT_CONFIRMATION"
    originator_approval = "ORIGINATOR_APPROVAL"
    pap_enforcement = "PAP_ENFORCEMENT"


class PolicyAudience(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    organization_id: Literal["org_stratos"] = Field(alias="organizationId")
    scope_type: Literal[
        "organization", "organization_unit", "project", "document", "recipient_set", "public"
    ] = Field(alias="scopeType")
    scope_ids: list[str] = Field(default_factory=list, alias="scopeIds")
    recipient_subject_ids: list[str] = Field(default_factory=list, alias="recipientSubjectIds")


class InformationPolicyBinding(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, use_enum_values=True)

    schema_version: Literal["stratos-information-policy-2"] = Field(alias="schemaVersion")
    policy_binding_id: str = Field(alias="policyBindingId", pattern=r"^(?:pol|pb)_[A-Za-z0-9_-]{8,}$")
    policy_version: Literal["information-policy-2.0.0"] = Field(alias="policyVersion")
    handling_class: HandlingClass = Field(alias="handlingClass")
    legal_classification: Literal["NONE"] = Field(alias="legalClassification")
    tlp: TlpLabel | None = None
    pap: PapLabel | None = None
    content_categories: list[ContentCategory] = Field(alias="contentCategories")
    audience: PolicyAudience
    obligations: list[PolicyObligation]
    originator_id: str | None = Field(default=None, alias="originatorId")
    issued_at: datetime | None = Field(default=None, alias="issuedAt")
    review_at: datetime | None = Field(default=None, alias="reviewAt")

    @model_validator(mode="after")
    def validate_semantics(self) -> "InformationPolicyBinding":
        if len(set(self.content_categories)) != len(self.content_categories):
            raise ValueError("contentCategories must contain unique values")
        if len(set(self.obligations)) != len(self.obligations):
            raise ValueError("obligations must contain unique values")
        if len(set(self.audience.scope_ids)) != len(self.audience.scope_ids):
            raise ValueError("audience.scopeIds must contain unique values")
        if len(set(self.audience.recipient_subject_ids)) != len(
            self.audience.recipient_subject_ids
        ):
            raise ValueError("audience.recipientSubjectIds must contain unique values")
        if self.tlp == TlpLabel.red.value:
            if self.audience.scope_type != "recipient_set":
                raise ValueError("TLP:RED requires audience.scopeType=recipient_set")
            if not self.audience.recipient_subject_ids:
                raise ValueError("TLP:RED requires explicit recipientSubjectIds")
            if not self.originator_id:
                raise ValueError("TLP:RED requires originatorId")
        return self


class IntegrationActor(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    type: Literal["person", "service"]
    subject_id: str = Field(alias="subjectId", min_length=1)


class IntegrationGovernanceScope(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    type: Literal[
        "own",
        "organization",
        "organization_unit",
        "budget_scope",
        "portfolio",
        "project",
        "document",
        "recipient_set",
    ]
    id: str | None = Field(default=None, min_length=1, max_length=160)
    owner_subject_id: str | None = Field(
        default=None,
        alias="ownerSubjectId",
        min_length=1,
        max_length=160,
    )

    @model_validator(mode="after")
    def validate_shape(self) -> "IntegrationGovernanceScope":
        if self.type == "own":
            if self.id is not None or not self.owner_subject_id:
                raise ValueError("An own scope requires ownerSubjectId and forbids id")
            return self
        if self.owner_subject_id is not None:
            raise ValueError("ownerSubjectId is valid only for an own scope")
        if self.type == "organization":
            if self.id != "org_stratos":
                raise ValueError("The organization scope must identify org_stratos")
            return self
        if not self.id:
            raise ValueError("A non-organization scope requires id")
        return self


class IntegrationSourceResource(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    governed_resource_id: str = Field(
        alias="governedResourceId", min_length=1, max_length=160
    )
    application: Literal["AIIP"]
    resource_type: Literal["idea"] = Field(alias="resourceType")
    resource_id: str = Field(alias="resourceId", min_length=1, max_length=160)
    source_version: str = Field(alias="sourceVersion", min_length=1, max_length=160)
    scope: IntegrationGovernanceScope


class IntegrationClassification(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, use_enum_values=True)

    handling_class: HandlingClass = Field(alias="handlingClass")
    legal_classification: Literal["NONE"] = Field(alias="legalClassification")
    tlp: TlpLabel | None
    pap: PapLabel | None


class IntegrationEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, use_enum_values=True)

    schema_version: Literal["stratos-integration-envelope-1"] = Field(alias="schemaVersion")
    organization_id: Literal["org_stratos"] = Field(alias="organizationId")
    source_system: Literal[
        "STRATOS_AIIP",
        "STRATOS_ARCHFLOW",
        "STRATOS_BUDGET",
        "STRATOS_PROJECTFLOW",
        "STRATOS_AKB",
        "STRATOS_SECURITY_PREFLIGHT",
    ] = Field(alias="sourceSystem")
    external_ref: str = Field(alias="externalRef", min_length=1, max_length=300)
    actor: IntegrationActor
    source_resource: IntegrationSourceResource | None = Field(
        default=None, alias="sourceResource"
    )
    correlation_id: str = Field(alias="correlationId", min_length=8, max_length=200)
    idempotency_key: str = Field(alias="idempotencyKey", min_length=8, max_length=200)
    policy_binding_id: str = Field(alias="policyBindingId", min_length=8)
    policy_version: Literal["information-policy-2.0.0"] = Field(alias="policyVersion")
    policy_hash: str = Field(alias="policyHash", pattern=r"^sha256:[a-f0-9]{64}$")
    classification: IntegrationClassification
    payload: dict[str, Any]


class AiipUploadActor(IntegrationActor):
    type: Literal["person"]


class AiipUploadEnvelopePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    operation: Literal["document_upload"]
    entity_type: Literal["InnovationRequest", "InnovationRequestImport"] = Field(
        alias="entityType"
    )
    entity_id: str = Field(alias="entityId", min_length=1, max_length=160)
    source_document_id: str = Field(
        alias="sourceDocumentId", min_length=1, max_length=1024
    )
    sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")


class AiipUploadIntegrationEnvelope(IntegrationEnvelope):
    """Exact immutable lineage envelope accepted by the dedicated AIIP route."""

    source_system: Literal["STRATOS_AIIP"] = Field(alias="sourceSystem")
    actor: AiipUploadActor
    source_resource: IntegrationSourceResource = Field(alias="sourceResource")
    payload: AiipUploadEnvelopePayload


def canonical_policy_payload(binding: InformationPolicyBinding) -> dict[str, Any]:
    value = binding.model_dump(mode="json", by_alias=True, exclude_none=False)
    return {
        "policyBindingId": value["policyBindingId"],
        "policyVersion": value["policyVersion"],
        "handlingClass": value["handlingClass"],
        "legalClassification": value["legalClassification"],
        "tlp": value["tlp"],
        "pap": value["pap"],
        "obligations": value["obligations"],
        "contentCategories": value["contentCategories"],
        "audience": value["audience"],
    }


def canonical_policy_hash(binding: InformationPolicyBinding) -> str:
    encoded = json.dumps(
        canonical_policy_payload(binding),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"sha256:{sha256(encoded).hexdigest()}"


def policy_columns(binding: InformationPolicyBinding | None) -> dict[str, Any]:
    if binding is None:
        return {
            "organization_id": ORGANIZATION_ID,
            "policy_binding_id": None,
            "policy_version": None,
            "policy_hash": None,
            "policy_summary": {},
        }
    return {
        "organization_id": binding.audience.organization_id,
        "policy_binding_id": binding.policy_binding_id,
        "policy_version": binding.policy_version,
        "policy_hash": canonical_policy_hash(binding),
        "policy_summary": binding.model_dump(mode="json", by_alias=True, exclude_none=False),
    }


def legacy_classification(binding: InformationPolicyBinding) -> str:
    return {
        HandlingClass.public.value: "public",
        HandlingClass.internal.value: "internal",
        HandlingClass.restricted.value: "restricted",
    }[str(binding.handling_class)]


def anonymous_public_eligible(binding: InformationPolicyBinding) -> bool:
    """Return true only for a policy that may enter STRATOS public-publication approval.

    This does not publish content and never substitutes for an active central
    InformationPublication plus a fresh public decision.
    """

    categories = set(binding.content_categories)
    obligations = set(binding.obligations)
    return bool(
        binding.handling_class == HandlingClass.public.value
        and binding.legal_classification == "NONE"
        and binding.audience.scope_type == "public"
        and not binding.audience.scope_ids
        and not binding.audience.recipient_subject_ids
        and binding.tlp in {None, TlpLabel.clear.value}
        and binding.pap in {None, PapLabel.clear.value}
        and ContentCategory.public_information.value in categories
        and not {ContentCategory.personal_data.value, ContentCategory.authentication.value}.intersection(categories)
        and PolicyObligation.audit_access.value in obligations
        and not {
            PolicyObligation.no_export.value,
            PolicyObligation.no_public_export.value,
        }.intersection(obligations)
    )
