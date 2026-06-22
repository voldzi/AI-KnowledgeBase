import type {
  ApiRequestContext,
  AssistantChatRequest,
  AssistantChatResponse,
  AssistantConversationResponse,
  AssistantSuggestionsResponse,
  RagAnswer,
  RagApiClient,
  RagQueryRequest,
  SourceContext
} from "@/lib/types";
import type { AklLanguage } from "@/lib/language";

import { cloneMock, mockRagAnswer } from "./data";

export class MockRagClient implements RagApiClient {
  async query(request: RagQueryRequest, _context: ApiRequestContext): Promise<RagAnswer> {
    const answer = cloneMock(mockRagAnswer);
    if (request.query.toLowerCase().includes("neznamy") || request.query.toLowerCase().includes("unknown")) {
      return {
        query_id: "query_no_answer",
        answer: "K dotazu nebyl nalezen dostatečně důvěryhodný zdroj.",
        confidence: "insufficient_source",
        citations: [],
        warnings: ["NO_AUTHORIZED_SOURCE"],
        used_chunks: [],
        missing_information: "Chybí citovatelný chunk v povolených dokumentech."
      };
    }
    return {
      ...answer,
      answer: `${answer.answer} Dotaz: "${request.query}".`
    };
  }

  async openCitation(chunkId: string, _context: ApiRequestContext): Promise<SourceContext> {
    if (chunkId === "chunk_md_109") {
      return {
        chunk_id: chunkId,
        document_id: "doc_109",
        document_version_id: "ver_109_1",
        document_title: "Markdown preview fixture",
        source_file_uri: "s3://akl-documents/doc_109/ver_109_1/source.md",
        source_mime_type: "text/markdown",
        source_file_name: "source.md",
        source_size_bytes: 1024,
        source_sha256: "sha256:aa07de942e1d2b06cdaad0e979e6fe2205134ba11f0fdbfe96b2a17b6963c703",
        viewer_mode: "markdown",
        location: {
          page_number: null,
          slide_number: null,
          sheet_name: null,
          row_number: null,
          column_name: null,
          section_path: ["Citation target"],
          section_title: "Citation target",
          paragraph_number: "1",
          char_start: 0,
          char_end: 76,
          bbox: null
        },
        chunk_text: "Markdown citation text should be highlighted inside the rendered document.",
        before_text: "",
        after_text: "viewer_mode: markdown",
        warnings: []
      };
    }

    if (chunkId === "chunk_pdf_108") {
      return {
        chunk_id: chunkId,
        document_id: "doc_108",
        document_version_id: "ver_108_1",
        document_title: "PDF bbox preview fixture",
        source_file_uri: "s3://akl-documents/doc_108/ver_108_1/file.pdf",
        source_mime_type: "application/pdf",
        source_file_name: "file.pdf",
        source_size_bytes: 1024,
        source_sha256: "sha256:b95ee5fa232b27128e77c887c73804824d4f56d0e8cb8246bdcd1ec3e3a40637",
        viewer_mode: "pdf",
        location: {
          page_number: 1,
          slide_number: null,
          sheet_name: null,
          row_number: null,
          column_name: null,
          section_path: ["Fixture"],
          section_title: "Fixture",
          paragraph_number: "2",
          char_start: 24,
          char_end: 74,
          bbox: {
            x: 11.8,
            y: 10.2,
            width: 65,
            height: 7.5
          }
        },
        chunk_text: "PDF citation area for controlled document preview.",
        before_text: "PDF source fixture title",
        after_text: "",
        warnings: []
      };
    }

    if (chunkId === "chunk_ocr_103") {
      return {
        chunk_id: chunkId,
        document_id: "doc_103",
        document_version_id: "ver_103_2",
        document_title: "Prirucka pro onboarding znalostni baze",
        source_file_uri: "s3://akl-documents/doc_103/ver_103_2/scan.svg",
        source_mime_type: "image/svg+xml",
        source_file_name: "scan.svg",
        source_size_bytes: 4096,
        source_sha256: "sha256:9a68f67b97f92f0752dd5e48b50c773dceca5b9e5880909493743453c0ea0072",
        viewer_mode: "ocr",
        location: {
          page_number: 1,
          slide_number: null,
          sheet_name: null,
          row_number: null,
          column_name: null,
          section_path: ["Prvni kontrola"],
          section_title: "Prvni kontrola",
          paragraph_number: "1",
          char_start: 0,
          char_end: 68,
          bbox: {
            x: 13.3,
            y: 34.6,
            width: 73.4,
            height: 4.2
          }
        },
        chunk_text: "Spravce musi potvrdit vlastnika, gestora a workflow task.",
        before_text: "Prvni kontrola",
        after_text: "Kontrola se zapisuje do workflow tasku a auditni stopy.",
        warnings: []
      };
    }

    return {
      chunk_id: chunkId,
      document_id: "doc_102",
      document_version_id: "ver_102_1",
      document_title: "Metodika vyjimek z bezpecnostnich pravidel",
      source_file_uri: "s3://akl-documents/doc_102/ver_102_1/source.md",
      source_mime_type: "text/markdown",
      source_file_name: "source.md",
      source_size_bytes: 2048,
      source_sha256: "sha256:mock",
      viewer_mode: "markdown",
      location: {
        page_number: 7,
        slide_number: null,
        sheet_name: null,
        row_number: null,
        column_name: null,
        section_path: ["Cl. 4", "Odst. 2"],
        section_title: "Vyjimky",
        paragraph_number: "2",
        char_start: 120,
        char_end: 310,
        bbox: null
      },
      chunk_text: "Vyjimku ze smernice schvaluje gestor dokumentu po posouzeni dopadu.",
      before_text: "",
      after_text: "",
      warnings: []
    };
  }

