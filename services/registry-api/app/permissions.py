from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette import status

from app.auth import Principal
from app.access_governance import (
    GovernanceDenied,
    GovernanceInvalidResponse,
    GovernanceUnavailable,
    governance_client,
)
from app.config import get_settings
from app.errors import problem
from app.information_policy import (
    InformationPolicyBinding,
    POLICY_VERSION,
    anonymous_public_eligible,
    canonical_policy_hash,
)
from app.models import Document, DocumentVersion, RoleMapping
from app.public_documents import PublicDocumentIntegrityError, validate_publication_integrity
from app.schemas import Action, Classification, GovernanceScope


CLASSIFICATION_ORDER = {
    Classification.public.value: 0,
    Classification.internal.value: 1,
    Classification.restricted.value: 2,
    Classification.confidential.value: 3,
}

ROLE_ACTIONS: dict[str, set[str]] = {
    "admin": {"*"},
    "document_manager": {
        Action.document_create.value,
        Action.document_read.value,
        Action.document_update.value,
        Action.document_delete.value,
        Action.document_version_create.value,
        Action.document_version_publish.value,
        Action.document_version_archive.value,
        Action.workflow_task_read.value,
        Action.workflow_task_write.value,
        Action.audit_write.value,
    },
    "document_owner": {
        Action.document_read.value,
        Action.document_update.value,
        Action.document_version_create.value,
        Action.workflow_task_read.value,
        Action.workflow_task_write.value,
    },
    "document_gestor": {
        Action.document_create.value,
        Action.document_read.value,
        Action.document_update.value,
        Action.document_version_create.value,
        Action.document_ingest.value,
        Action.document_reindex.value,
        Action.workflow_task_read.value,
        Action.workflow_task_write.value,
    },
    "reviewer": {
        Action.document_read.value,
        Action.document_version_publish.value,
        Action.workflow_task_read.value,
        Action.workflow_task_write.value,
    },
    "reader": {
        Action.document_read.value,
        Action.rag_query.value,
    },
    "auditor": {
        Action.workflow_task_read.value,
        Action.workflow_task_write.value,
        Action.audit_read.value,
        Action.audit_write.value,
    },
    "service_ingestion": {
        Action.document_read.value,
        Action.document_ingest.value,
        Action.document_reindex.value,
        Action.audit_write.value,
    },
    "service_rag": {
        Action.document_read.value,
        Action.rag_query.value,
        Action.rag_compare.value,
        Action.rag_check_compliance.value,
        Action.audit_write.value,
    },
    "service_llm_gateway": {
        Action.audit_write.value,
    },
    "service_evaluation": {
        Action.document_read.value,
        Action.rag_query.value,
        Action.audit_write.value,
    },
    "service_governance": {
        Action.document_read.value,
        Action.rag_check_compliance.value,
        Action.workflow_task_read.value,
        Action.workflow_task_write.value,
        Action.audit_write.value,
    },
    "service_aiip": {
        Action.document_read.value,
        Action.rag_query.value,
        Action.audit_write.value,
    },
    "stratos_service": {
        Action.document_create.value,
        Action.document_read.value,
        Action.document_update.value,
        Action.document_version_create.value,
        Action.document_ingest.value,
        Action.document_reindex.value,
        Action.rag_query.value,
        Action.audit_write.value,
    },
}

ROLE_MAX_CLASSIFICATION = {
    "admin": Classification.confidential.value,
    "document_manager": Classification.confidential.value,
    "document_owner": Classification.confidential.value,
    "document_gestor": Classification.restricted.value,
    "reviewer": Classification.restricted.value,
    "reader": Classification.internal.value,
    "auditor": Classification.confidential.value,
    "service_ingestion": Classification.confidential.value,
    "service_rag": Classification.confidential.value,
    "service_llm_gateway": Classification.public.value,
    "service_evaluation": Classification.restricted.value,
    "service_governance": Classification.confidential.value,
    "service_aiip": Classification.internal.value,
    "stratos_service": Classification.confidential.value,
}

