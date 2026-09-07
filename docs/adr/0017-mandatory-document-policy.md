# ADR 0017: Mandatory Document Policy Before AKB Admission

## Status

Product requirement accepted on 2026-09-05. Removes the previously proposed
"approved without TLP" exception from the clean-target intake plan. The local
implementation now enforces explicit TLP at Registry document admission and
activation, web intake, ingestion/index writes and production retrieval.
Verified active ownership, approved collection/source profiles and joint
AKB/STRATOS acceptance remain required before first user intake. Shared
Information Policy V2 remains nullable for defensive reading; its strict AKB
document subtype does not permit null.

## Decision

Every document and immutable content version admitted to AKB must have an
explicit effective TLP value in its authoritative policy. This applies to
manual uploads, generated notes, source-app integrations, batch import and
official public collections. No approved exception may omit TLP, and neither
the UI nor a service may interpret an absent value as TLP:CLEAR.

An admission also needs an accountable active internal gestor, verified
audience and classification. Provenance and lifecycle requirements depend on
the document profile: distinguish author/issuer, source, uploader and internal
accountability; distinguish issue/effective dates, event dates, review dates and
retention. Do not fabricate an author or expiration date to satisfy a generic
form. A documented unknown external author does not waive the internal gestor,
source evidence or any policy requirement.

Approved source/collection/profile inheritance may satisfy these requirements
without manual input for each file. Record its authority and revalidate it;
changing inherited TLP or widening the audience requires an authorized policy
decision. AI may propose metadata but may not authorize a downgrade.

Ordinary document admission must reject missing/null/unknown TLP or unresolved
policy conflict before accepting binary content. Any separate temporary intake
workspace must itself have restrictive effective TLP, ownership, a deadline and
controlled access from the first byte. It cannot become an indefinite store of
unclassified material or feed normal Chat, shared citations, exports or
publications. This decision does not introduce such a workspace endpoint.

Apply the invariant at authoritative Registry document/version and policy-change
writes and at every intake, ingestion authorization, publication and retrieval
activation boundary. Early UI checks improve usability; they are not the
security boundary. Defensive handling of malformed upstream data may keep an
explicit diagnostic state, but must deny its admission and activation.

Preserve the distinction between TLP sharing restrictions, sensitivity,
authorized audience and specific handling obligations. A label alone grants no
document access. Inherited TLP:RED must retain exact authorized recipients and
originator; a generic group tag is not a replacement. Public-source collection
must obtain an explicit approved public policy rather than invent it locally.

## Implementation consequences

- Agree a stricter AKB document-admission policy profile with STRATOS. Do not
  indiscriminately make every shared Information Policy V2 resource non-null;
  the shared schema covers resources beyond AKB documents.
- Align Registry invariants, all callers/collectors, UI and generated OpenAPI
  in the same implementation increment. Keep current operational documentation
  honest about what the running code actually enforces.
- Test omission, explicit null, unknown labels, inherited-policy revocation,
  source conflict, actor mismatch and direct API attempts for each admitted
  source profile. Cover exact document versions and downstream use, not only
  the upload form.
- Treat passing this acceptance matrix as a condition of first user intake in
  the clean environment. No migration or dual contract is required.

## References

- [Implementation plan](../ARCHITECTURE/document-intake-hardening-plan.md)
- [STRATOS handoff](../integration/STRATOS_DOCUMENT_INTAKE_HANDOFF.md)
- [FIRST TLP definitions](https://www.first.org/tlp/)
