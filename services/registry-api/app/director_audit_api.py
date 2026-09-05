"""BFF-only audit path: domain credentials never acquire Registry privileges."""
import json
import re
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.audit import add_audit_event
from app.config import Settings, get_settings
from app.database import get_db
from app.session_api import _verify_internal_request

router = APIRouter(prefix="/api/v1/internal/director-copilot", tags=["Internal Director audit"])
SCALAR_KEYS = frozenset({"contract_version", "contract_revision", "mode", "plan_id", "snapshot_id", "snapshot_hash", "returned_item_count", "query_operation", "semantic_shape_valid", "evidence_status", "evidence_checked_claim_count", "evidence_supported_claim_count", "authorized_document_link_count", "status", "failure_reason_code", "error_code", "validation_error_code", "outcome", "correlation_id"})
JSON_KEYS = frozenset({"tool_ids_json", "schema_revisions_json", "source_versions_json", "requested_capabilities_json", "authorized_scope_types_json", "source_statuses_json", "query_operations_json", "requested_granularities_json", "evidence_issue_codes_json", "validation_issue_paths_json"})
OBJECT_KEYS = frozenset({"application", "source_version", "status", "reason_codes", "returned_item_count", "latency_ms", "node_id", "operation", "granularity"})
TECHNICAL_VALUE = re.compile(r"^[A-Za-z0-9_.:@/\[\]+-]{0,256}$")


def _technical_value(value: object, depth: int = 0) -> bool:
    if depth > 4:
        return False
    if value is None or isinstance(value, bool):
        return True
    if type(value) in {int, float}:
        return 0 <= value <= 10**12
    if isinstance(value, str):
        return bool(TECHNICAL_VALUE.fullmatch(value))
    if isinstance(value, list):
        return len(value) <= 500 and all(_technical_value(item, depth + 1) for item in value)
    if isinstance(value, dict):
        return not (set(value) - OBJECT_KEYS) and all(_technical_value(item, depth + 1) for item in value.values())
    return False


class DirectorAuditWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actor_id: UUID
    event_type: Literal["assistant.director_copilot_v2_returned", "assistant.director_copilot_v2_failed"]
    resource_type: Literal["assistant_conversation"]
    resource_id: str = Field(pattern=r"^[A-Za-z0-9_.:-]{1,160}$")
    severity: Literal["info", "warning", "error"]
    correlation_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_.:-]{1,160}$")
    metadata: dict[str, str | int | float | bool | None]

    @field_validator("metadata", mode="before")
    @classmethod
    def technical_metadata_only(cls, value: object) -> object:
        if not isinstance(value, dict) or set(value) - SCALAR_KEYS - JSON_KEYS:
            raise ValueError("Only technical audit metadata is accepted")
        for key, item in value.items():
            if key in JSON_KEYS:
                if not isinstance(item, str) or len(item) > 16384:
                    raise ValueError("Invalid audit collection")
                try:
                    item = json.loads(item)
                except ValueError as exc:
                    raise ValueError("Invalid audit collection") from exc
            if not _technical_value(item):
                raise ValueError("Invalid technical audit value")
        return value


@router.post("/audit", status_code=201)
def write_director_audit(payload: DirectorAuditWrite, db: Session = Depends(get_db), settings: Settings = Depends(get_settings), _: bytes = Depends(_verify_internal_request)) -> dict[str, str]:
    if settings.identity_mode != "managed":
        raise HTTPException(status_code=404, detail="Managed audit route is disabled")
    event = add_audit_event(db, actor_id="akb-browser-bff", event_type=payload.event_type, resource_type=payload.resource_type, resource_id=payload.resource_id, severity=payload.severity, correlation_id=payload.correlation_id, metadata={**payload.metadata, "reported_actor_id": str(payload.actor_id)})
    db.commit()
    return {"audit_event_id": event.audit_event_id}
