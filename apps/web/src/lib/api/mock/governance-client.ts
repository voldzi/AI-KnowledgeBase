import type {
  ApiRequestContext,
  CompareVersionsRequest,
  CompareVersionsResponse,
  ComplianceCheckRequest,
  ComplianceCheckResponse,
  ConflictDetectionRequest,
  ConflictDetectionResponse,
  GovernanceApiClient,
  GovernanceCitation,
  GovernanceSourceDocument,
  GovernanceSourceReference,
  GovernanceVersionContent
} from "@/lib/types";

import { cloneMock } from "./data";

export class MockGovernanceClient implements GovernanceApiClient {
  async compareVersions(request: CompareVersionsRequest, _context: ApiRequestContext): Promise<CompareVersionsResponse> {
    const leftCitation = citationForVersion(request.left_version);
    const rightCitation = citationForVersion(request.right_version);
    const changed = normalizeText(request.left_version.content) !== normalizeText(request.right_version.content);
    const changes = changed
      ? [
          {
            change_id: "change_mock_material_1",
            change_type: "modified" as const,
            impact: "material" as const,
            before_text: excerpt(request.left_version.content),
            after_text: excerpt(request.right_version.content),
            before_citation: leftCitation,
            after_citation: rightCitation,
            citations: [leftCitation, rightCitation],
            confidence: "medium" as const,
            rationale: "Registry metadata, source URI and change summary differ between the selected versions."
          }
        ]
      : [];

    return cloneMock({
      result_id: "governance_compare_mock",
      document_id: request.right_version.document_id,
      left_version_id: request.left_version.document_version_id,
      right_version_id: request.right_version.document_version_id,
      summary: changed
        ? "Porovnani naslo materialni rozdil mezi verzemi a vyzaduje review vlastnika."
        : "Porovnani nenaslo rozdil v dostupnem web metadatovem vstupu.",
      change_counts: {
        added: 0,
        removed: 0,
        modified: changes.length,
        unchanged: request.include_unchanged ? Number(!changed) : 0
      },
      materiality_score: changed ? 0.64 : 0.12,
      changes,
      citations: changed ? [leftCitation, rightCitation] : [rightCitation],
      sources: [sourceForVersion(request.left_version), sourceForVersion(request.right_version)],
      confidence: changed ? "medium" : "high",
      warnings: ["MOCK_GOVERNANCE_RESULT", "WEB_BRIDGE_METADATA_CONTENT_ONLY"],
      missing_information: "Native extracted document text is not yet passed through the web bridge."
    });
  }

  async checkCompliance(request: ComplianceCheckRequest, _context: ApiRequestContext): Promise<ComplianceCheckResponse> {
    const citation = citationForDraft(request.draft);
    const ownerMissing = !request.draft.owner_id;
    const validityMissing = !request.draft.valid_from;
    const findings = [
      {
        finding_id: "finding_mock_owner",
        rule_id: "governance.owner_or_gestor.required",
        rule_name: "Owner or gestor must be present",
        status: ownerMissing ? ("failed" as const) : ("passed" as const),
        severity: ownerMissing ? ("error" as const) : ("info" as const),
        message: ownerMissing
          ? "Document owner is missing in Registry metadata."
          : "Registry metadata identifies an owner or gestor for the document.",
        recommendation: ownerMissing
          ? "Assign an owner before publication review."
          : "Keep the owner and gestor assignment in the publication package.",
        evidence_citations: [citation],
        sources: [sourceForDraft(request.draft)],
        confidence: "medium" as const
      },
      {
        finding_id: "finding_mock_validity",
        rule_id: "governance.validity_window.required",
        rule_name: "Validity window should be explicit",
        status: validityMissing ? ("warning" as const) : ("passed" as const),
        severity: validityMissing ? ("warning" as const) : ("info" as const),
        message: validityMissing
          ? "The current version does not expose valid_from in the web input."
          : "The current version exposes validity metadata.",
        recommendation: validityMissing
          ? "Complete valid_from and review valid_to before approval."
          : "Review validity metadata as part of approval.",
        evidence_citations: [citation],
        sources: [sourceForDraft(request.draft)],
        confidence: "medium" as const
      }
    ];

    return cloneMock({
      result_id: "governance_compliance_mock",
      status: findings.some((finding) => finding.status === "failed") ? "non_compliant" : "needs_review",
      summary: "Compliance baseline was evaluated against registry metadata and available source identifiers.",
      findings,
      citations: [citation],
      sources: [sourceForDraft(request.draft)],
      confidence: "medium",
      warnings: ["MOCK_GOVERNANCE_RESULT", "WEB_BRIDGE_METADATA_CONTENT_ONLY"],
      missing_information: "Control sources and full extracted document text are not yet supplied by the web bridge."
    });
  }

