import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createApiClients } from "../src/lib/api";
import { createMockContext } from "../src/lib/api/correlation";

const env = {
  AKL_ENV: "test",
  AKL_API_CLIENT_MODE: "mock",
  AKL_AUTH_MODE: "mock"
};

describe("mock API clients", () => {
  it("supports the main document and ingestion flow without network calls", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext();

    const documents = await clients.registry.listDocuments(context);
    const createdVersion = await clients.registry.createDocumentVersion(
      documents[0].document_id,
      {
        version_label: "2.1",
        valid_from: "2026-07-01",
        valid_to: null,
        source_file_uri: "s3://akl-documents/doc_101/ver_101_3/file.pdf",
        change_summary: "Mock test version."
      },
      context
    );
    const job = await clients.ingestion.createJob(
      {
        document_id: documents[0].document_id,
        document_version_id: createdVersion.document_version_id,
        source_file_uri: createdVersion.source_file_uri,
        parser_profile: "controlled_document",
        ocr_enabled: true,
        chunking_strategy: "legal_structured",
        embedding_profile: "default"
      },
      context
    );

    assert.ok(documents.length > 0);
    assert.equal(createdVersion.document_id, documents[0].document_id);
    assert.equal(job.status, "queued");
  });

  it("returns citation-backed RAG answers and no-answer states", async () => {
    const clients = createApiClients({ env });
    const context = createMockContext();

    const answer = await clients.rag.query(
      {
        subject_id: context.subjectId,
        query: "Jak se schvaluje vyjimka?",
        filters: {
          document_types: ["directive"],
          only_valid: true,
          classification_max: "internal",
          tags: []
        },
        answer_mode: "normative_with_citations",
        max_chunks: 4
      },
      context
    );

    const noAnswer = await clients.rag.query(
      {
        subject_id: context.subjectId,
        query: "Neznamy specialni postup",
        filters: {
          document_types: ["directive"],
          only_valid: true,
          classification_max: "internal",
          tags: []
        },
        answer_mode: "normative_with_citations",
        max_chunks: 4
      },
      context
    );

    assert.ok(answer.citations.length > 0);
    assert.equal(noAnswer.confidence, "insufficient_source");
    assert.equal(noAnswer.citations.length, 0);
  });
});