  openAssistantCitation(chunkId: string, context: ApiRequestContext): Promise<SourceContext> {
    return this.openCitation(chunkId, context);
  }

  async assistantChat(request: AssistantChatRequest, _context: ApiRequestContext): Promise<AssistantChatResponse> {
    const conversationId = request.conversation_id ?? "conv_mock";
    const message = request.message.toLowerCase();
    const language = request.response_language ?? "cs";
    if ((message.includes("přístup") || message.includes("pristup") || message.includes("access") || message.includes("permission")) && !request.context?.system) {
      return {
        response_type: "clarification_needed",
        conversation_id: conversationId,
        answer: null,
        message: language === "en" ? "I need to clarify the question." : "Potřebuji upřesnit dotaz.",
        questions: [
          {
            id: "system",
            question: language === "en" ? "Which system is this about?" : "O který systém se jedná?",
            type: "free_text",
            options: []
          },
          {
            id: "request_type",
            question: language === "en"
              ? "Is this a new access request, permission change, or access removal?"
              : "Jde o nový přístup, změnu oprávnění nebo odebrání přístupu?",
            type: "single_choice",
            options: language === "en"
              ? ["new access", "permission change", "access removal"]
              : ["nový přístup", "změna oprávnění", "odebrání přístupu"]
          }
        ],
        why_needed: language === "en"
          ? "The question can refer to multiple procedures."
          : "Dotaz může znamenat více různých postupů.",
        current_context: request.context ?? {},
        citations: [],
        follow_up_questions: [],
        suggested_actions: [{ label: "Doplnit odpovědi", action_type: "continue_conversation", target: conversationId }],
        report_artifacts: [],
        confidence: null,
        warnings: [],
        missing_information: null,
        recommended_action: null
      };
    }

    const citations = cloneMock(mockRagAnswer.citations);
    const wantsReport = /(sestav|report|tabulk|excel|xlsx|export|přehled|prehled)/i.test(request.message);
    return {
      response_type: "answer",
      conversation_id: conversationId,
      answer: language === "en"
        ? "The document owner approves an exception to the directive after impact assessment. The answer is supported by the source below."
        : "Výjimku ze směrnice schvaluje gestor dokumentu po posouzení dopadu. Odpověď je podložená citací níže.",
      message: null,
      questions: [],
      why_needed: null,
      current_context: request.context ?? {},
      citations,
      follow_up_questions: language === "en"
        ? ["Do you want to open the source document?", "Do you want to ask a follow-up question?"]
        : ["Chcete otevřít zdrojový dokument?", "Chcete položit doplňující otázku?"],
      suggested_actions: [
        ...(wantsReport ? [{ label: language === "en" ? "Export report" : "Exportovat sestavu", action_type: "export_report", target: "rpt_mock" }] : []),
        { label: language === "en" ? "Open source" : "Otevřít zdroj", action_type: "open_citation", target: null },
        { label: language === "en" ? "Ask follow-up" : "Položit doplňující dotaz", action_type: "ask_followup", target: null }
      ],
      report_artifacts: wantsReport ? [
        {
          artifact_id: "rpt_mock",
          title: language === "en" ? "AKB answer report" : "Sestava z odpovědi AKB",
          description: language === "en"
            ? "The table report is built from the cited answer."
            : "Tabulková sestava je vytvořená z citované odpovědi.",
          columns: [
            { key: "topic", label: language === "en" ? "Topic" : "Téma", type: "text" },
            { key: "summary", label: language === "en" ? "Summary" : "Závěr", type: "text" },
            { key: "document", label: language === "en" ? "Source document" : "Zdrojový dokument", type: "text" },
            { key: "page", label: language === "en" ? "Page" : "Strana", type: "number" }
          ],
          rows: citations.map((citation, index) => ({
            row_id: `report_row_${index + 1}`,
            cells: {
              topic: request.message,
              summary: language === "en"
                ? "The document owner approves an exception after impact assessment."
                : "Výjimku schvaluje gestor dokumentu po posouzení dopadu.",
              document: citation.document_title,
              page: citation.page_number
            },
            citations: [citation]
          })),
          export_formats: ["xlsx", "pdf"],
          source_citation_count: citations.length,
          warnings: ["REPORT_LIMITED_TO_CITED_SOURCES"]
        }
      ] : [],
      confidence: "medium",
      warnings: [],
      missing_information: null,
      recommended_action: null
    };
  }

