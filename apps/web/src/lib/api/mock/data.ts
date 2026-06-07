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
    assignments: [
      {
        assignment_id: "assign_doc_101_owner",
        document_id: "doc_101",
        role: "owner",
        subject_type: "user",
        subject_id: "user_123",
        display_label: "Jan Novak",
        is_primary: true,
        active: true,
        sla_days: 5,
        escalation_subject_type: "unit",
        escalation_subject_id: "IT",
        escalation_label: "IT governance",
        assigned_by: "admin_1",
        assigned_at: "2026-05-20T08:10:00Z",
        last_audit_event_id: "audit_500",
        metadata: {},
        created_at: "2026-05-20T08:10:00Z",
        updated_at: "2026-06-04T12:30:00Z"
      },
      {
        assignment_id: "assign_doc_101_gestor",
        document_id: "doc_101",
        role: "gestor",
        subject_type: "unit",
        subject_id: "IT",
        display_label: "IT",
        is_primary: true,
        active: true,
        sla_days: 3,
        escalation_subject_type: "group",
        escalation_subject_id: "it-governance",
        escalation_label: "IT governance board",
        assigned_by: "admin_1",
        assigned_at: "2026-05-20T08:10:00Z",
        last_audit_event_id: "audit_500",
        metadata: {},
        created_at: "2026-05-20T08:10:00Z",
        updated_at: "2026-06-04T12:30:00Z"
      }
    ],
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
    assignments: [
      {
        assignment_id: "assign_doc_102_owner",
        document_id: "doc_102",
        role: "owner",
        subject_type: "user",
        subject_id: "user_209",
        display_label: "Security owner",
        is_primary: true,
        active: true,
        sla_days: 5,
        escalation_subject_type: "unit",
        escalation_subject_id: "Security",
        escalation_label: "Security management",
        assigned_by: "admin_1",
        assigned_at: "2026-05-25T09:35:00Z",
        last_audit_event_id: "audit_500",
        metadata: {},
        created_at: "2026-05-25T09:35:00Z",
        updated_at: "2026-06-05T07:45:00Z"
      },
      {
        assignment_id: "assign_doc_102_reviewer",
        document_id: "doc_102",
        role: "reviewer",
        subject_type: "group",
        subject_id: "security-reviewers",
        display_label: "Security reviewers",
        is_primary: true,
        active: true,
        sla_days: 3,
        escalation_subject_type: "unit",
        escalation_subject_id: "Security",
        escalation_label: "Security management",
        assigned_by: "admin_1",
        assigned_at: "2026-05-25T09:35:00Z",
        last_audit_event_id: "audit_500",
        metadata: {},
        created_at: "2026-05-25T09:35:00Z",
        updated_at: "2026-06-05T07:45:00Z"
      },
      {
        assignment_id: "assign_doc_102_approver",
        document_id: "doc_102",
        role: "approver",
        subject_type: "user",
        subject_id: "user_301",
        display_label: "Security approver",
        is_primary: true,
        active: true,
        sla_days: 2,
        escalation_subject_type: "group",
        escalation_subject_id: "security-leads",
        escalation_label: "Security leads",
        assigned_by: "admin_1",
        assigned_at: "2026-05-25T09:35:00Z",
        last_audit_event_id: "audit_500",
        metadata: {},
        created_at: "2026-05-25T09:35:00Z",
        updated_at: "2026-06-05T07:45:00Z"
      },
      {
        assignment_id: "assign_doc_102_auditor",
        document_id: "doc_102",
        role: "auditor",
        subject_type: "group",
        subject_id: "internal-audit",
        display_label: "Internal audit",
        is_primary: false,
        active: true,
        sla_days: 7,
        escalation_subject_type: "unit",
        escalation_subject_id: "Compliance",
        escalation_label: "Compliance",
        assigned_by: "admin_1",
        assigned_at: "2026-05-25T09:35:00Z",
        last_audit_event_id: "audit_500",
        metadata: {},
        created_at: "2026-05-25T09:35:00Z",
        updated_at: "2026-06-05T07:45:00Z"
      }
    ],
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
    assignments: [
      {
        assignment_id: "assign_doc_103_owner",
        document_id: "doc_103",
        role: "owner",
        subject_type: "user",
        subject_id: "user_123",
        display_label: "Knowledge owner",
        is_primary: true,
        active: true,
        sla_days: 5,
        escalation_subject_type: "unit",
        escalation_subject_id: "Knowledge Ops",
        escalation_label: "Knowledge Ops",
        assigned_by: "admin_1",
        assigned_at: "2026-06-01T11:00:00Z",
        last_audit_event_id: null,
        metadata: {},
        created_at: "2026-06-01T11:00:00Z",
        updated_at: "2026-06-03T16:20:00Z"
      },
      {
        assignment_id: "assign_doc_103_gestor",
        document_id: "doc_103",
        role: "gestor",
        subject_type: "unit",
        subject_id: "Knowledge Ops",
        display_label: "Knowledge Ops",
        is_primary: true,
        active: true,
        sla_days: 3,
        escalation_subject_type: "unit",
        escalation_subject_id: "Knowledge Ops",
        escalation_label: "Knowledge Ops",
        assigned_by: "admin_1",
        assigned_at: "2026-06-01T11:00:00Z",
        last_audit_event_id: null,
        metadata: {},
        created_at: "2026-06-01T11:00:00Z",
        updated_at: "2026-06-03T16:20:00Z"
      }
    ],
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
    assignments: [
      {
        assignment_id: "assign_doc_104_owner",
        document_id: "doc_104",
        role: "owner",
        subject_type: "user",
        subject_id: "user_144",
        display_label: "Operations owner",
        is_primary: true,
        active: false,
        sla_days: 5,
        escalation_subject_type: "unit",
        escalation_subject_id: "Operations",
        escalation_label: "Operations",
        assigned_by: "admin_1",
        assigned_at: "2025-12-12T14:00:00Z",
        last_audit_event_id: null,
        metadata: {},
        created_at: "2025-12-12T14:00:00Z",
        updated_at: "2026-02-10T10:10:00Z"
      }
    ],
    created_at: "2025-12-12T14:00:00Z",
    updated_at: "2026-02-10T10:10:00Z"
  },
  {
    document_id: "doc_105",
    title: "DOCX preview fixture",
    document_type: "manual",
    status: "draft",
    classification: "internal",
    owner_id: "user_123",
    owner: "user_123",
    gestor_unit: "Knowledge Ops",
    tags: ["viewer", "docx"],
    assignments: [],
    created_at: "2026-06-04T10:00:00Z",
    updated_at: "2026-06-04T10:00:00Z"
  },
  {
    document_id: "doc_106",
    title: "XLSX preview fixture",
    document_type: "attachment",
    status: "draft",
    classification: "internal",
    owner_id: "user_123",
    owner: "user_123",
    gestor_unit: "Knowledge Ops",
    tags: ["viewer", "xlsx"],
    assignments: [],
    created_at: "2026-06-04T10:10:00Z",
    updated_at: "2026-06-04T10:10:00Z"
  },
  {
    document_id: "doc_107",
    title: "PPTX preview fixture",
    document_type: "project_documentation",
    status: "draft",
    classification: "internal",
    owner_id: "user_123",
    owner: "user_123",
    gestor_unit: "Knowledge Ops",
    tags: ["viewer", "pptx"],
    assignments: [],
    created_at: "2026-06-04T10:20:00Z",
    updated_at: "2026-06-04T10:20:00Z"
  },
  {
    document_id: "doc_108",
    title: "PDF bbox preview fixture",
    document_type: "manual",
    status: "draft",
    classification: "internal",
    owner_id: "user_123",
    owner: "user_123",
    gestor_unit: "Knowledge Ops",
    tags: ["viewer", "pdf", "bbox"],
    assignments: [],
    created_at: "2026-06-04T10:30:00Z",
    updated_at: "2026-06-04T10:30:00Z"
  },
  {
    document_id: "doc_109",
    title: "Markdown preview fixture",
    document_type: "manual",
    status: "draft",
    classification: "internal",
    owner_id: "user_123",
    owner: "user_123",
    gestor_unit: "Knowledge Ops",
    tags: ["viewer", "markdown"],
    assignments: [],
    created_at: "2026-06-04T10:40:00Z",
    updated_at: "2026-06-04T10:40:00Z"
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
    document_version_id: "ver_108_1",
    document_id: "doc_108",
    version_label: "0.1",
    status: "draft",
    valid_from: "2026-07-15",
    valid_to: null,
    source_file_uri: "s3://akl-documents/doc_108/ver_108_1/file.pdf",
    file_hash: "sha256:b95ee5fa232b27128e77c887c73804824d4f56d0e8cb8246bdcd1ec3e3a40637",
    change_summary: "PDF fixture pro bbox locator.",
    created_at: "2026-06-04T10:30:00Z",
    published_at: null
  },
  {
    document_version_id: "ver_109_1",
    document_id: "doc_109",
    version_label: "0.1",
    status: "draft",
    valid_from: "2026-07-15",
    valid_to: null,
    source_file_uri: "s3://akl-documents/doc_109/ver_109_1/source.md",
    file_hash: "sha256:aa07de942e1d2b06cdaad0e979e6fe2205134ba11f0fdbfe96b2a17b6963c703",
    change_summary: "Markdown fixture pro nativni preview.",
    created_at: "2026-06-04T10:40:00Z",
    published_at: null
  },
  {
    document_version_id: "ver_105_1",
    document_id: "doc_105",
    version_label: "0.1",
    status: "draft",
    valid_from: "2026-07-15",
    valid_to: null,
    source_file_uri: "s3://akl-documents/doc_105/ver_105_1/source.docx",
    file_hash: "sha256:b9154dde4b097b5b17ce9d6a4d7410b6cae4406aff563396d74f308c35217819",
    change_summary: "DOCX fixture pro nativni preview.",
    created_at: "2026-06-04T10:00:00Z",
    published_at: null
  },
  {
    document_version_id: "ver_106_1",
    document_id: "doc_106",
    version_label: "0.1",
    status: "draft",
    valid_from: "2026-07-15",
    valid_to: null,
    source_file_uri: "s3://akl-documents/doc_106/ver_106_1/source.xlsx",
    file_hash: "sha256:d8084e488ffa355ba16b19f64b704d6a5ca32aa5c3b16d898de88d7d7d4069d0",
    change_summary: "XLSX fixture pro nativni preview.",
    created_at: "2026-06-04T10:10:00Z",
    published_at: null
  },
  {
    document_version_id: "ver_107_1",
    document_id: "doc_107",
    version_label: "0.1",
    status: "draft",
    valid_from: "2026-07-15",
    valid_to: null,
    source_file_uri: "s3://akl-documents/doc_107/ver_107_1/source.pptx",
    file_hash: "sha256:e31f18bc2760a36f3ae68dc4ad86be4cadbc0b02d8e138f2f8f074e020d1d26e",
    change_summary: "PPTX fixture pro nativni preview.",
    created_at: "2026-06-04T10:20:00Z",
    published_at: null
  },
  {
    document_version_id: "ver_103_2",
    document_id: "doc_103",
    version_label: "0.2",
    status: "draft",
    valid_from: "2026-07-10",
    valid_to: null,
    source_file_uri: "s3://akl-documents/doc_103/ver_103_2/scan.svg",
    file_hash: "sha256:9a68f67b97f92f0752dd5e48b50c773dceca5b9e5880909493743453c0ea0072",
    change_summary: "OCR scan onboarding checklistu pro overeni image vieweru.",
    created_at: "2026-06-04T09:20:00Z",
    published_at: null
  },
  {
    document_version_id: "ver_103_1",
    document_id: "doc_103",
    version_label: "0.1",
    status: "draft",
    valid_from: "2026-07-01",
    valid_to: null,
    source_file_uri: "s3://akl-documents/doc_103/ver_103_1/source.md",
    file_hash: "sha256:1b9027635f805bbd7d75eedd4b895536cb1a4c1eb5627085ec9f6007aaf8a83b",
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
    audit_event_id: "audit_507",
    actor_id: "knowledge_owner",
    event_type: "chunk.indexed",
    resource_type: "document_chunk",
    resource_id: "chunk_md_109",
    severity: "info",
    correlation_id: "corr_507",
    metadata: {
      document_id: "doc_109",
      document_version_id: "ver_109_1",
      chunk_id: "chunk_md_109",
      source_file_uri: "s3://akl-documents/doc_109/ver_109_1/source.md"
    },
    created_at: "2026-06-04T10:45:00Z"
  },
  {
    audit_event_id: "audit_506",
    actor_id: "knowledge_owner",
    event_type: "chunk.indexed",
    resource_type: "document_chunk",
    resource_id: "chunk_pdf_108",
    severity: "info",
    correlation_id: "corr_506",
    metadata: {
      document_id: "doc_108",
      document_version_id: "ver_108_1",
      chunk_id: "chunk_pdf_108",
      page_number: 1,
      source_file_uri: "s3://akl-documents/doc_108/ver_108_1/file.pdf"
    },
    created_at: "2026-06-04T10:40:00Z"
  },
  {
    audit_event_id: "audit_505",
    actor_id: "knowledge_owner",
    event_type: "chunk.indexed",
    resource_type: "document_chunk",
    resource_id: "chunk_ocr_103",
    severity: "info",
    correlation_id: "corr_505",
    metadata: {
      document_id: "doc_103",
      document_version_id: "ver_103_2",
      chunk_id: "chunk_ocr_103",
      page_number: 1,
      source_file_uri: "s3://akl-documents/doc_103/ver_103_2/scan.svg"
    },
    created_at: "2026-06-04T09:35:00Z"
  },
  {
    audit_event_id: "audit_504",
    actor_id: "user_209",
    event_type: "citation.opened",
    resource_type: "document_chunk",
    resource_id: "chunk_789",
    severity: "info",
    correlation_id: "corr_504",
    metadata: {
      document_id: "doc_102",
      document_version_id: "ver_102_1",
      page_number: 7,
      source_file_uri: "s3://akl-documents/doc_102/ver_102_1/file.pdf"
    },
    created_at: "2026-06-05T09:05:00Z"
  },
  {
    audit_event_id: "audit_503",
    actor_id: "admin_1",
    event_type: "document.assignments.updated",
    resource_type: "document",
    resource_id: "doc_102",
    severity: "info",
    correlation_id: "corr_503",
    metadata: {
      document_id: "doc_102",
      assignment_count: 4,
      roles: "approver,auditor,owner,reviewer"
    },
    created_at: "2026-06-05T08:55:00Z"
  },
  {
    audit_event_id: "audit_502",
    actor_id: "admin_1",
    event_type: "workflow.task.approve",
    resource_type: "workflow_task",
    resource_id: "task_review_doc_102",
    severity: "info",
    correlation_id: "corr_502",
    metadata: {
      document_id: "doc_102",
      document_version_id: "ver_102_1",
      action: "approve",
      assignment_role: "reviewer"
    },
    created_at: "2026-06-05T08:50:00Z"
  },
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