  async detectConflicts(request: ConflictDetectionRequest, _context: ApiRequestContext): Promise<ConflictDetectionResponse> {
    const [primary, secondary] = request.documents;
    const primaryCitation = citationForSourceDocument(primary);
    const secondaryCitation = citationForSourceDocument(secondary);
    const conflict =
      primary && secondary
        ? {
            conflict_id: "conflict_mock_overlap",
            conflict_type: "potential_overlap" as const,
            severity: "warning" as const,
            summary: "Documents cover overlapping governance topics and should be reviewed together before publication.",
            claims: [
              {
                statement: excerpt(primary.content),
                citation: primaryCitation,
                source: sourceForSourceDocument(primary)
              },
              {
                statement: excerpt(secondary.content),
                citation: secondaryCitation,
                source: sourceForSourceDocument(secondary)
              }
            ],
            recommendation: "Review owners, validity dates and exception approval wording across both documents.",
            confidence: "medium" as const
          }
        : null;

    return cloneMock({
      result_id: "governance_conflicts_mock",
      summary: conflict
        ? "Potential overlap was detected between authorized document sources."
        : "Conflict detection needs at least two authorized document sources.",
      conflicts: conflict ? [conflict] : [],
      citations: conflict ? [primaryCitation, secondaryCitation] : [],
      sources: request.documents.map(sourceForSourceDocument),
      confidence: conflict ? "medium" : "insufficient_source",
      warnings: ["MOCK_GOVERNANCE_RESULT", "WEB_BRIDGE_METADATA_CONTENT_ONLY"],
      missing_information: conflict ? null : "At least two documents are required for conflict detection."
    });
  }
}

function citationForVersion(version: GovernanceVersionContent): GovernanceCitation {
  return {
    document_id: version.document_id,
    document_version_id: version.document_version_id,
    document_title: version.document_title,
    version_label: version.version_label,
    section_path: ["Registry metadata"],
    page_number: null,
    chunk_id: `governance:${version.document_version_id}`,
    source_excerpt: excerpt(version.content)
  };
}

function citationForDraft(draft: ComplianceCheckRequest["draft"]): GovernanceCitation {
  return {
    document_id: draft.document_id ?? "draft",
    document_version_id: draft.document_version_id ?? "draft",
    document_title: draft.title,
    version_label: "draft",
    section_path: ["Registry metadata"],
    page_number: null,
    chunk_id: `governance:${draft.document_version_id ?? draft.document_id ?? "draft"}`,
    source_excerpt: excerpt(draft.content)
  };
}

function citationForSourceDocument(document: GovernanceSourceDocument): GovernanceCitation {
  return {
    document_id: document.document_id,
    document_version_id: document.document_version_id,
    document_title: document.document_title,
    version_label: document.version_label,
    section_path: ["Registry metadata"],
    page_number: null,
    chunk_id: `governance:${document.document_version_id}`,
    source_excerpt: excerpt(document.content)
  };
}

function sourceForVersion(version: GovernanceVersionContent): GovernanceSourceReference {
  return {
    source_id: version.document_version_id,
    source_type: "document_version",
    document_id: version.document_id,
    document_version_id: version.document_version_id,
    title: `${version.document_title} ${version.version_label}`,
    uri: version.source_uri,
    citation: citationForVersion(version)
  };
}

function sourceForDraft(draft: ComplianceCheckRequest["draft"]): GovernanceSourceReference {
  return {
    source_id: draft.document_version_id ?? draft.document_id ?? "draft",
    source_type: "input_document",
    document_id: draft.document_id,
    document_version_id: draft.document_version_id,
    title: draft.title,
    uri: null,
    citation: citationForDraft(draft)
  };
}

function sourceForSourceDocument(document: GovernanceSourceDocument): GovernanceSourceReference {
  return {
    source_id: document.document_version_id,
    source_type: "input_document",
    document_id: document.document_id,
    document_version_id: document.document_version_id,
    title: document.document_title,
    uri: document.source_uri,
    citation: citationForSourceDocument(document)
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function excerpt(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}