  assistantClarify(request: AssistantChatRequest, context: ApiRequestContext): Promise<AssistantChatResponse> {
    return this.assistantChat(request, context);
  }

  async assistantSuggestions(_context: ApiRequestContext, language: AklLanguage = "cs"): Promise<AssistantSuggestionsResponse> {
    if (language === "en") {
      return {
        suggestions: [
          { label: "New access", prompt: "How do I request new access?", domain: "Service Desk", audience: "employee" },
          { label: "Report incident", prompt: "How do I report an incident?", domain: "IT Operations", audience: "employee" },
          { label: "Who approves exception", prompt: "Who approves an exception to a directive?", domain: "Documentation", audience: "employee" },
          { label: "Platform architecture", prompt: "What is the architecture of the AKB platform?", domain: "Documentation", audience: "employee" }
        ]
      };
    }
    return {
      suggestions: [
        { label: "Nový přístup", prompt: "Jak požádám o nový přístup?", domain: "Service Desk", audience: "employee" },
        { label: "Nahlásit incident", prompt: "Jak nahlásím incident?", domain: "IT Operations", audience: "employee" },
        { label: "Kdo schvaluje výjimku", prompt: "Kdo schvaluje výjimku ze směrnice?", domain: "Dokumentace", audience: "employee" },
        { label: "Architektura platformy", prompt: "Jaká je architektura AKB platformy?", domain: "Dokumentace", audience: "employee" }
      ]
    };
  }

  async assistantConversation(conversationId: string, _context: ApiRequestContext): Promise<AssistantConversationResponse> {
    return {
      conversation_id: conversationId,
      status: "ephemeral",
      messages: [],
      warnings: ["CONVERSATION_HISTORY_NOT_PERSISTED"]
    };
  }
}