OWNER_ACTIONS = {
    Action.document_read.value,
    Action.document_update.value,
    Action.document_version_create.value,
    Action.rag_query.value,
}

ACTION_CAPABILITIES: dict[str, set[str]] = {
    Action.document_create.value: {"akb:upload"},
    Action.document_read.value: {"akb:read_document"},
    Action.document_update.value: {"akb:manage_document"},
    Action.document_delete.value: {"akb:manage_document"},
    Action.document_version_create.value: {"akb:upload", "akb:manage_document"},
    Action.document_version_publish.value: {"akb:manage_document"},
    Action.document_version_archive.value: {"akb:manage_document"},
    Action.document_ingest.value: {"akb:manage_document"},
    Action.document_reindex.value: {"akb:manage_document"},
    Action.rag_query.value: {"akb:chat"},
    Action.rag_compare.value: {"akb:chat"},
    Action.rag_check_compliance.value: {"akb:chat", "akb:manage_document"},
    Action.rag_export.value: {"akb:export"},
    Action.workflow_task_read.value: {"akb:read_document", "akb:manage_document"},
    Action.workflow_task_write.value: {"akb:manage_document"},
    Action.audit_read.value: {"akb:read_audit"},
    Action.audit_write.value: {"akb:manage_document", "akb:read_audit"},
    Action.admin_manage.value: {"akb:manage_access"},
}


@dataclass(frozen=True)
class SubjectContext:
    subject_id: str
    roles: set[str]
    groups: set[str]
    capabilities: set[str]
    scopes: set[str]
    organization_id: str
    identity_active: bool
    membership_active: bool
    application_access_active: bool
    access_v2: bool

    @property
    def refs(self) -> set[str]:
        refs = {self.subject_id, f"user:{self.subject_id}", f"service:{self.subject_id}"}
        refs.update({f"role:{role}" for role in self.roles})
        refs.update({f"group:{group}" for group in self.groups})
        return refs


@dataclass(frozen=True)
class Decision:
    allowed: bool
    reason: str
    constraints: dict[str, Any]
    reason_codes: tuple[str, ...] = ()


@dataclass(frozen=True)
class DocumentVersionAuthority:
    organization_id: str
    governed_resource_id: str
    governed_source_version: str
    governed_parent_resource_id: str | None
    policy_binding_id: str
    policy_version: str
    policy_hash: str
    governance_scope: dict[str, str]
    governance_scope_hash: str
    policy_binding: InformationPolicyBinding


def max_classification_for_roles(roles: set[str]) -> str:
    max_rank = 0
    max_name = Classification.public.value
    for role in roles:
        name = ROLE_MAX_CLASSIFICATION.get(role)
        if name is None:
            continue
        rank = CLASSIFICATION_ORDER[name]
        if rank > max_rank:
            max_rank = rank
            max_name = name
    return max_name


def classification_allows(max_classification: str, actual_classification: str) -> bool:
    return CLASSIFICATION_ORDER[actual_classification] <= CLASSIFICATION_ORDER[max_classification]


def roles_grant_action(roles: set[str], action: str) -> bool:
    for role in roles:
        actions = ROLE_ACTIONS.get(role, set())
        if "*" in actions or action in actions:
            return True
    return False


def context_for_subject(
    db: Session,
    subject_id: str,
    roles: list[str] | set[str] | None,
    groups: list[str] | set[str] | None,
    *,
    capabilities: list[str] | set[str] | None = None,
    scopes: list[str] | set[str] | None = None,
    organization_id: str = "org_stratos",
    identity_active: bool = True,
    membership_active: bool = True,
    application_access_active: bool = True,
) -> SubjectContext:
    collected_roles = set(roles or [])
    collected_groups = set(groups or [])

    direct_role_rows = db.execute(
        select(RoleMapping).where(
            RoleMapping.subject_type.in_(["user", "service"]),
            RoleMapping.subject_id == subject_id,
            RoleMapping.status == "active",
        )
    ).scalars()
    collected_roles.update(row.role for row in direct_role_rows)

    if collected_groups:
        group_role_rows = db.execute(
            select(RoleMapping).where(
                RoleMapping.subject_type == "group",
                RoleMapping.subject_id.in_(collected_groups),
                RoleMapping.status == "active",
            )
        ).scalars()
        collected_roles.update(row.role for row in group_role_rows)

    collected_capabilities = set(capabilities or [])
    return SubjectContext(
        subject_id=subject_id,
        roles=collected_roles,
        groups=collected_groups,
        capabilities=collected_capabilities,
        scopes=set(scopes or []),
        organization_id=organization_id,
        identity_active=identity_active,
        membership_active=membership_active,
        application_access_active=application_access_active,
        access_v2=bool(
            collected_capabilities
            or {"stratos_user", "stratos_admin"}.intersection(collected_roles)
        ),
    )


