from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette import status

from app.auth import Principal
from app.errors import problem
from app.information_policy import InformationPolicyBinding, POLICY_VERSION
from app.models import Document, RoleMapping
from app.schemas import Action, Classification


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
    Action.document_read.value: {"akb:read_document", "akb:chat"},
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


def _scope_allows(context: SubjectContext, document: Document, binding: InformationPolicyBinding) -> bool:
    audience = binding.audience
    if audience.organization_id != context.organization_id:
        return False
    recipients = set(audience.recipient_subject_ids)
    if recipients and context.subject_id not in recipients:
        return False
    if binding.tlp == "TLP:RED":
        return context.subject_id in recipients
    if document.owner_id == context.subject_id and "own" in context.scopes:
        return True
    if (
        "organization" in context.scopes
        or f"organization:{context.organization_id}" in context.scopes
    ):
        return True
    if audience.scope_type == "public":
        return True
    if f"document:{document.document_id}" in context.scopes:
        return True
    for scope_id in audience.scope_ids:
        if f"{audience.scope_type}:{scope_id}" in context.scopes:
            return True
    return audience.scope_type in context.scopes and not audience.scope_ids


def _v2_document_decision(context: SubjectContext, action: str, document: Document) -> Decision:
    base = _v2_base_decision(context, action)
    if base is not None:
        return base
    constraints = {
        "organization_id": context.organization_id,
        "policy_binding_id": document.policy_binding_id,
        "policy_version": document.policy_version,
        "policy_hash": document.policy_hash,
    }
    if not document.policy_binding_id or not document.policy_summary:
        return Decision(False, "Document policy binding is unavailable", constraints, ("POLICY_UNAVAILABLE",))
    if document.policy_version != POLICY_VERSION:
        return Decision(False, "Document policy version is unknown", constraints, ("POLICY_VERSION_UNKNOWN",))
    try:
        binding = InformationPolicyBinding.model_validate(document.policy_summary)
    except ValueError:
        return Decision(False, "Document policy binding is invalid", constraints, ("POLICY_BINDING_INVALID",))
    if not _scope_allows(context, document, binding):
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
    if not decision.allowed:
        details = {**decision.constraints, "reason_codes": list(decision.reason_codes)}
        raise problem(status.HTTP_403_FORBIDDEN, "forbidden", decision.reason, details)
    return context
