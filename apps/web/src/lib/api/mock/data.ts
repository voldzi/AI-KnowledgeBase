import type { AuditEvent, AuthorizationHint, Document, DocumentVersion, IngestionJob, IngestionReport, RagAnswer } from "@/lib/types";

export const mockAuthorization: AuthorizationHint = {
  can_read: true,
  can_update: true,
  can_ingest: true,
  can_publish: false,
  can_read_audit: true,
  can_manage_admin: false
};

export const mockDocuments: Document[] = [
  {
    document_id: "doc_101",
    title: "Smernice pro spravu rizene dokumentace",
    document_type: "directive",
    status: "valid",
    classification: "internal",
    owner_id: "user_123",
    owner: "user_123",
    gestor_unit: "IT",
    tags: ["rizena dokumentace", "workflow"],
    created_at: "2026-05-20T08:10:00Z",
    updated_at: "2026-06-04T12:30:00Z"
  },
  {
    document_id: "doc_102",
    title: "Metodika vyjimek z bezpecnostnich pravidel",
    document_type: "methodology",
    status: "review",
    classification: "restricted",
    owner_id: "user_209",
    owner: "user_209",
    gestor_unit: "Security",
    tags: ["vyjimky", "bezpecnost", "schvalovani"],
    created_at: "2026-05-25T09:35:00Z",
    updated_at: "2026-06-05T07:45:00Z"
  },
  {
    document_id: "doc_103",
    title: "Prirucka pro onboarding znalostni baze",
    document_type: "manual",
    status: "draft",
    classification: "internal",
    owner_id: "user_123",
    owner: "user_123",
    gestor_unit: "Knowledge Ops",
    tags: ["onboarding", "kb", "rag"],
    created_at: "2026-06-01T11:00:00Z",
    updated_at: "2026-06-03T16:20:00Z"
  },
  {
    document_id: "doc_104",
    title: "Archivni postup importu PDF",
    document_type: "procedure",
    status: "archived",
    classification: "public",
    owner_id: "user_144",
    owner: "user_144",
    gestor_unit: "Operations",
    tags: ["import", "archiv"],
    created_at: "2025-12-12T14:00:00Z",
    updated_at: "2026-02-10T10:10:00Z"
  }
];

export const mockVersions: DocumentVersion[] = [
  {
    document_version_id: "ver_101_2",
    document_id: "doc_101",
    version_label: "2.0",
    status: "valid",
    valid_from: "2026-06-01",
    valid_to: null,
    source_file_uri: "s3://akl-documents/doc_101/ver_101_2/file.pdf",
    file_hash: "sha256:9d34c7e7f6e4a8d1",
    change_summary: "Doplneny kroky validace metadat a schvaleni vlastnikem.",
    created_at: "2026-05-31T10:00:00Z",
    published_at: "2026-06-01T09:00:00Z"
  },
  {
    document_version_id: "ver_101_1",
    document_id: "doc_101",
    version_label: "1.0",
    status: "superseded",
    valid_from: "2026-03-01",
    valid_to: "2026-05-31",
    source_file_uri: "s3://akl-documents/doc_101/ver_101_1/file.pdf",
    file_hash: "sha256:f0e4ad447913b1a3",
    change_summary: "Prvni platna verze.",
    created_at: "2026-02-20T10:00:00Z",
    published_at: "2026-03-01T09:00:00Z"
  },
  {
    document_version_id: "ver_102_1",
    document_id: "doc_102",
    version_label: "0.9",
    status: "review",
    valid_from: "2026-07-01",
    valid_to: null,
    source_file_uri: "s3://akl-documents/doc_102/ver_102_1/file.pdf",
    file_hash: "sha256:5b37ab9d11d9a21e",
    change_summary: "Navrh pro revizi security tymem.",
    created_at: "2026-06-05T07:40:00Z",
    published_at: null
  },
  {
    document_version_id: "ver_103_1",
    document_id: "doc_103",
    version_label: "0.1",
    status: "draft",
    valid_from: "2026-07-01",
    valid_to: null,
    source_file_uri: "s3://akl-documents/doc_103/ver_103_1/file.pdf",
    file_hash: "sha256:8a11bc0138a2ee7c",
    change_summary: "Pracovni draft struktury onboarding materialu.",
    created_at: "2026-06-03T16:20:00Z",
    published_at: null
  }
];