def context_for_principal(principal: Principal, db: Session | None = None) -> SubjectContext:
    if principal.dynamic_access_loaded or principal.service_identity:
        return SubjectContext(
            subject_id=principal.subject_id,
            roles=set(principal.roles),
            groups=set(principal.groups),
            capabilities=set(principal.capabilities),
            scopes=set(principal.scopes),
            organization_id=principal.organization_id,
            identity_active=principal.identity_active,
            membership_active=principal.membership_active,
            application_access_active=principal.application_access_active,
            access_v2=True,
        )
    if db is not None:
        return context_for_subject(
            db,
            principal.subject_id,
            principal.roles,
            principal.groups,
            capabilities=principal.capabilities,
            scopes=principal.scopes,
            organization_id=principal.organization_id,
            identity_active=principal.identity_active,
            membership_active=principal.membership_active,
            application_access_active=principal.application_access_active,
        )

    return SubjectContext(
        subject_id=principal.subject_id,
        roles=set(principal.roles),
        groups=set(principal.groups),
        capabilities=set(principal.capabilities),
        scopes=set(principal.scopes),
        organization_id=principal.organization_id,
        identity_active=principal.identity_active,
        membership_active=principal.membership_active,
        application_access_active=principal.application_access_active,
        access_v2=principal.access_v2,
    )


def active_true_public_version_ids(
    document: Document,
    binding: InformationPolicyBinding | None = None,
) -> frozenset[str]:
    if binding is None:
        try:
            binding = InformationPolicyBinding.model_validate(document.policy_summary)
        except ValueError:
            return frozenset()
    expected_hash = canonical_policy_hash(binding)
    if (
        not anonymous_public_eligible(binding)
        or document.policy_binding_id != binding.policy_binding_id
        or document.policy_version != binding.policy_version
        or document.policy_hash != expected_hash
    ):
        return frozenset()
    versions = {version.document_version_id: version for version in document.versions}
    active: set[str] = set()
    for publication in document.publications:
        version = versions.get(publication.document_version_id)
        if (
            publication.status != "PUBLISHED"
            or publication.revoked_at is not None
            or publication.published_at is None
            or not publication.central_publication_id
            or publication.policy_binding_id != binding.policy_binding_id
            or publication.policy_version != binding.policy_version
            or publication.policy_hash != expected_hash
            or version is None
        ):
            continue
        try:
            validate_publication_integrity(publication, document, version)
        except PublicDocumentIntegrityError:
            continue
        active.add(version.document_version_id)
    return frozenset(active)


