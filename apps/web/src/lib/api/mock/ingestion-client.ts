import type {
  AnalystSearchRequest,
  AnalystSearchResponse,
  ApiRequestContext,
  CreateIngestionJobRequest,
  EntityFacetReport,
  EntityRelationshipRequest,
  EntityRelationshipResponse,
  EntitySearchRequest,
  EntitySearchResponse,
  IngestionAuthorizationOptions,
  IngestionCreateOptions,
  IngestionApiClient,
  IngestionJob,
  IngestionReport,
  IntelligenceScopeAuthorizationOptions,
} from "@/lib/types";
import { ApiClientError } from "@/lib/types";
import {
  bindAuthorizedDocumentScope,
  coordinateByDocumentId,
} from "@/lib/intelligence/authorization-contract";

import { cloneMock, mockIngestionJobs, mockReports } from "./data";

export class MockIngestionClient implements IngestionApiClient {
  private readonly jobs = cloneMock(mockIngestionJobs);
  private readonly reports = cloneMock(mockReports);

  async listJobs(_context: ApiRequestContext): Promise<IngestionJob[]> {
    return cloneMock(this.jobs);
  }

  async getJob(
    jobId: string,
    _context: ApiRequestContext,
    _options: IngestionAuthorizationOptions,
  ): Promise<IngestionJob> {
    const job = this.jobs.find((candidate) => candidate.job_id === jobId);
    if (!job) {
      throw new ApiClientError("Ingestion job not found", 404, "INGESTION_JOB_NOT_FOUND", "mock-trace");
    }
    return cloneMock(job);
  }

  async createJob(
    request: CreateIngestionJobRequest,
    _context: ApiRequestContext,
    _options: IngestionCreateOptions,
  ): Promise<IngestionJob> {
    const job: IngestionJob = {
      job_id: `ing_${this.jobs.length + 400}`,
      status: "queued",
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      ...request
    };
    this.jobs.unshift(job);
    return cloneMock(job);
  }

  async getReport(
    jobId: string,
    _context: ApiRequestContext,
    _options: IngestionAuthorizationOptions,
  ): Promise<IngestionReport> {
    const report = this.reports.find((candidate) => candidate.job_id === jobId);
    if (!report) {
      return {
        job_id: jobId,
        status: "running",
        documents_processed: 0,
        pages_processed: 18,
        chunks_created: 64,
        tables_detected: 2,
        ocr_used: true,
        warnings: [],
        errors: []
      };
    }
    return cloneMock(report);
  }

  async cancelJob(
    jobId: string,
    _context: ApiRequestContext,
    _options: IngestionAuthorizationOptions,
  ): Promise<IngestionJob> {
    const job = this.jobs.find((candidate) => candidate.job_id === jobId);
    if (!job) {
      throw new ApiClientError("Ingestion job not found", 404, "INGESTION_JOB_NOT_FOUND", "mock-trace");
    }
    job.status = "cancelled";
    job.finished_at = new Date().toISOString();
    return cloneMock(job);
  }

  async getEntityFacets(
    _context: ApiRequestContext,
    options: IntelligenceScopeAuthorizationOptions & { limit?: number; valueLimit?: number }
  ): Promise<EntityFacetReport> {
    const coordinates = coordinateByDocumentId(options);
    const includeRmo = coordinates.has("doc_109");
    const includeOperations = coordinates.has("doc_105");
    const entityTypes = [
      ...(includeRmo
        ? [
            { key: "document_number", label: "Document number", count: 7 },
            { key: "date", label: "Date", count: 4 },
            { key: "email", label: "Email", count: 5 },
          ]
        : []),
      ...(includeOperations
        ? [
            { key: "email", label: "Email", count: 3 },
            { key: "url", label: "URL", count: 2 },
          ]
        : []),
    ].slice(0, options.limit ?? 8);
    const emailValues = [
      ...(includeRmo
        ? [{ key: "aiip.office@example.cz", label: "aiip.office@example.cz", count: 5 }]
        : []),
      ...(includeOperations
        ? [{ key: "ops@example.cz", label: "ops@example.cz", count: 3 }]
        : []),
    ].slice(0, options.valueLimit ?? 10);
    const entityGroups = [
      ...(includeRmo
        ? [
            {
              entity_type: "document_number",
              label: "Document number",
              count: 7,
              values: [
                { key: "RMO12/2024", label: "RMO12/2024", count: 7 },
              ].slice(0, options.valueLimit ?? 10),
            },
          ]
        : []),
      ...(emailValues.length > 0
        ? [
            {
              entity_type: "email",
              label: "Email",
              count: emailValues.reduce((total, item) => total + item.count, 0),
              values: emailValues,
            },
          ]
        : []),
    ].slice(0, options.limit ?? 8);
    return {
      status: "ready",
      index_name: "akl_document_chunks",
      total_chunks: coordinates.size * 64,
      chunks_with_entities: (includeRmo ? 24 : 0) + (includeOperations ? 23 : 0),
      generated_at: new Date().toISOString(),
      warnings: [],
      entity_types: entityTypes,
      entity_groups: entityGroups,
    };
  }

