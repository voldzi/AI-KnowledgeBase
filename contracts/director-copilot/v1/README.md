# Director Copilot contracts v1

These JSON Schemas define the read-only federation boundary used by AKB Chat.
They are intentionally independent from source application database schemas.

- `domain-tool.schema.json` defines the request and response exchanged with a
  source application.
- `evidence-item.schema.json` defines normalized evidence owned by AKB.
- `query-plan.schema.json` defines the immutable multi-tool execution plan.
- `analysis-snapshot.schema.json` binds a plan, evidence and policy lineage to
  one reproducible answer.
- `fixtures/` contains byte-stable conformance examples for source owners.

The transport is server-to-server. Source applications must authenticate the
AKB service bearer from `Authorization`, independently validate the actor bearer
from `X-STRATOS-Actor-Authorization`, load a fresh STRATOS access projection and
apply their local PEP. Request scopes are query bounds, never authorization
claims.

Every returned item must contain at least one stable `document_context_tags`
value. AKB uses only these tags for the dependent document retrieval and never
falls back to a global corpus query. The snapshot aggregates audience
requirements with `audience_mode=all_source_policies_required`: every source
policy remains binding even when applications use different audience labels.
`RESTRICTED`, `NO_EXTERNAL_AI` and `LOCAL_PROCESSING_ONLY` fail closed in this
first release; AKB returns verified structured facts but does not send them to
the model.

The contract accepts the complete Information Policy V2 obligation catalog.
`AUDIT_ACCESS` is enforced by a mandatory result audit. Display-only output
does not expose an export surface, so `NO_EXPORT`, `NO_PUBLIC_EXPORT` and
`WATERMARK` remain preserved for future artifacts. `RECIPIENT_CONFIRMATION`,
`ORIGINATOR_APPROVAL` and `PAP_ENFORCEMENT` also block AI processing until AKB
has an explicit fulfillment flow.

Fact keys are closed per `tool_id`. The Budget tool accepts only the five
documented financial keys and the ProjectFlow tool only the four documented
delivery keys. Contract or legal risk is intentionally not a structured source
fact in this version; it must come from a cited AKB document finding.

Contract version: `director-copilot-1`
