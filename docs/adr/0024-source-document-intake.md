# ADR 0024: Interactive source document intake for ProjectFlow and ArchFlow

Status: Implemented in AKB; STRATOS authority/adapters and joint acceptance pending.
Date: 2026-09-06

ProjectFlow and ArchFlow documents must not be presented as Budget contracts or admitted through an unverified generic external-reference write. The empty environment permits closing those old write paths.

AKB adds one typed source intake bridge with prepare, common binary PUT, confirm and status operations. Each source has an exact OIDC service client and a separate fresh interactive actor credential. The Registry checks a fresh nonce-bound STRATOS source decision before prepare, binary authorization and confirm. Missing authority fails closed. The authority verifies the actual attachment revision/hash, source record and governed parent, current actor rights, TLP/policy, provenance and accountability. It never authorizes by merely echoing the request.

After source authorization, the bridge uses the existing document registration, profile admission, ClamAV receipt verification, immutable version persistence and ingestion authorization implementation. Source roots retain deterministic document identities. Imported version replay uses the existing unique intake identity column, namespaced by document and immutable source attachment revision; changed bytes, receipt, actor, profile or location conflict rather than replacing a version. Root/receipt replay helpers remain shared with native intake. Current-version updates retain predecessor comparison and reject an active previous ingestion lease.

Source versions enter the normal AKB draft/review lifecycle. Intake does not imply publication, normative validity, public access or Chat eligibility. STRATOS must also implement source-aware admission revalidation for later retrieval, so source revocation and changes in protection are enforced after ingestion.

The new explicit source authority protocol is separate from the existing Policy V2 hash and atomic document-profile admission protocol. It neither changes their hash semantics nor replaces them. Budget remains on its dedicated contract route. No historical-batch mode or fallback upload is introduced.

The public connector OpenAPI is generated from Registry input models by `scripts/generate_source_intake_contract.py` and included in the repository OpenAPI. The required STRATOS authority has a separate OpenAPI explicitly marked as a pending STRATOS implementation. Live positive acceptance is required before enabling either source adapter.