  async searchEntities(
    request: EntitySearchRequest,
    _context: ApiRequestContext,
    options: IntelligenceScopeAuthorizationOptions,
  ): Promise<EntitySearchResponse> {
    const scopedRequest = bindAuthorizedDocumentScope(request, options);
    const coordinates = coordinateByDocumentId(options);
    const hits = [
      {
        chunk_id: "chunk_mock_rmo_1",
        document_id: "doc_109",
        document_version_id: "ver_109_1",
        document_title: "Směrnice RMO 12/2024 pro řízení AI",
        version_label: "1.0",
        document_type: "directive",
        classification: "internal",
        status: "valid",
        score: 8.4,
        snippet: "RMO 12/2024 stanovuje odpovědnosti vlastníka procesu a kontaktní adresu aiip.office@example.cz.",
        page_number: 3,
        section_title: "Odpovědnosti",
        section_path: ["Část I", "Článek 4"],
        source_file_name: "rmo-ai.pdf",
        entity_types: ["document_number", "email"],
        entity_values: ["RMO12/2024", "aiip.office@example.cz"],
        entity_pairs: ["document_number:RMO12/2024", "email:aiip.office@example.cz"]
      },
      {
        chunk_id: "chunk_mock_ops_1",
        document_id: "doc_105",
        document_version_id: "ver_105_1",
        document_title: "Provozní metodika evidence dokumentů",
        version_label: "2.1",
        document_type: "methodology",
        classification: "internal",
        status: "valid",
        score: 5.9,
        snippet: "Kontakt ops@example.cz je uveden jako technický správce evidence a importního dohledu.",
        page_number: 7,
        section_title: "Importní dohled",
        section_path: ["Příloha B"],
        source_file_name: "evidence.docx",
        entity_types: ["email"],
        entity_values: ["ops@example.cz"],
        entity_pairs: ["email:ops@example.cz"]
      }
    ].flatMap((hit) => {
      const coordinate = coordinates.get(hit.document_id);
      return coordinate?.document_version_id === hit.document_version_id
        ? [{ ...hit, policy_hash: coordinate.policy_hash }]
        : [];
    });
    const query = scopedRequest.query?.trim().toLowerCase();
    const entityPair = scopedRequest.entity_type && scopedRequest.entity_value
      ? `${scopedRequest.entity_type}:${scopedRequest.entity_value}`
      : null;
    const filtered = hits.filter((hit) => {
      if (scopedRequest.entity_type && !hit.entity_types.includes(scopedRequest.entity_type)) return false;
      if (entityPair && !hit.entity_pairs.includes(entityPair)) return false;
      if (scopedRequest.entity_value && !hit.entity_values.includes(scopedRequest.entity_value) && !hit.entity_pairs.some((pair) => pair.endsWith(`:${scopedRequest.entity_value}`))) return false;
      if (query && !`${hit.document_title} ${hit.snippet} ${hit.entity_values.join(" ")}`.toLowerCase().includes(query)) return false;
      return true;
    });

    return {
      status: "ready",
      index_name: "akl_document_chunks",
      total_hits: filtered.length,
      returned_hits: Math.min(filtered.length, scopedRequest.limit ?? 12),
      hits: filtered.slice(0, scopedRequest.limit ?? 12),
      generated_at: new Date().toISOString(),
      warnings: []
    };
  }

