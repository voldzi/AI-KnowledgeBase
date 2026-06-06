from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette import status

from app.auth import Principal
from app.errors import problem
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
}

ROLE_MAX_CLASSIFICATION = {
    "admin": Classification.confidential.value,
    "document_manager": Classification.confidential.value,
    "document_owner": Classification.confidential.value,
    "reviewer": Classification.restricted.value,
    "reader": Classification.internal.value,
    "auditor": Classification.confidential.value,
    "service_ingestion": Classification.confidential.value,
    "service_rag": Classification.confidential.value,
    "service_llm_gateway": Classification.public.value,
    "service_evaluation": Classification.restricted.value,
    "service_governance": Classification.confidential.value,
}

OWNER_ACTIONS = {
    Action.document_read.value,
    Action.document_update.value,
    Action.document_version_create.value,
    Action.rag_query.value,
}


@dataclass(frozen=True)
class SubjectContext:
    subject_id: str
    roles: set[str]
    groups: set[str]

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
    db: Session, subject_id: str, roles: list[str] | set[str] | None, groups: list[str] | set[str] | None
) -> SubjectContext:
    collected_roles = set(roles or [])
    collected_groups = set(groups or [])

    direct_role_rows = db.execute(
        select(RoleMapping).where(
            RoleMapping.subject_type.in_(["user", "service"]),
            RoleMapping.subject_id == subject_id,
        )
    ).scalars()
    collected_roles.update(row.role for row in direct_role_rows)

    if collected_groups:
        group_role_rows = db.execute(
            select(RoleMapping).where(
                RoleMapping.subject_type == "group",
                RoleMapping.subject_id.in_(collected_groups),
            )
        ).scalars()
        collected_roles.update(row.role for row in group_role_rows)

    return SubjectContext(subject_id=subject_id, roles=collected_roles, groups=collected_groups)


def context_for_principal(principal: Principal) -> SubjectContext:
    return SubjectContext(
        subject_id=principal.subject_id,
        roles=set(principal.roles),
        groups=set(principal.groups),
    )


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


def require_global_action(principal: Principal, action: Action) -> SubjectContext:
    context = context_for_principal(principal)
    decision = evaluate_global_action(context, action.value)
    if not decision.allowed:
        raise problem(status.HTTP_403_FORBIDDEN, "forbidden", decision.reason, decision.constraints)
    return context


def require_document_action(principal: Principal, action: Action, document: Document) -> SubjectContext:
    context = context_for_principal(principal)
    decision = evaluate_document_access(context, action.value, document)
    if not decision.allowed:
        raise problem(status.HTTP_403_FORBIDDEN, "forbidden", decision.reason, decision.constraints)
    return context