def centrally_allowed_true_public_version_ids(
    document: Document,
    binding: InformationPolicyBinding | None = None,
) -> frozenset[str]:
    local_version_ids = active_true_public_version_ids(document, binding)
    if not local_version_ids:
        return frozenset()
    allowed: set[str] = set()
    client = governance_client(get_settings())
    for publication in document.publications:
        if publication.document_version_id not in local_version_ids:
            continue
        try:
            decision = client.public_decide(
                public_slug=publication.public_slug,
                operation="public_read",
            )
        except (GovernanceDenied, GovernanceInvalidResponse, GovernanceUnavailable) as exc:
            raise problem(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "public_policy_decision_unavailable",
                "Fresh public policy verification is unavailable",
            ) from exc
        central_publication = decision.get("publication")
        expected = {
            "id": publication.central_publication_id,
            "application": "AKB",
            "resourceType": "document_version",
            "resourceId": publication.document_version_id,
            "sourceVersion": publication.source_version,
            "publicSlug": publication.public_slug,
            "policyBindingId": publication.policy_binding_id,
            "policyHash": publication.policy_hash,
        }
        if (
            decision.get("decision") == "ALLOW"
            and decision.get("policyVersion") == publication.policy_version
            and isinstance(central_publication, dict)
            and all(central_publication.get(key) == value for key, value in expected.items())
            and isinstance(central_publication.get("publishedAt"), str)
        ):
            allowed.add(publication.document_version_id)
    return frozenset(allowed)


def _v2_base_decision(context: SubjectContext, action: str) -> Decision | None:
    constraints = {
        "organization_id": context.organization_id,
        "capabilities": sorted(context.capabilities),
        "scopes": sorted(context.scopes),
    }
    if not context.identity_active:
        return Decision(False, "Identity is disabled", constraints, ("IDENTITY_DISABLED",))
    if not context.membership_active:
        return Decision(False, "Organization membership is inactive", constraints, ("MEMBERSHIP_INACTIVE",))
    if not context.application_access_active:
        return Decision(False, "AKB application access is inactive", constraints, ("APPLICATION_ACCESS_INACTIVE",))
    if context.organization_id != "org_stratos":
        return Decision(False, "Organization does not match AKB", constraints, ("ORGANIZATION_MISMATCH",))
    required = ACTION_CAPABILITIES.get(action, set())
    if required and not required.intersection(context.capabilities):
        return Decision(False, f"Capability missing for {action}", constraints, ("CAPABILITY_MISSING",))
    return None


def _governance_scope_allows(
    context: SubjectContext,
    resource: Document | DocumentVersion,
) -> bool:
    scope_type = resource.governance_scope_type or "organization"
    if scope_type == "own":
        return bool(
            resource.governance_scope_owner_subject_id
            and resource.governance_scope_owner_subject_id == context.subject_id
            and "own" in context.scopes
        )
    scope_id = resource.governance_scope_id or (
        context.organization_id if scope_type == "organization" else None
    )
    if scope_type == "organization":
        return bool(
            "organization" in context.scopes
            or f"organization:{scope_id}" in context.scopes
        )
    return bool(scope_id and f"{scope_type}:{scope_id}" in context.scopes)


def _policy_audience_allows(
    context: SubjectContext,
    binding: InformationPolicyBinding,
) -> bool:
    audience = binding.audience
    if audience.organization_id != context.organization_id:
        return False
    recipients = set(audience.recipient_subject_ids)
    if recipients and context.subject_id not in recipients:
        return False
    if binding.tlp == "TLP:RED":
        return context.subject_id in recipients
    if audience.scope_type in {"organization", "public"}:
        return True
    if audience.scope_type == "recipient_set":
        if recipients:
            return context.subject_id in recipients
        return any(
            f"recipient_set:{scope_id}" in context.scopes
            for scope_id in audience.scope_ids
        )
    for scope_id in audience.scope_ids:
        if f"{audience.scope_type}:{scope_id}" in context.scopes:
            return True
    return audience.scope_type in context.scopes and not audience.scope_ids


def _scope_allows(
    context: SubjectContext,
    resource: Document | DocumentVersion,
    binding: InformationPolicyBinding,
) -> bool:
    return _governance_scope_allows(context, resource) and _policy_audience_allows(
        context,
        binding,
    )


