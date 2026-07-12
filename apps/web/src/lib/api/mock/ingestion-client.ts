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
  IngestionApiClient,
  IngestionJob,
  IngestionReport
} from "@/lib/types";
import { ApiClientError } from "@/lib/types";

import { cloneMock, mockIngestionJobs, mockReports } from "./data";

export class MockIngestionClient implements IngestionApiClient {
  private readonly jobs = cloneMock(mockIngestionJobs);
  private readonly reports = cloneMock(mockReports);

  async listJobs(_context: ApiRequestContext): Promise<IngestionJob[]> {
    return cloneMock(this.jobs);
  }

  async getJob(jobId: string, _context: ApiRequestContext): Promise<IngestionJob> {
    const job = this.jobs.find((candidate) => candidate.job_id === jobId);
    if (!job) {
      throw new ApiClientError("Ingestion job not found", 404, "INGESTION_JOB_NOT_FOUND", "mock-trace");
    }
    return cloneMock(job);
  }

  async createJob(request: CreateIngestionJobRequest, _context: ApiRequestContext): Promise<IngestionJob> {
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

  async getReport(jobId: string, _context: ApiRequestContext): Promise<IngestionReport> {
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

  async cancelJob(jobId: string, _context: ApiRequestContext): Promise<IngestionJob> {
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
    _options: { limit?: number; valueLimit?: number } = {}
  ): Promise<EntityFacetReport> {
    return {
      status: "ready",
      index_name: "akl_document_chunks",
      total_chunks: 128,
      chunks_with_entities: 47,
      generated_at: new Date().toISOString(),
      warnings: [],
      entity_types: [
        { key: "document_number", label: "Document number", count: 18 },
        { key: "date", label: "Date", count: 14 },
        { key: "email", label: "Email", count: 9 },
        { key: "url", label: "URL", count: 6 }
      ],
      entity_groups: [
        {
          entity_type: "document_number",
          label: "Document number",
          count: 18,
          values: [
            { key: "RMO12/2024", label: "RMO12/2024", count: 7 },
            { key: "MO3412/2025", label: "MO3412/2025", count: 4 }
          ]
        },
        {
          entity_type: "email",
          label: "Email",
          count: 9,
          values: [
            { key: "aiip.office@example.cz", label: "aiip.office@example.cz", count: 5 },
            { key: "ops@example.cz", label: "ops@example.cz", count: 3 }
          ]
        }
      ]
    };
  }

  async searchEntities(
    request: EntitySearchRequest,
    _context: ApiRequestContext
  ): Promise<EntitySearchResponse> {
    const allowedDocumentIds = new Set(request.allowed_document_ids ?? []);
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
    ].filter((hit) => allowedDocumentIds.size === 0 || allowedDocumentIds.has(hit.document_id));
    const query = request.query?.trim().toLowerCase();
    const entityPair = request.entity_type && request.entity_value ? `${request.entity_type}:${request.entity_value}` : null;
    const filtered = hits.filter((hit) => {
      if (request.entity_type && !hit.entity_types.includes(request.entity_type)) return false;
      if (entityPair && !hit.entity_pairs.includes(entityPair)) return false;
      if (request.entity_value && !hit.entity_values.includes(request.entity_value) && !hit.entity_pairs.some((pair) => pair.endsWith(`:${request.entity_value}`))) return false;
      if (query && !`${hit.document_title} ${hit.snippet} ${hit.entity_values.join(" ")}`.toLowerCase().includes(query)) return false;
      return true;
    });

    return {
      status: "ready",
      index_name: "akl_document_chunks",
      total_hits: filtered.length,
      returned_hits: filtered.length,
      hits: filtered.slice(0, request.limit ?? 12),
      generated_at: new Date().toISOString(),
      warnings: []
    };
  }

  async analystSearch(
    request: AnalystSearchRequest,
    _context: ApiRequestContext
  ): Promise<AnalystSearchResponse> {
    const allowedDocumentIds = new Set(request.allowed_document_ids ?? []);
    const normalizedQuery = (request.query ?? "")
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
        score: request.query_mode === "fielded" ? 10.4 : 8.4,
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
    ].filter((hit) => {
      if (allowedDocumentIds.size > 0 && !allowedDocumentIds.has(hit.document_id)) return false;
      if (queryTokens.length === 0) return true;
      const haystack = `${hit.document_title} ${hit.snippet} ${hit.entity_values.join(" ")} ${hit.entity_pairs.join(" ")}`
        .toLowerCase();
      return queryTokens.every((token) => haystack.includes(token));
    });

    return {
      status: "ready",
      index_name: "akl_document_chunks",
      query_mode: request.query_mode ?? "smart",
      total_hits: hits.length,
      returned_hits: Math.min(hits.length, request.limit ?? 12),
      hits: hits.slice(0, request.limit ?? 12),
      generated_at: new Date().toISOString(),
      warnings: []
    };
  }

  async getEntityRelationships(
    request: EntityRelationshipRequest,
    _context: ApiRequestContext
  ): Promise<EntityRelationshipResponse> {
    const allowedDocumentIds = new Set(request.allowed_document_ids ?? []);
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
    ].filter((edge) => {
      if (allowedDocumentIds.size > 0 && !edge.evidence.some((item) => allowedDocumentIds.has(item.document_id))) {
        return false;
      }
      if (request.entity_type || request.entity_value) {
        const endpoints = [edge.source, edge.target];
        return endpoints.some((endpoint) => {
          if (request.entity_type && endpoint.entity_type !== request.entity_type) return false;
          if (request.entity_value && endpoint.entity_value !== request.entity_value) return false;
          return true;
        });
      }
      return true;
    });

    return {
      status: "ready",
      index_name: "akl_document_chunks",
      total_edges: edges.length,
      returned_edges: Math.min(edges.length, request.limit ?? 12),
      edges: edges.slice(0, request.limit ?? 12),
      generated_at: new Date().toISOString(),
      warnings: []
    };
  }
}
