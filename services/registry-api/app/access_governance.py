from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from concurrent.futures import Future, TimeoutError as FutureTimeoutError
from contextlib import contextmanager
from contextvars import ContextVar
from hashlib import sha256
import json
import logging
import threading
import time
from typing import Annotated, Any, Literal
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.config import Settings
from app.document_admission import has_explicit_document_tlp
from app.document_profile_catalog import validate_profile_policy
from app.document_profile import (
    DocumentAdmissionConfirmation, DocumentAdmissionExpectation,
    PreparedDocumentAdmission, prepare_document_admission, verify_document_admission_confirmation,
)

from app.information_policy import (
    InformationPolicyBinding,
    IntegrationEnvelope,
    canonical_policy_hash,
    canonical_policy_payload,
)


_request_decisions: ContextVar[dict[str, dict[str, Any]] | None] = ContextVar("akb_request_decisions", default=None)
logger = logging.getLogger("akl.registry.governance")


@contextmanager
def policy_decision_scope():
    """Reuse identical PDP inputs only within one read request, never across users/requests."""
    token = _request_decisions.set({})
    try:
        yield
    finally:
        _request_decisions.reset(token)


@dataclass(frozen=True)
class AccessEntitlement:
    entitlement_id: str
    definition_version: str
    profile_id: str | None
    source: str
    source_ref: str | None
    virtual: bool
    capabilities: frozenset[str]
    scopes: frozenset[str]
    effective_scopes: frozenset[str]
    valid_from: datetime | None
    valid_until: datetime | None


@dataclass(frozen=True)
class AccessProjection:
    capabilities: frozenset[str]
    scopes: frozenset[str]
    organization_id: str
    identity_active: bool
    membership_active: bool
    application_access_active: bool
    entitlements: tuple[AccessEntitlement, ...] = ()
    subject_id: str | None = None
    identity_kind: str = "person"
    employee_eligible: bool = False
    expires_at: datetime | None = None


ACCESS_PROJECTION_V2_SCHEMA = "stratos-access-projection-2"
ACCESS_PROJECTION_V2_REVISION = "2.1.0"
ACCESS_PROJECTION_V2_STATUS = "active"
ACCESS_PROJECTION_V2_DIGEST = "sha256:16509ccbdc3e49e7a9918a29c833a8ae1aa7c78777b0a8693a2477acc2f0dafa"
ACCESS_PROJECTION_V2_CATALOG = "capabilities-1.12.2"
ACCESS_PROJECTION_V2_MAX_TTL_SECONDS = 15 * 60
_CAPABILITY_PATTERN = r"^[a-z][a-z0-9-]*:[a-z][a-z0-9_.-]*$"


class ProjectionSimpleScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["own", "public"]


class ProjectionIdentifiedScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal[
        "organization", "organization_unit", "budget_scope", "portfolio",
        "project", "document", "recipient_set",
    ]
    id: str = Field(min_length=1, max_length=200)


ProjectionScope = Annotated[
    ProjectionSimpleScope | ProjectionIdentifiedScope,
    Field(discriminator="type"),
]
ProjectionCapability = Annotated[str, Field(pattern=_CAPABILITY_PATTERN)]