def _v2_document_decision(context: SubjectContext, action: str, document: Document) -> Decision:
    base = _v2_base_decision(context, action)
    if base is not None:
        return base
    constraints = {
        "organization_id": context.organization_id,
        "policy_binding_id": document.policy_binding_id,
        "policy_version": document.policy_version,
        "policy_hash": document.policy_hash,
        "governance_scope": document_governance_scope(document),
    }
    if not document.policy_binding_id or not document.policy_summary:
        return Decision(False, "Document policy binding is unavailable", constraints, ("POLICY_UNAVAILABLE",))
    if document.policy_version != POLICY_VERSION:
        return Decision(False, "Document policy version is unknown", constraints, ("POLICY_VERSION_UNKNOWN",))
    try:
        binding = InformationPolicyBinding.model_validate(document.policy_summary)
    except ValueError:
        return Decision(False, "Document policy binding is invalid", constraints, ("POLICY_BINDING_INVALID",))
    scoped_access = _scope_allows(context, document, binding)
    if not scoped_access and "public" in context.scopes:
        if action != Action.rag_query.value:
            return Decision(
                False,
                "Public-only access is available only through the governed RAG/public projection",
                constraints,
                ("PUBLIC_PROJECTION_REQUIRED",),
            )
        public_version_ids = centrally_allowed_true_public_version_ids(document, binding)
        if binding.audience.scope_type != "public" or not public_version_ids:
            return Decision(False, "Document is not actively public", constraints, ("PUBLICATION_INACTIVE",))
        constraints["public_version_ids"] = sorted(public_version_ids)
    elif not scoped_access:
        return Decision(False, "Document audience or scope does not match", constraints, ("SCOPE_MISMATCH",))
    constraints["obligations"] = list(binding.obligations)
    return Decision(True, "Capability, scope and information policy allow access", constraints, ("POLICY_ALLOW",))


def _policy_constraints_allow(
    policy_constraints: dict[str, Any], document: Document, action: str
) -> tuple[bool, str]:
    max_classification = (
        policy_constraints.get("classification_max")
        or policy_constraints.get("max_classification")
        or Classification.confidential.value
    )
    if not classification_allows(str(max_classification), document.classification):
        return False, f"policy classification_max {max_classification} denies {document.classification}"

    if policy_constraints.get("valid_only") is True and document.status != "valid":
        return False, "policy valid_only requires a valid document"

    return True, "policy constraints satisfied"


def evaluate_document_access(context: SubjectContext, action: str, document: Document) -> Decision:
    if context.access_v2:
        return _v2_document_decision(context, action, document)
    constraints = {"max_classification": max_classification_for_roles(context.roles)}

    if "admin" in context.roles:
        return Decision(True, "role admin grants access", constraints)

    if "document_manager" in context.roles and roles_grant_action(context.roles, action):
        return Decision(True, "role document_manager grants access", constraints)

    if document.owner_id == context.subject_id and action in OWNER_ACTIONS:
        return Decision(True, "document owner grants access", constraints)

    if not roles_grant_action(context.roles, action):
        return Decision(False, f"no role grants action {action}", constraints)

    for policy in document.access_policies:
        if action not in policy.actions and "*" not in policy.actions:
            continue
        if "*" not in policy.subjects and not set(policy.subjects).intersection(context.refs):
            continue

        allowed, reason = _policy_constraints_allow(policy.constraints, document, action)
        if allowed:
            return Decision(True, f"access policy {policy.policy_id} grants access", constraints)
        return Decision(False, reason, constraints)

    return Decision(False, "no document access policy matched", constraints)


def _resource_governance_scope(
    resource: Document | DocumentVersion,
) -> dict[str, str]:
    scope = {"type": resource.governance_scope_type or "organization"}
    if resource.governance_scope_id:
        scope["id"] = resource.governance_scope_id
    elif resource.governance_scope_owner_subject_id:
        scope["ownerSubjectId"] = resource.governance_scope_owner_subject_id
    elif scope["type"] == "organization":
        scope["id"] = "org_stratos"
    return scope


def document_governance_scope(document: Document) -> dict[str, str]:
    return _resource_governance_scope(document)


def document_version_governance_scope(version: DocumentVersion) -> dict[str, str]:
    return _resource_governance_scope(version)