  async analystSearch(
    request: AnalystSearchRequest,
    _context: ApiRequestContext,
    options: IntelligenceScopeAuthorizationOptions,
  ): Promise<AnalystSearchResponse> {
    const scopedRequest = bindAuthorizedDocumentScope(request, options);
    const coordinates = coordinateByDocumentId(options);
    const normalizedQuery = (scopedRequest.query ?? "")
      .replace(/\b(title|body|section|entity|source|type|class):/gi, "")
      .replace(/\b(AND|OR|NOT)\b/gi, " ")
      .replace(/[()"]/g, " ")
      .trim()
      .toLowerCase();
    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const hits = [
      {
        chunk_id: "chunk_mock_rmo_1",
        document_id: "doc_109",
        document_version_id: "ver_109_1",
        document_title: "Směrnice RMO 12/2024 pro řízení AI",
        version_label: "1.0",
        document_type: "directive",
        classification: "internal",
        status: "valid",
        score: scopedRequest.query_mode === "fielded" ? 10.4 : 8.4,
        snippet: "RMO 12/2024 stanovuje odpovědnosti vlastníka procesu a kontaktní adresu aiip.office@example.cz.",
        page_number: 3,
        section_title: "Odpovědnosti",
        section_path: ["Část I", "Článek 4"],
        source_file_name: "rmo-ai.pdf",
        entity_types: ["document_number", "email"],
        entity_values: ["RMO12/2024", "aiip.office@example.cz"],
        entity_pairs: ["document_number:RMO12/2024", "email:aiip.office@example.cz"]
      },
      {
        chunk_id: "chunk_mock_ops_1",
        document_id: "doc_105",
        document_version_id: "ver_105_1",
        document_title: "Provozní metodika evidence dokumentů",
        version_label: "2.1",
        document_type: "methodology",
        classification: "internal",
        status: "valid",
        score: 6.2,
        snippet: "Kontakt ops@example.cz je uveden jako technický správce evidence a importního dohledu.",
        page_number: 7,
        section_title: "Importní dohled",
        section_path: ["Příloha B"],
        source_file_name: "evidence.docx",
        entity_types: ["email"],
        entity_values: ["ops@example.cz"],
        entity_pairs: ["email:ops@example.cz"]
      }
    ].flatMap((hit) => {
      const coordinate = coordinates.get(hit.document_id);
      return coordinate?.document_version_id === hit.document_version_id
        ? [{ ...hit, policy_hash: coordinate.policy_hash }]
        : [];
    }).filter((hit) => {
      if (queryTokens.length === 0) return true;
      const haystack = `${hit.document_title} ${hit.snippet} ${hit.entity_values.join(" ")} ${hit.entity_pairs.join(" ")}`
        .toLowerCase();
      return queryTokens.every((token) => haystack.includes(token));
    });

    return {
      status: "ready",
      index_name: "akl_document_chunks",
      query_mode: scopedRequest.query_mode ?? "smart",
      total_hits: hits.length,
      returned_hits: Math.min(hits.length, scopedRequest.limit ?? 12),
      hits: hits.slice(0, scopedRequest.limit ?? 12),
      generated_at: new Date().toISOString(),
      warnings: []
    };
  }

  async getEntityRelationships(
    request: EntityRelationshipRequest,
    _context: ApiRequestContext,
    options: IntelligenceScopeAuthorizationOptions,
  ): Promise<EntityRelationshipResponse> {
    const scopedRequest = bindAuthorizedDocumentScope(request, options);
    const coordinates = coordinateByDocumentId(options);
    const edges = [
      {
        edge_id: "rel_mock_rmo_aiip",
        relationship_type: "co_occurs" as const,
        source: {
          entity_type: "document_number",
          entity_value: "RMO12/2024",
          label: "Document number: RMO12/2024"
        },
        target: {
          entity_type: "email",
          entity_value: "aiip.office@example.cz",
          label: "Email: aiip.office@example.cz"
        },
        evidence_count: 7,
        document_count: 2,
        confidence: 0.91,
        evidence: [
          {
            chunk_id: "chunk_mock_rmo_1",
            document_id: "doc_109",
            document_version_id: "ver_109_1",
            document_title: "Směrnice RMO 12/2024 pro řízení AI",
            version_label: "1.0",
            snippet: "RMO 12/2024 stanovuje odpovědnosti vlastníka procesu a kontaktní adresu aiip.office@example.cz.",
            page_number: 3,
            section_title: "Odpovědnosti",
            source_file_name: "rmo-ai.pdf"
          }
        ]
      },
      {
        edge_id: "rel_mock_ops_url",
        relationship_type: "co_occurs" as const,
        source: {
          entity_type: "email",
          entity_value: "ops@example.cz",
          label: "Email: ops@example.cz"
        },
        target: {
          entity_type: "url",
          entity_value: "https://akb.example.cz/import",
          label: "URL: https://akb.example.cz/import"
        },
        evidence_count: 3,
        document_count: 1,
        confidence: 0.71,
        evidence: [
          {
            chunk_id: "chunk_mock_ops_1",
            document_id: "doc_105",
            document_version_id: "ver_105_1",
            document_title: "Provozní metodika evidence dokumentů",
            version_label: "2.1",
            snippet: "Kontakt ops@example.cz je uveden jako technický správce evidence importního rozhraní https://akb.example.cz/import.",
            page_number: 7,
            section_title: "Importní dohled",
            source_file_name: "evidence.docx"
          }
        ]
      }
    ].map((edge) => ({
      ...edge,
      evidence: edge.evidence.flatMap((item) => {
        const coordinate = coordinates.get(item.document_id);
        return coordinate?.document_version_id === item.document_version_id
          ? [{ ...item, policy_hash: coordinate.policy_hash }]
          : [];
      }),
    })).filter((edge) => {
      if (edge.evidence.length === 0) return false;
      if (scopedRequest.entity_type || scopedRequest.entity_value) {
        const endpoints = [edge.source, edge.target];
        return endpoints.some((endpoint) => {
          if (scopedRequest.entity_type && endpoint.entity_type !== scopedRequest.entity_type) return false;
          if (scopedRequest.entity_value && endpoint.entity_value !== scopedRequest.entity_value) return false;
          return true;
        });
      }
      return true;
    });

    return {
      status: "ready",
      index_name: "akl_document_chunks",
      total_edges: edges.length,
      returned_edges: Math.min(edges.length, scopedRequest.limit ?? 12),
      edges: edges.slice(0, scopedRequest.limit ?? 12),
      generated_at: new Date().toISOString(),
      warnings: []
    };
  }
}