class ProjectionEntitlement(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    entitlement_id: str = Field(alias="entitlementId", min_length=1, max_length=240)
    definition_version: str = Field(alias="definitionVersion", min_length=1, max_length=100)
    profile_id: str | None = Field(alias="profileId", max_length=100)
    source: Literal["MANUAL", "KEYCLOAK_GROUP", "OIDC", "SYSTEM"]
    source_ref: str | None = Field(alias="sourceRef", max_length=240)
    virtual: bool
    capabilities: list[ProjectionCapability] = Field(min_length=1)
    scopes: list[ProjectionScope] = Field(min_length=1)
    effective_scopes: list[ProjectionScope] = Field(alias="effectiveScopes", min_length=1)
    valid_from: datetime | None = Field(alias="validFrom")
    valid_until: datetime | None = Field(alias="validUntil")

    @field_validator("capabilities")
    @classmethod
    def capabilities_are_unique(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("capabilities must be unique")
        return value

    @field_validator("scopes", "effective_scopes")
    @classmethod
    def scopes_are_unique(cls, value: list[ProjectionScope]) -> list[ProjectionScope]:
        keys = [_projection_scope_key(item) for item in value]
        if len(keys) != len(set(keys)):
            raise ValueError("scopes must be unique")
        return value


class ProjectionApplicationAccess(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    application_id: Literal["executive-center", "budget", "projectflow", "archflow", "akb"] = Field(alias="applicationId")
    entitlements: list[ProjectionEntitlement] = Field(min_length=1, max_length=32)


class ProjectionIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    subject_id: str = Field(alias="subjectId", min_length=1, max_length=200)
    kind: Literal["person", "service"]
    active: bool
    employee_eligible: bool = Field(alias="employeeEligible")


class ProjectionMembership(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    active: bool
    valid_until: datetime | None = Field(alias="validUntil")


class ActiveAccessProjectionV2(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_version: Literal[ACCESS_PROJECTION_V2_SCHEMA] = Field(alias="schemaVersion")
    contract_revision: Literal[ACCESS_PROJECTION_V2_REVISION] = Field(alias="contractRevision")
    contract_status: Literal[ACCESS_PROJECTION_V2_STATUS] = Field(alias="contractStatus")
    contract_digest: Literal[ACCESS_PROJECTION_V2_DIGEST] = Field(alias="contractDigest")
    catalog_version: Literal[ACCESS_PROJECTION_V2_CATALOG] = Field(alias="catalogVersion")
    generated_at: datetime = Field(alias="generatedAt")
    expires_at: datetime = Field(alias="expiresAt")
    organization_id: Literal["org_stratos"] = Field(alias="organizationId")
    identity: ProjectionIdentity
    membership: ProjectionMembership
    application_access: list[ProjectionApplicationAccess] = Field(alias="applicationAccess", max_length=5)

    @field_validator("application_access")
    @classmethod
    def applications_are_unique(
        cls, value: list[ProjectionApplicationAccess]
    ) -> list[ProjectionApplicationAccess]:
        ids = [item.application_id for item in value]
        if len(ids) != len(set(ids)):
            raise ValueError("applications must be unique")
        return value


@dataclass(frozen=True)
class GovernedResourceRegistration:
    resource_id: str
    source_version: str
    policy_binding_id: str
    policy_hash: str
    document_admission: DocumentAdmissionConfirmation | None = None
    admission_request: PreparedDocumentAdmission | None = None


@dataclass(frozen=True)
class BudgetAkbGovernedResourceRegistration:
    governed_resource_id: str
    resource_type: Literal["document", "document-version"]
    resource_id: str
    source_version: str
    parent_id: str
    scope: dict[str, str]
    inherited_from_resource_id: str
    policy_binding_id: str
    policy_version: str
    policy_hash: str
    registered_by_subject_id: Literal["service:akb"]
    confirmed_by_subject_id: Literal["service:akb"]
    correlation_id: str
    idempotency_key: str
    confirmation: dict[str, Any]
    document_admission: DocumentAdmissionConfirmation | None = None
    admission_request: PreparedDocumentAdmission | None = None


@dataclass(frozen=True)
class InformationPublicationRegistration:
    publication_id: str
    governed_resource_id: str
    resource_type: str
    resource_id: str
    source_version: str
    public_slug: str
    policy_binding_id: str
    policy_hash: str
    status: str
    published_at: str | None
    revoked_at: str | None


class CentralPublicDecisionPublication(BaseModel):
    model_config = ConfigDict(extra="forbid")

    publication_id: str = Field(alias="id", min_length=1)
    application: Literal["AKB"]
    resource_type: str = Field(alias="resourceType", min_length=1)
    resource_id: str = Field(alias="resourceId", min_length=1)
    source_version: str = Field(alias="sourceVersion", min_length=1)
    public_slug: str = Field(alias="publicSlug", min_length=1)
    policy_binding_id: str = Field(alias="policyBindingId", min_length=1)
    policy_hash: str = Field(alias="policyHash", pattern=r"^sha256:[a-f0-9]{64}$")
    published_at: datetime = Field(alias="publishedAt")


class CentralPublicDecisionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["ALLOW", "DENY"]
    reason_codes: list[str] = Field(alias="reasonCodes")
    obligations: list[str]
    policy_version: str = Field(alias="policyVersion", min_length=1)
    decision_id: str = Field(alias="decisionId", min_length=1)
    publication: CentralPublicDecisionPublication | None


class GovernanceUnavailable(RuntimeError):
    pass


class GovernanceInvalidResponse(GovernanceUnavailable):
    pass


class GovernanceDenied(RuntimeError):
    def __init__(self, message: str, *, upstream_code: str | None = None) -> None:
        super().__init__(message)
        self.upstream_code = upstream_code


def validate_public_decision_response(value: Any) -> dict[str, Any]:
    try:
        decision = CentralPublicDecisionResponse.model_validate(value)
    except ValidationError as exc:
        raise GovernanceInvalidResponse(
            "STRATOS public access governance returned an invalid response"
        ) from exc
    if (decision.decision == "ALLOW") != (decision.publication is not None):
        raise GovernanceInvalidResponse(
            "STRATOS public access governance returned an invalid response"
        )
    return decision.model_dump(mode="json", by_alias=True)


class StratosGovernanceClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._cache: dict[str, tuple[float, AccessProjection]] = {}
        self._decision_flights: dict[str, Future[dict[str, Any]]] = {}
        self._lock = threading.Lock()
        # Runtime authorization can evaluate several distinct governed scopes
        # while building one document projection. Reusing one thread-safe
        # client preserves every fail-closed PDP decision while avoiding a new
        # TCP/TLS handshake for each scope.
        self._http_client = httpx.Client(
            timeout=self.settings.stratos_access_timeout_seconds,
            limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
        )

    def close(self) -> None:
        close = getattr(self._http_client, "close", None)
        if callable(close):
            close()

    def user_projection(self, token: str, *, token_expires_at: float | None, expected_subject: str | None = None, identity_audience: str | None = None) -> AccessProjection:
        if not self.settings.stratos_auth_me_url:
            raise GovernanceUnavailable("STRATOS access projection is not configured")
        cache_key = sha256(token.encode("utf-8")).hexdigest()
        now = time.time()
        with self._lock:
            cached = self._cache.get(cache_key)
            if self.settings.identity_mode != "managed" and cached and cached[0] > now:
                return cached[1]
        try:
            response = self._http_client.get(
                self.settings.stratos_auth_me_url,
                headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
            )
        except httpx.HTTPError as exc:
            raise GovernanceUnavailable("STRATOS access projection is unavailable") from exc
        if response.status_code in {401, 403}:
            raise GovernanceDenied("STRATOS rejected the bearer identity")
        if response.status_code != 200:
            raise GovernanceUnavailable(
                f"STRATOS access projection returned {response.status_code}"
            )
        try:
            body = response.json()
            if not isinstance(body, dict):
                raise ValueError("Invalid projection object")
            projection = self._parse_projection(body, now=datetime.now(timezone.utc))
            if expected_subject and projection.subject_id != expected_subject:
                raise GovernanceDenied("Projection identity does not match the bearer")
            if not projection.identity_active or not projection.membership_active:
                raise GovernanceDenied("Projection identity or membership is inactive")
            if identity_audience == "external" and (
                projection.employee_eligible
                or any(item.entitlement_id == "system:akb:employee-baseline" for item in projection.entitlements)
            ):
                raise GovernanceDenied("Employee scope is not valid for this identity")
        except (ValueError, TypeError) as exc:
            raise GovernanceUnavailable("STRATOS access projection is malformed") from exc

        ttl = self.settings.stratos_access_cache_ttl_seconds
        cache_expires_at = min(
            now + ttl,
            token_expires_at or now + ttl,
            projection.expires_at.timestamp() if projection.expires_at else now,
        )
        if self.settings.identity_mode != "managed" and ttl > 0 and cache_expires_at > now:
            with self._lock:
                self._cache[cache_key] = (cache_expires_at, projection)
        return projection

    def ensure_binding_registered(self, binding: InformationPolicyBinding) -> str:
        local_hash = canonical_policy_hash(binding)
        if self.settings.auth_mode == "mock":
            return local_hash
        url = self.settings.stratos_policy_bindings_url
        token = self.settings.stratos_policy_service_token
        if not url or not token:
            raise GovernanceUnavailable("STRATOS Policy Registry is not configured")
        policy_value = binding.model_dump(mode="json", by_alias=True, exclude_none=False)
        response = self._request(
            "POST",
            url,
            token,
            {
                "applicationId": "akb",
                **canonical_policy_payload(binding),
                "originatorId": policy_value["originatorId"],
                "issuedAt": policy_value["issuedAt"],
                "reviewAt": policy_value["reviewAt"],
            },
        )
        expected = {
            "schemaVersion": "stratos-information-policy-2",
            "organizationId": "org_stratos",
            "applicationId": "akb",
            **canonical_policy_payload(binding),
            "policyHash": local_hash,
        }
        if any(response.get(key) != value for key, value in expected.items()):
            raise GovernanceUnavailable("STRATOS Policy Registry returned a conflicting binding")
        if not _authoritative_policy_metadata_matches(response, binding):
            raise GovernanceUnavailable(
                "STRATOS Policy Registry returned conflicting authoritative policy metadata"
            )
        return local_hash

    def decide(
        self,
        *,
        capability_id: str,
        operation: str,
        scope: dict[str, str],
        policy_binding: dict[str, Any] | None,
        policy_hash: str | None,
        credential_token: str | None = None,
    ) -> dict[str, Any]:
        url = self.settings.stratos_policy_decisions_url
        token = credential_token or self.settings.stratos_policy_service_token
        if not url or not token:
            raise GovernanceUnavailable("STRATOS policy decision endpoint is not configured")
        body = {
            "applicationId": "akb",
            "capabilityId": capability_id,
            "operation": operation,
            "scope": scope,
            "policyBinding": policy_binding,
            "policyHash": policy_hash,
        }
        decision_key = sha256(
            json.dumps(
                {
                    "url": url,
                    "tokenHash": sha256(token.encode("utf-8")).hexdigest(),
                    "body": body,
                },
                sort_keys=True,
                separators=(",", ":"),
                default=str,
            ).encode("utf-8")
        ).hexdigest()
        decisions = _request_decisions.get()
        if decisions is not None and decision_key in decisions:
            return decisions[decision_key]
        with self._lock:
            flight = self._decision_flights.get(decision_key)
            owns_flight = flight is None
            if flight is None:
                flight = Future()
                self._decision_flights[decision_key] = flight

        if not owns_flight:
            try:
                return flight.result(timeout=self.settings.stratos_access_timeout_seconds + 1)
            except FutureTimeoutError as exc:
                raise GovernanceUnavailable(
                    "STRATOS policy decision did not complete within the configured timeout"
                ) from exc

        try:
            response = self._request("POST", url, token, body)
            if decisions is not None and len(decisions) < 4096:
                decisions[decision_key] = response
            flight.set_result(response)
            return response
        except BaseException as exc:
            flight.set_exception(exc)
            raise
        finally:
            with self._lock:
                if self._decision_flights.get(decision_key) is flight:
                    self._decision_flights.pop(decision_key, None)

    def service_policy_binding(self) -> tuple[dict[str, Any], str]:
        binding_id = self.settings.stratos_service_policy_binding_id
        url = self.settings.stratos_policy_bindings_url
        token = self.settings.stratos_policy_service_token
        if not binding_id or not url or not token:
            raise GovernanceUnavailable("STRATOS service policy binding is not configured")
        response = self._get(f"{url.rstrip('/')}/{quote(binding_id, safe='')}", token)
        if (
            response.get("applicationId") != "akb"
            or response.get("organizationId") != "org_stratos"
            or response.get("policyBindingId") != binding_id
        ):
            raise GovernanceUnavailable("STRATOS returned a conflicting service policy binding")
        binding_keys = {
            "schemaVersion",
            "policyBindingId",
            "policyVersion",
            "handlingClass",
            "legalClassification",
            "tlp",
            "pap",
            "contentCategories",
            "audience",
            "obligations",
            "originatorId",
            "issuedAt",
            "reviewAt",
        }
        try:
            binding = InformationPolicyBinding.model_validate(
                {key: value for key, value in response.items() if key in binding_keys}
            )
        except ValidationError as exc:
            raise GovernanceUnavailable("STRATOS service policy binding is malformed") from exc
        policy_hash = canonical_policy_hash(binding)
        if response.get("policyHash") != policy_hash:
            raise GovernanceUnavailable("STRATOS service policy binding hash is invalid")
        if (
            binding.handling_class != "INTERNAL"
            or binding.audience.scope_type != "organization"
            or binding.audience.scope_ids
            or binding.audience.recipient_subject_ids
            or "AUDIT_ACCESS" not in binding.obligations
            or "NO_PUBLIC_EXPORT" not in binding.obligations
        ):
            raise GovernanceUnavailable("STRATOS service policy binding is not internal audit policy")
        return binding.model_dump(mode="json", by_alias=True, exclude_none=False), policy_hash

    def register_information_resource(
        self,
        *,
        credential_token: str,
        audit_actor_subject_id: str | None,
        resource_type: str,
        resource_id: str,
        source_version: str,
        title: str,
        scope: dict[str, str],
        binding: InformationPolicyBinding,
        parent_resource_id: str | None,
        reason: str,
        metadata: dict[str, Any] | None = None,
        document_admission: DocumentAdmissionExpectation | None = None,
    ) -> GovernedResourceRegistration:
        base_url = self.settings.stratos_information_resources_url
        if not base_url:
            raise GovernanceUnavailable("STRATOS governed information resource endpoint is not configured")
        body: dict[str, Any] = {
            "sourceVersion": source_version,
            "title": title,
            "scope": scope,
            "policyBindingId": binding.policy_binding_id,
            "policyHash": canonical_policy_hash(binding),
            "reason": reason,
            "metadata": metadata or {},
        }
        if parent_resource_id:
            body["parentId"] = parent_resource_id
        if audit_actor_subject_id:
            body["metadata"] = {**body["metadata"], "auditActorSubjectId": audit_actor_subject_id}
        if document_admission is not None and not has_explicit_document_tlp(binding):
            raise ValueError("Document admission requires an explicit effective TLP")
        if document_admission is not None:
            validate_profile_policy(document_admission.root_snapshot.profile, binding)
        prepared_admission = prepare_document_admission(
            document_admission, resource_type=resource_type, resource_id=resource_id,
            source_version=source_version, policy_binding_id=binding.policy_binding_id,
            policy_hash=canonical_policy_hash(binding), scope=scope,
            current_root_governed_resource_id=parent_resource_id,
        ) if document_admission is not None else None
        if prepared_admission is not None:
            body["documentAdmission"] = prepared_admission.request
        response = self._request(
            "PUT",
            (
                f"{base_url.rstrip('/')}/akb/"
                f"{quote(resource_type, safe='')}/{quote(resource_id, safe='')}"
            ),
            credential_token,
            body,
            extra_headers={"X-Correlation-ID": document_admission.correlation_id} if document_admission is not None else None,
        )
        effective_policy = response.get("effectivePolicy")
        expected_hash = canonical_policy_hash(binding)
        if (
            response.get("application") != "AKB"
            or response.get("resourceType") != resource_type
            or response.get("resourceId") != resource_id
            or response.get("sourceVersion") != source_version
            or response.get("parentId") != parent_resource_id
            or response.get("scope") != scope
            or not isinstance(response.get("id"), str)
            or response.get("policyAssignment") != "EXPLICIT"
            or response.get("explicitPolicyBindingId") != binding.policy_binding_id
            or not isinstance(response.get("confirmedBySubjectId"), str)
            or not response.get("confirmedBySubjectId")
            or not isinstance(effective_policy, dict)
            or effective_policy.get("policyBindingId") != binding.policy_binding_id
            or effective_policy.get("policyHash") != expected_hash
            or not _authoritative_policy_metadata_matches(effective_policy, binding)
        ):
            raise GovernanceUnavailable("STRATOS returned a conflicting governed resource")
        admission_confirmation = self._verify_document_admission_response(response, prepared_admission)
        return GovernedResourceRegistration(
            resource_id=response["id"],
            source_version=source_version,
            policy_binding_id=binding.policy_binding_id,
            policy_hash=expected_hash,
            document_admission=admission_confirmation,
            admission_request=prepared_admission,
        )


    def register_budget_akb_resource(
        self,
        *,
        resource_type: Literal["document", "document-version"],
        resource_id: str,
        source_version: str,
        title: str,
        parent_id: str,
        inherited_from_resource_id: str,
        scope: dict[str, str],
        envelope: IntegrationEnvelope,
        binding: InformationPolicyBinding,
        reason: str,
        document_admission: DocumentAdmissionExpectation | None = None,
    ) -> BudgetAkbGovernedResourceRegistration:
        base_url = self.settings.stratos_budget_akb_resources_url
        credential = self.settings.stratos_policy_service_token
        if not base_url or not credential:
            raise GovernanceUnavailable(
                "The dedicated Budget to AKB governance route is not configured"
            )
        integration_envelope = envelope.model_dump(
            mode="json", by_alias=True, exclude_none=True
        )
        classification = integration_envelope.get("classification")
        if not isinstance(classification, dict):
            raise GovernanceInvalidResponse(
                "Budget integration envelope has no canonical classification"
            )
        classification["tlp"] = envelope.classification.tlp
        classification["pap"] = envelope.classification.pap
        if document_admission is not None and document_admission.correlation_id != envelope.correlation_id:
            raise ValueError("Document admission must preserve the Budget correlation id")
        if document_admission is not None:
            provenance = document_admission.root_snapshot.provenance
            version_snapshot = document_admission.version_snapshot
            if (not has_explicit_document_tlp(binding)
                or provenance.source_system != envelope.source_system
                or provenance.source_record_id != envelope.payload.get("contractId")
                or provenance.source_governed_resource_id != inherited_from_resource_id
                or (version_snapshot is not None and (
                    version_snapshot.source_lineage.source_version != envelope.payload.get("fileHash")
                    or version_snapshot.source_lineage.content_sha256 != envelope.payload.get("fileHash")
                ))):
                raise ValueError("Document admission must preserve the verified Budget source lineage and TLP")
        if document_admission is not None:
            validate_profile_policy(document_admission.root_snapshot.profile, binding)
        prepared_admission = prepare_document_admission(
            document_admission, resource_type=resource_type, resource_id=resource_id,
            source_version=source_version, policy_binding_id=binding.policy_binding_id,
            policy_hash=envelope.policy_hash, scope=scope,
            current_root_governed_resource_id=parent_id,
        ) if document_admission is not None else None
        response = self._request(
            "PUT",
            (
                f"{base_url.rstrip('/')}/{quote(resource_type, safe='')}/"
                f"{quote(resource_id, safe='')}"
            ),
            credential,
            {
                "sourceVersion": source_version,
                "title": title,
                "parentId": parent_id,
                "scope": scope,
                "integrationEnvelope": integration_envelope,
                "reason": reason,
                **({"documentAdmission": prepared_admission.request} if prepared_admission is not None else {}),
            },
            extra_headers={
                "Idempotency-Key": envelope.idempotency_key,
                "X-Correlation-ID": envelope.correlation_id,
            },
        )
        effective_policy = response.get("effectivePolicy")
        if (
            response.get("application") != "AKB"
            or response.get("resourceType") != resource_type
            or response.get("resourceId") != resource_id
            or response.get("sourceVersion") != source_version
            or response.get("parentId") != parent_id
            or response.get("scope") != scope
            or response.get("isActive") is not True
            or not isinstance(response.get("id"), str)
            or not response.get("id")
            or response.get("policyAssignment") != "INHERITED"
            or response.get("explicitPolicyBindingId") is not None
            or response.get("inheritedFromResourceId") != inherited_from_resource_id
            or not isinstance(effective_policy, dict)
            or effective_policy.get("policyBindingId") != binding.policy_binding_id
            or effective_policy.get("policyVersion") != binding.policy_version
            or effective_policy.get("policyHash") != envelope.policy_hash
            or not _authoritative_policy_metadata_matches(effective_policy, binding)
            or response.get("registeredBySubjectId") != "service:akb"
            or response.get("confirmedBySubjectId") != "service:akb"
            or response.get("correlation_id") != envelope.correlation_id
            or response.get("idempotency_key") != envelope.idempotency_key
        ):
            raise GovernanceInvalidResponse(
                "STRATOS returned a conflicting Budget-derived AKB governed resource"
            )
        admission_confirmation = self._verify_document_admission_response(response, prepared_admission)
        return BudgetAkbGovernedResourceRegistration(
            governed_resource_id=response["id"],
            resource_type=resource_type,
            resource_id=resource_id,
            source_version=source_version,
            parent_id=parent_id,
            scope=scope,
            inherited_from_resource_id=inherited_from_resource_id,
            policy_binding_id=binding.policy_binding_id,
            policy_version=binding.policy_version,
            policy_hash=envelope.policy_hash,
            registered_by_subject_id="service:akb",
            confirmed_by_subject_id="service:akb",
            correlation_id=envelope.correlation_id,
            idempotency_key=envelope.idempotency_key,
            confirmation=dict(response),
            document_admission=admission_confirmation,
            admission_request=prepared_admission,
        )

    def document_admission_readiness(self, *, correlation_id: str):
        """Nonce-bound support decision; does not register any document or resource."""
        from app.document_admission_readiness import prepare_admission_readiness, verify_admission_readiness
        base = self.settings.stratos_information_resources_url
        credential = self.settings.stratos_policy_service_token
        if not base or not credential:
            raise GovernanceUnavailable("Document admission readiness is unavailable")
        request = prepare_admission_readiness(correlation_id)
        response = self._request("POST", f"{base.rstrip('/')}/akb/document-admission/readiness", credential,
            request.model_dump(mode="json", by_alias=True), extra_headers={"X-Correlation-ID": correlation_id})
        try:
            return verify_admission_readiness(response, request)
        except ValueError as exc:
            raise GovernanceInvalidResponse("STRATOS admission readiness is missing, stale or conflicting") from exc

    def revalidate_document_admission(
        self, *, document_admission: DocumentAdmissionExpectation,
        resource_type: str, resource_id: str, source_version: str,
        governed_resource_id: str, current_root_governed_resource_id: str,
        binding: InformationPolicyBinding, scope: dict[str, str], audit_actor_subject_id: str,
    ) -> DocumentAdmissionConfirmation:
        """Required STRATOS resource extension; unsupported upstream fails closed.

        This operation decides against existing resources and never registers or
        restores one. The endpoint is a proposed coordinated contract, not a
        claimed capability of the currently deployed STRATOS implementation.
        """
        base = self.settings.stratos_information_resources_url
        credential = self.settings.stratos_policy_service_token
        if not base or not credential or not has_explicit_document_tlp(binding):
            raise GovernanceUnavailable("Atomic document admission revalidation is unavailable")
        validate_profile_policy(document_admission.root_snapshot.profile, binding)
        prepared = prepare_document_admission(
            document_admission, resource_type=resource_type, resource_id=resource_id,
            source_version=source_version, policy_binding_id=binding.policy_binding_id,
            policy_hash=canonical_policy_hash(binding), scope=scope,
            current_root_governed_resource_id=current_root_governed_resource_id, operation="revalidate",
        )
        response = self._request("POST",
            f"{base.rstrip('/')}/akb/{quote(resource_type, safe='')}/{quote(resource_id, safe='')}/document-admission/decisions",
            credential, {
                "sourceVersion": source_version, "governedResourceId": governed_resource_id,
                "currentRootGovernedResourceId": current_root_governed_resource_id,
                "policyBindingId": binding.policy_binding_id, "policyHash": canonical_policy_hash(binding),
                "scope": scope, "auditActorSubjectId": audit_actor_subject_id,
                "documentAdmission": prepared.request,
            }, extra_headers={"X-Correlation-ID": document_admission.correlation_id})
        if response.get("id") != governed_resource_id:
            raise GovernanceInvalidResponse("The revalidation target differs from the exact stored resource")
        return self._verify_document_admission_response(response, prepared)

    @staticmethod
    def _verify_document_admission_response(response, prepared_admission):
        if prepared_admission is None:
            return None  # This profile contract has not yet been requested by a caller.
        try:
            if response.get("isActive") is not True or response.get("confirmedBySubjectId") != "service:akb":
                raise ValueError("Strict document admission requires active canonical governance")
            return verify_document_admission_confirmation(
                response.get("documentAdmission"), prepared=prepared_admission,
                governed_resource_id=response["id"],
            )
        except (ValueError, KeyError) as exc:
            raise GovernanceInvalidResponse(
                "STRATOS document admission confirmation is missing, stale or conflicting"
            ) from exc

    def upsert_information_publication(
        self,
        *,
        credential_token: str,
        resource_type: str,
        resource_id: str,
        source_version: str,
        scope: dict[str, str],
        policy_binding_id: str,
        policy_hash: str,
        public_slug: str,
        status: str,
        reason: str,
    ) -> InformationPublicationRegistration:
        base_url = self.settings.stratos_information_publications_url
        if not base_url:
            raise GovernanceUnavailable("STRATOS information publication endpoint is not configured")
        body: dict[str, Any] = {
            "sourceVersion": source_version,
            "status": status,
            "reason": reason,
        }
        if status != "REVOKED":
            body.update(
                {
                    "scope": scope,
                    "policyBindingId": policy_binding_id,
                    "policyHash": policy_hash,
                    "publicSlug": public_slug,
                }
            )
        response = self._request(
            "PUT",
            (
                f"{base_url.rstrip('/')}/akb/"
                f"{quote(resource_type, safe='')}/{quote(resource_id, safe='')}"
            ),
            credential_token,
            body,
        )
        expected_status = status
        if (
            not isinstance(response.get("id"), str)
            or response.get("application") != "AKB"
            or response.get("resourceType") != resource_type
            or response.get("resourceId") != resource_id
            or response.get("sourceVersion") != source_version
            or not isinstance(response.get("governedResourceId"), str)
            or response.get("policyBindingId") != policy_binding_id
            or response.get("policyHash") != policy_hash
            or response.get("publicSlug") != public_slug
            or response.get("status") != expected_status
            or (status == "PUBLISHED" and not isinstance(response.get("publishedAt"), str))
            or (status == "REVOKED" and not _is_timestamp(response.get("revokedAt")))
        ):
            raise GovernanceUnavailable("STRATOS returned a conflicting information publication")
        return InformationPublicationRegistration(
            publication_id=response["id"],
            governed_resource_id=response["governedResourceId"],
            resource_type=resource_type,
            resource_id=resource_id,
            source_version=source_version,
            public_slug=public_slug,
            policy_binding_id=policy_binding_id,
            policy_hash=policy_hash,
            status=expected_status,
            published_at=response.get("publishedAt"),
            revoked_at=response.get("revokedAt"),
        )

    def public_decide(self, *, public_slug: str, operation: str) -> dict[str, Any]:
        url = self.settings.stratos_public_decisions_url
        if not url:
            raise GovernanceUnavailable("STRATOS public policy decision endpoint is not configured")
        return validate_public_decision_response(
            self._anonymous_request(
                "POST",
                url,
                {"publicSlug": public_slug, "operation": operation},
            )
        )

    def _request(
        self,
        method: str,
        url: str,
        token: str,
        body: dict[str, Any],
        *,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            **(extra_headers or {}),
        }
        headers["Authorization"] = f"Bearer {token}"
        try:
            response = self._http_client.request(
                method,
                url,
                headers=headers,
                json=body,
            )
        except httpx.HTTPError as exc:
            raise GovernanceUnavailable("STRATOS access governance is unavailable") from exc
        if response.status_code in {401, 403}:
            upstream_code = "unknown"
            try:
                response_body = response.json()
                if isinstance(response_body, dict):
                    candidate = response_body.get("code") or response_body.get("message")
                    if isinstance(candidate, str) and candidate.replace("_", "").isalnum():
                        upstream_code = candidate[:120]
            except ValueError:
                pass
            logger.warning(
                "stratos_governance_denied status=%s code=%s correlation_id=%s",
                response.status_code,
                upstream_code,
                (extra_headers or {}).get("X-Correlation-ID", "missing"),
            )
            raise GovernanceDenied(
                "STRATOS access governance rejected the runtime credential",
                upstream_code=upstream_code,
            )
        if response.status_code >= 400:
            raise GovernanceUnavailable(
                f"STRATOS access governance returned {response.status_code}"
            )
        try:
            value = response.json()
        except ValueError as exc:
            raise GovernanceUnavailable("STRATOS access governance returned invalid JSON") from exc
        if not isinstance(value, dict):
            raise GovernanceUnavailable("STRATOS access governance returned an invalid response")
        return value

    def _get(self, url: str, token: str) -> dict[str, Any]:
        try:
            response = self._http_client.get(
                url,
                headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
            )
        except httpx.HTTPError as exc:
            raise GovernanceUnavailable("STRATOS access governance is unavailable") from exc
        if response.status_code in {401, 403}:
            raise GovernanceDenied("STRATOS access governance rejected the runtime credential")
        if response.status_code >= 400:
            raise GovernanceUnavailable(
                f"STRATOS access governance returned {response.status_code}"
            )
        try:
            value = response.json()
        except ValueError as exc:
            raise GovernanceUnavailable("STRATOS access governance returned invalid JSON") from exc
        if not isinstance(value, dict):
            raise GovernanceUnavailable("STRATOS access governance returned an invalid response")
        return value

    def _anonymous_request(self, method: str, url: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self._http_client.request(
                method,
                url,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                json=body,
            )
        except httpx.HTTPError as exc:
            raise GovernanceUnavailable("STRATOS public access governance is unavailable") from exc
        if response.status_code >= 400:
            raise GovernanceUnavailable(
                f"STRATOS public access governance returned {response.status_code}"
            )
        try:
            value = response.json()
        except ValueError as exc:
            raise GovernanceUnavailable("STRATOS public access governance returned invalid JSON") from exc
        if not isinstance(value, dict):
            raise GovernanceUnavailable("STRATOS public access governance returned an invalid response")
        return value

    @staticmethod
    def _parse_projection(
        body: Any, *, now: datetime | None = None,
    ) -> AccessProjection:
        projection = ActiveAccessProjectionV2.model_validate(body)
        evaluated_at = now or datetime.now(timezone.utc)
        if evaluated_at.tzinfo is None:
            evaluated_at = evaluated_at.replace(tzinfo=timezone.utc)
        generated_at = _aware_utc(projection.generated_at)
        expires_at = _aware_utc(projection.expires_at)
        if (
            generated_at > evaluated_at
            or expires_at <= evaluated_at
            or expires_at <= generated_at
            or (expires_at - generated_at).total_seconds()
            > ACCESS_PROJECTION_V2_MAX_TTL_SECONDS
        ):
            raise ValueError("projection validity window is invalid")
        membership_valid_until = (
            _aware_utc(projection.membership.valid_until)
            if projection.membership.valid_until is not None
            else None
        )
        membership_active = projection.membership.active and (
            membership_valid_until is None or membership_valid_until > evaluated_at
        )
        akb_access = next(
            (
                item for item in projection.application_access
                if item.application_id == "akb"
            ),
            None,
        )
        if akb_access is not None:
            entitlement_ids = [item.entitlement_id for item in akb_access.entitlements]
            if len(entitlement_ids) != len(set(entitlement_ids)):
                raise ValueError("entitlement ids must be unique")
        entitlements: list[AccessEntitlement] = []
        for item in akb_access.entitlements if akb_access is not None else []:
            valid_from = _aware_utc(item.valid_from) if item.valid_from else None
            valid_until = _aware_utc(item.valid_until) if item.valid_until else None
            if item.definition_version != ACCESS_PROJECTION_V2_CATALOG:
                raise ValueError("entitlement catalog version is invalid")
            if item.valid_from is not None and valid_from is None:
                raise ValueError("entitlement validity boundary is invalid")
            if not item.virtual and valid_from is None:
                raise ValueError("persisted entitlement requires validFrom")
            if valid_from and valid_until and valid_until <= valid_from:
                raise ValueError("entitlement validity window is invalid")
            if (valid_from and valid_from > evaluated_at) or (
                valid_until and valid_until <= evaluated_at
            ):
                continue
            entitlement = AccessEntitlement(
                entitlement_id=item.entitlement_id,
                definition_version=item.definition_version,
                profile_id=item.profile_id,
                source=item.source,
                source_ref=item.source_ref,
                virtual=item.virtual,
                capabilities=frozenset(item.capabilities),
                scopes=frozenset(_projection_scope_key(scope) for scope in item.scopes),
                effective_scopes=frozenset(
                    _projection_scope_key(scope) for scope in item.effective_scopes
                ),
                valid_from=valid_from,
                valid_until=valid_until,
            )
            if entitlement.virtual and not _valid_employee_baseline(
                entitlement, projection
            ):
                raise ValueError("virtual entitlement is invalid")
            entitlements.append(entitlement)
        active = bool(
            projection.identity.active
            and membership_active
            and entitlements
        )
        effective_entitlements = tuple(entitlements) if active else ()
        return AccessProjection(
            capabilities=frozenset(
                capability
                for entitlement in effective_entitlements
                for capability in entitlement.capabilities
            ),
            scopes=frozenset(
                scope
                for entitlement in effective_entitlements
                for scope in entitlement.effective_scopes
            ),
            organization_id=projection.organization_id,
            identity_active=projection.identity.active,
            membership_active=membership_active,
            application_access_active=active,
            entitlements=effective_entitlements,
            subject_id=projection.identity.subject_id,
            identity_kind=projection.identity.kind,
            employee_eligible=projection.identity.employee_eligible,
            expires_at=expires_at,
        )


_CLIENT_LOCK = threading.Lock()
_CLIENTS: dict[tuple[object, ...], StratosGovernanceClient] = {}


def governance_client(settings: Settings) -> StratosGovernanceClient:
    key = (
        settings.stratos_auth_me_url,
        settings.stratos_policy_bindings_url,
        settings.stratos_policy_decisions_url,
        settings.stratos_service_policy_binding_id,
        settings.stratos_information_resources_url,
        settings.stratos_information_publications_url,
        settings.stratos_public_decisions_url,
        settings.stratos_policy_service_token,
        settings.stratos_access_timeout_seconds,
        settings.stratos_access_cache_ttl_seconds,
        settings.auth_mode,
    )
    with _CLIENT_LOCK:
        return _CLIENTS.setdefault(key, StratosGovernanceClient(settings))


def reset_governance_clients_for_tests() -> None:
    with _CLIENT_LOCK:
        for client in _CLIENTS.values():
            client.close()
        _CLIENTS.clear()


def _aware_utc(value: datetime) -> datetime:
    return (
        value.replace(tzinfo=timezone.utc)
        if value.tzinfo is None
        else value.astimezone(timezone.utc)
    )


def _projection_scope_key(value: ProjectionScope) -> str:
    scope_id = getattr(value, "id", None)
    return f"{value.type}:{scope_id}" if scope_id else value.type


def _valid_employee_baseline(
    entitlement: AccessEntitlement,
    projection: ActiveAccessProjectionV2,
) -> bool:
    expected_scopes = frozenset(
        {
            "public",
            "organization:org_stratos",
            "recipient_set:employee-directives",
        }
    )
    return bool(
        entitlement.entitlement_id == "system:akb:employee-baseline"
        and entitlement.definition_version == ACCESS_PROJECTION_V2_CATALOG
        and entitlement.profile_id == "stratos-user"
        and entitlement.source == "SYSTEM"
        and entitlement.source_ref == "employee-baseline"
        and entitlement.capabilities
        == frozenset({"akb:access", "akb:chat", "akb:read_document"})
        and entitlement.scopes == expected_scopes
        and expected_scopes.issubset(entitlement.effective_scopes)
        and entitlement.valid_from is None
        and entitlement.valid_until is None
        and projection.identity.kind == "person"
        and projection.identity.active
        and projection.identity.employee_eligible
        and projection.membership.active
    )


def _strings(value: Any) -> frozenset[str]:
    if not isinstance(value, list):
        return frozenset()
    return frozenset(item for item in value if isinstance(item, str) and item)


def _scopes(value: Any) -> frozenset[str]:
    if not isinstance(value, list):
        return frozenset()
    result: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("type"), str):
            continue
        scope_id = item.get("id")
        result.add(f"{item['type']}:{scope_id}" if isinstance(scope_id, str) and scope_id else item["type"])
    return frozenset(result)


def _not_expired(value: Any) -> bool:
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed > datetime.now(timezone.utc)


def _is_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None


def _same_timestamp(value: Any, expected: datetime | None) -> bool:
    if expected is None:
        return value is None
    if not isinstance(value, str) or not value:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None and parsed == expected


def _authoritative_policy_metadata_matches(
    value: dict[str, Any],
    binding: InformationPolicyBinding,
) -> bool:
    required = {"originatorId", "originator", "issuedAt", "reviewAt"}
    return bool(
        required.issubset(value)
        and value.get("originatorId") == value.get("originator")
        and value.get("originatorId") == binding.originator_id
        and _same_timestamp(value.get("issuedAt"), binding.issued_at)
        and _same_timestamp(value.get("reviewAt"), binding.review_at)
    )