def resolve_document_version_authority(
    document: Document,
    version: DocumentVersion,
) -> DocumentVersionAuthority:
    settings = get_settings()
    mock_registration = (
        settings.auth_mode == "mock"
        and version.governance_registration_status == "MOCK_BYPASSED"
    )
    if version.document_id != document.document_id:
        raise ValueError("The document version belongs to another document")
    if (
        document.organization_id != "org_stratos"
        or version.organization_id != document.organization_id
    ):
        raise ValueError("The document version organization lineage is invalid")
    if not version.policy_summary:
        raise ValueError("The document version policy binding is unavailable")
    try:
        binding = InformationPolicyBinding.model_validate(version.policy_summary)
    except ValueError as exc:
        raise ValueError("The document version policy binding is invalid") from exc
    expected_hash = canonical_policy_hash(binding)
    if (
        version.policy_binding_id != binding.policy_binding_id
        or version.policy_version != POLICY_VERSION
        or version.policy_version != binding.policy_version
        or version.policy_hash != expected_hash
        or binding.audience.organization_id != version.organization_id
    ):
        raise ValueError("The document version policy lineage is stale or conflicting")

    source_version = version.governed_source_version
    expected_source_versions = {version.document_version_id}
    if version.file_hash:
        expected_source_versions.add(version.file_hash)
    if not source_version or source_version not in expected_source_versions:
        raise ValueError("The document version governed source lineage is invalid")

    if mock_registration:
        governed_resource_id = (
            version.governed_resource_id
            or f"mock:akb:document-version:{version.document_version_id}"
        )
        governed_parent_resource_id = (
            version.governed_parent_resource_id
            or document.governed_resource_id
            or f"mock:akb:document:{document.document_id}"
        )
    else:
        if (
            document.governance_registration_status != "REGISTERED"
            or version.governance_registration_status != "REGISTERED"
            or not document.governed_resource_id
            or not version.governed_resource_id
            or version.governed_parent_resource_id != document.governed_resource_id
        ):
            raise ValueError("The document version governed resource lineage is unavailable")
        governed_resource_id = version.governed_resource_id
        governed_parent_resource_id = version.governed_parent_resource_id

    try:
        scope_model = GovernanceScope.model_validate(
            document_version_governance_scope(version)
        )
    except ValueError as exc:
        raise ValueError("The document version governance scope is invalid") from exc
    scope = scope_model.model_dump(mode="json", by_alias=True, exclude_none=True)
    scope_hash = "sha256:" + sha256(
        json.dumps(
            scope,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    return DocumentVersionAuthority(
        organization_id=version.organization_id,
        governed_resource_id=governed_resource_id,
        governed_source_version=source_version,
        governed_parent_resource_id=governed_parent_resource_id,
        policy_binding_id=binding.policy_binding_id,
        policy_version=binding.policy_version,
        policy_hash=expected_hash,
        governance_scope=scope,
        governance_scope_hash=scope_hash,
        policy_binding=binding,
    )


def evaluate_document_version_access(
    context: SubjectContext,
    action: str,
    version: DocumentVersion,
    authority: DocumentVersionAuthority,
) -> Decision:
    constraints = {
        "organization_id": authority.organization_id,
        "governed_resource_id": authority.governed_resource_id,
        "governed_source_version": authority.governed_source_version,
        "policy_binding_id": authority.policy_binding_id,
        "policy_version": authority.policy_version,
        "policy_hash": authority.policy_hash,
        "governance_scope": authority.governance_scope,
    }
    # Legacy role evaluation is still performed against the root document. The
    # immutable version authority is nevertheless validated above and every
    # production user projection takes the v2 path below.
    if not context.access_v2:
        return Decision(
            True,
            "Root document authorization and immutable version authority are valid",
            constraints,
            ("VERSION_AUTHORITY_ALLOW",),
        )
    base = _v2_base_decision(context, action)
    if base is not None:
        return base
    if not _scope_allows(context, version, authority.policy_binding):
        return Decision(
            False,
            "Document version audience or scope does not match",
            constraints,
            ("VERSION_SCOPE_MISMATCH",),
        )
    constraints["obligations"] = list(authority.policy_binding.obligations)
    return Decision(
        True,
        "Capability, exact version scope and information policy allow access",
        constraints,
        ("VERSION_POLICY_ALLOW",),
    )


def evaluate_runtime_document_version_access(
    principal: Principal,
    action: str,
    version: DocumentVersion,
    authority: DocumentVersionAuthority,
    local_decision: Decision,
) -> Decision:
    if not local_decision.allowed:
        return local_decision
    settings = get_settings()
    if settings.auth_mode == "mock":
        return local_decision
    if not principal.dynamic_access_loaded:
        return local_decision
    try:
        response = governance_client(settings).decide(
            capability_id=_primary_capability(action),
            operation=_central_operation(action),
            scope=authority.governance_scope,
            policy_binding=dict(version.policy_summary),
            policy_hash=authority.policy_hash,
            credential_token=principal.bearer_token,
        )
    except GovernanceDenied as exc:
        raise problem(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "policy_decision_credential_rejected",
            "STRATOS rejected the AKB exact-version policy decision credential",
        ) from exc
    except GovernanceUnavailable as exc:
        raise problem(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "policy_decision_unavailable",
            "STRATOS exact-version policy decision is unavailable",
        ) from exc
    reason_codes = tuple(
        str(item) for item in response.get("reasonCodes", []) if isinstance(item, str)
    )
    if response.get("decision") != "ALLOW":
        return Decision(
            False,
            "STRATOS denied the exact document version policy or active scope",
            {
                **local_decision.constraints,
                "obligations": response.get("obligations", []),
            },
            reason_codes or ("VERSION_POLICY_DENY",),
        )
    return Decision(
        True,
        "Local, root and STRATOS exact-version policy decisions allow access",
        {
            **local_decision.constraints,
            "obligations": response.get("obligations", []),
        },
        reason_codes or local_decision.reason_codes,
    )


def evaluate_runtime_document_access(
    principal: Principal,
    action: str,
    document: Document,
    local_decision: Decision | None = None,
) -> Decision:
    settings = get_settings()
    decision = (
        Decision(
            True,
            "Verified service route requires a central policy decision",
            {},
            ("SERVICE_ROUTE_ALLOW",),
        )
        if principal.service_identity
        else local_decision
        or evaluate_document_access(context_for_principal(principal), action, document)
    )
    if not decision.allowed:
        return decision
    # The public-projection branch above has already performed a fresh anonymous
    # decision for each exact immutable publication/version.  Sending that
    # result through the authenticated, scope-oriented PDP would evaluate a
    # different resource contract (normally the document's organization
    # scope) and can turn an exact public ALLOW into an unrelated DENY.
    # Conversely, this bypass is deliberately unavailable to ordinary scoped
    # access or to full document reads.
    context = context_for_principal(principal)
    if (
        action == Action.rag_query.value
        and "public" in context.scopes
        and bool(decision.constraints.get("public_version_ids"))
    ):
        return decision
    if settings.auth_mode == "mock":
        return decision
    if not (principal.dynamic_access_loaded or principal.service_identity):
        return decision
    credential_token = principal.bearer_token if principal.dynamic_access_loaded else None
    capability = _primary_capability(action)
    try:
        response = governance_client(settings).decide(
            capability_id=capability,
            operation=_central_operation(action),
            scope=document_governance_scope(document),
            policy_binding=dict(document.policy_summary) if document.policy_summary else None,
            policy_hash=document.policy_hash,
            credential_token=credential_token,
        )
    except GovernanceDenied as exc:
        raise problem(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "policy_decision_credential_rejected",
            "STRATOS rejected the AKB policy decision credential",
        ) from exc
    except GovernanceUnavailable as exc:
        raise problem(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "policy_decision_unavailable",
            "STRATOS policy decision endpoint is unavailable",
        ) from exc
    reason_codes = tuple(
        str(item) for item in response.get("reasonCodes", []) if isinstance(item, str)
    )
    if response.get("decision") != "ALLOW":
        return Decision(
            False,
            "STRATOS denied the current capability, active scope, audience, or policy",
            {
                **decision.constraints,
                "scope": document_governance_scope(document),
                "obligations": response.get("obligations", []),
            },
            reason_codes or ("POLICY_DENY",),
        )
    return Decision(
        True,
        "Local and STRATOS runtime policy decisions allow access",
        {
            **decision.constraints,
            "scope": document_governance_scope(document),
            "obligations": response.get("obligations", []),
        },
        reason_codes or decision.reason_codes,
    )


def _primary_capability(action: str) -> str:
    preferred = {
        Action.document_read.value: "akb:read_document",
        Action.rag_query.value: "akb:chat",
        Action.rag_compare.value: "akb:chat",
        Action.rag_check_compliance.value: "akb:chat",
        Action.rag_export.value: "akb:export",
        Action.audit_write.value: "akb:read_audit",
    }
    if action in preferred:
        return preferred[action]
    required = ACTION_CAPABILITIES.get(action, set())
    if not required:
        return "akb:access"
    return sorted(required)[0]


def _central_operation(action: str) -> str:
    if action == Action.rag_export.value:
        return "export"
    if action in {
        Action.rag_query.value,
        Action.rag_compare.value,
        Action.rag_check_compliance.value,
    }:
        return "ai"
    if action in {
        Action.document_create.value,
        Action.document_version_create.value,
        Action.document_ingest.value,
        Action.document_reindex.value,
    }:
        return "upload"
    return "read"


def evaluate_global_action(context: SubjectContext, action: str, classification: str | None = None) -> Decision:
    if context.access_v2:
        denied = _v2_base_decision(context, action)
        if denied is not None:
            return denied
        return Decision(
            True,
            f"Capability grants action {action}",
            {"capabilities": sorted(context.capabilities), "scopes": sorted(context.scopes)},
            ("ACCESS_ALLOW",),
        )
    constraints = {"max_classification": max_classification_for_roles(context.roles)}

    if "admin" in context.roles:
        return Decision(True, "role admin grants access", constraints)

    if not roles_grant_action(context.roles, action):
        return Decision(False, f"no role grants action {action}", constraints)

    if classification and not classification_allows(constraints["max_classification"], classification):
        return Decision(
            False,
            f"classification {classification} exceeds {constraints['max_classification']}",
            constraints,
        )

    return Decision(True, f"role grants action {action}", constraints)


def require_global_action(principal: Principal, action: Action, db: Session | None = None) -> SubjectContext:
    context = context_for_principal(principal, db)
    decision = evaluate_global_action(context, action.value)
    if not decision.allowed:
        details = {**decision.constraints, "reason_codes": list(decision.reason_codes)}
        raise problem(status.HTTP_403_FORBIDDEN, "forbidden", decision.reason, details)
    return context


def require_document_action(
    principal: Principal, action: Action, document: Document, db: Session | None = None
) -> SubjectContext:
    context = context_for_principal(principal, db)
    decision = evaluate_document_access(context, action.value, document)
    decision = evaluate_runtime_document_access(principal, action.value, document, decision)
    if not decision.allowed:
        details = {**decision.constraints, "reason_codes": list(decision.reason_codes)}
        raise problem(status.HTTP_403_FORBIDDEN, "forbidden", decision.reason, details)
    return context


def require_document_version_action(
    principal: Principal,
    action: Action,
    document: Document,
    version: DocumentVersion,
    db: Session | None = None,
) -> DocumentVersionAuthority:
    try:
        authority = resolve_document_version_authority(document, version)
    except ValueError as exc:
        raise problem(
            status.HTTP_409_CONFLICT,
            "document_version_authority_invalid",
            "The immutable document version governance authority is unavailable or conflicting",
        ) from exc
    context = context_for_principal(principal, db)
    decision = evaluate_document_version_access(
        context,
        action.value,
        version,
        authority,
    )
    decision = evaluate_runtime_document_version_access(
        principal,
        action.value,
        version,
        authority,
        decision,
    )
    if not decision.allowed:
        details = {**decision.constraints, "reason_codes": list(decision.reason_codes)}
        raise problem(status.HTTP_403_FORBIDDEN, "forbidden", decision.reason, details)
    return authority
