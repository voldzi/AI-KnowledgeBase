# Document policy admission in ingestion and retrieval

The immutable Registry version must have explicit effective TLP and consistent
V2 policy binding, version and canonical hash. Ingestion checks these facts
before reading source bytes, parsing, embeddings or indexing. It still confirms
the current Registry ingestion authorization and clean scan evidence; a valid
policy hash is not authorization or a malware verdict.

Missing, null, empty or unsupported TLP produces `DOCUMENT_TLP_REQUIRED` in the
job's failed report. Inconsistent coordinates and incomplete TLP:RED audience
produce `DOCUMENT_POLICY_INVALID`. RED requires exact recipients and originator.
The job identity remains available for authorized diagnosis and retry. Failed
policy validation creates no indexed chunks.

Both Qdrant and OpenSearch writers repeat the policy validation before any
collection/index mutation, including direct caller and rebuild paths through
these adapters. Mock Registry metadata carries an explicit test policy; the
validator has no mock/admin/public-source exemption.

Production RAG excludes incomplete document policies even if their existing
central policy hash matches. It then applies current Registry authorization,
exact version and temporal selection. No incomplete-policy chunk may become an
answer or citation through the normal strict production retrieval path.

The central policy hash convention is unchanged. Active accountability and
immutable metadata-profile confirmation are separate requirements described in
[the document-profile proposal](../CONTRACTS/AKB_DOCUMENT_PROFILE_PROPOSAL.md).
Joint acceptance of these profiles remains a first-intake gate.

Focused regression evidence: `tests/test_document_policy.py` in ingestion and
`tests/test_mandatory_document_tlp.py` in RAG. OCR and physical-page citation
semantics are documented in [the pipeline guide](ingestion-pipeline.md).