export const mockIngestionJobs: IngestionJob[] = [
  {
    job_id: "ing_301",
    document_id: "doc_102",
    document_version_id: "ver_102_1",
    status: "running",
    parser_profile: "controlled_document",
    ocr_enabled: true,
    chunking_strategy: "legal_structured",
    embedding_profile: "default",
    created_at: "2026-06-05T08:12:00Z",
    started_at: "2026-06-05T08:14:00Z",
    finished_at: null
  },
  {
    job_id: "ing_300",
    document_id: "doc_101",
    document_version_id: "ver_101_2",
    status: "completed_with_warnings",
    parser_profile: "controlled_document",
    ocr_enabled: false,
    chunking_strategy: "legal_structured",
    embedding_profile: "default",
    created_at: "2026-06-04T13:20:00Z",
    started_at: "2026-06-04T13:22:00Z",
    finished_at: "2026-06-04T13:29:00Z"
  },
  {
    job_id: "ing_299",
    document_id: "doc_104",
    document_version_id: "ver_104_4",
    status: "failed",
    parser_profile: "plain_text",
    ocr_enabled: false,
    chunking_strategy: "semantic",
    embedding_profile: "default",
    created_at: "2026-06-03T15:00:00Z",
    started_at: "2026-06-03T15:01:00Z",
    finished_at: "2026-06-03T15:02:00Z"
  }
];

export const mockReports: IngestionReport[] = [
  {
    job_id: "ing_300",
    status: "completed_with_warnings",
    documents_processed: 1,
    pages_processed: 42,
    chunks_created: 152,
    tables_detected: 6,
    ocr_used: false,
    warnings: [
      {
        code: "TABLE_LOW_CONFIDENCE",
        message: "Tabulka na strane 12 byla extrahovana s nizkou jistotou."
      }
    ],
    errors: []
  },
  {
    job_id: "ing_299",
    status: "failed",
    documents_processed: 0,
    pages_processed: 0,
    chunks_created: 0,
    tables_detected: 0,
    ocr_used: false,
    warnings: [],
    errors: [
      {
        code: "UNSUPPORTED_ENCODING",
        message: "Vstupni soubor nebylo mozne nacist jako text ani PDF."
      }
    ]
  }
];

export const mockAuditEvents: AuditEvent[] = [
  {
    audit_event_id: "audit_501",
    actor_id: "user_123",
    event_type: "rag.query.executed",
    resource_type: "rag_query",
    resource_id: "query_900",
    severity: "info",
    correlation_id: "corr_501",
    metadata: {
      service: "rag-retrieval-service",
      citation_count: 2,
      confidence: "high"
    },
    created_at: "2026-06-05T08:34:00Z"
  },
  {
    audit_event_id: "audit_500",
    actor_id: "user_209",
    event_type: "document.version.created",
    resource_type: "document_version",
    resource_id: "ver_102_1",
    severity: "info",
    correlation_id: "corr_500",
    metadata: {
      document_id: "doc_102",
      classification: "restricted"
    },
    created_at: "2026-06-05T07:40:00Z"
  },
  {
    audit_event_id: "audit_499",
    actor_id: "svc-ingestion",
    event_type: "ingestion.job.failed",
    resource_type: "ingestion_job",
    resource_id: "ing_299",
    severity: "warning",
    correlation_id: "corr_499",
    metadata: {
      error_code: "UNSUPPORTED_ENCODING",
      document_id: "doc_104"
    },
    created_at: "2026-06-03T15:02:00Z"
  }
];

export const mockRagAnswer: RagAnswer = {
  query_id: "query_900",
  answer:
    "Pro schvalovani vyjimky je nutne zalozit zadost s odkazem na dotceny dokument, dolozit riziko a predat ji gestorovi k revizi. Bez citovatelneho zdroje nema byt odpoved povazovana za normativni.",
  confidence: "high",
  citations: [
    {
      document_id: "doc_102",
      document_version_id: "ver_102_1",
      document_title: "Metodika vyjimek z bezpecnostnich pravidel",
      version_label: "0.9",
      document_version: "0.9",
      section_path: ["Cl. 4", "Odst. 2"],
      page_number: 7,
      chunk_id: "chunk_789"
    },
    {
      document_id: "doc_101",
      document_version_id: "ver_101_2",
      document_title: "Smernice pro spravu rizene dokumentace",
      version_label: "2.0",
      document_version: "2.0",
      section_path: ["Cl. 3", "Workflow"],
      page_number: 4,
      chunk_id: "chunk_812"
    }
  ],
  warnings: [],
  used_chunks: ["chunk_789", "chunk_812"],
  missing_information: null
};

export function cloneMock<T>(value: T): T {
  return structuredClone(value);
}
