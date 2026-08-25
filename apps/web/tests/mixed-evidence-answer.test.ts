import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composeMixedEvidenceAssistantResponse } from "../src/lib/assistant/mixed-evidence-answer";
import type { AssistantChatResponse, Citation } from "../src/lib/types";

describe("mixed evidence assistant answer", () => {
  it("keeps verified live facts and cited guidance in separate sections", () => {
    const response = composeMixedEvidenceAssistantResponse({
      directorResponse: assistantResponse({
        answer: "Plán je 10 mil. Kč a skutečnost 8 mil. Kč.",
        confidence: "high",
      }),
      documentResponse: assistantResponse({
        answer: "Metodika požaduje pravidelně vyhodnocovat odchylky.",
        citations: [citation()],
        confidence: "high",
      }),
      documentUnavailable: false,
      goal: "recommend",
      language: "cs",
    });

    assert.equal(response.response_type, "answer");
    assert.match(response.answer ?? "", /Ověřená živá data/);
    assert.match(response.answer ?? "", /Citované dokumentové podklady/);
    assert.match(response.answer ?? "", /Jak výsledek číst/);
    assert.equal(response.citations.length, 1);
    assert.equal(response.confidence, "high");
    assert.deepEqual(response.current_context.mixed_evidence, {
      live_data: "available",
      document_guidance: "available",
      live_data_substituted_by_documents: false,
    });
  });

  it("allows cited general guidance while explicitly preserving missing live data", () => {
    const response = composeMixedEvidenceAssistantResponse({
      directorResponse: assistantResponse({
        response_type: "no_answer",
        answer: "Budget pro rok 2026 nevrátil odpovídající data.",
        confidence: "insufficient_source",
      }),
      documentResponse: assistantResponse({
        answer: "Metodika doporučuje čtvrtletní revizi.",
        citations: [citation()],
      }),
      documentUnavailable: false,
      goal: "recommend",
      language: "cs",
    });

    assert.equal(response.response_type, "answer");
    assert.equal(response.confidence, "insufficient_source");
    assert.match(response.answer ?? "", /Budget pro rok 2026 nevrátil/);
    assert.match(response.answer ?? "", /Není tvrzením o aktuálním plánu/);
    assert.ok(response.warnings.includes("LIVE_DATA_NOT_REPLACED_BY_DOCUMENTS"));
  });

  it("does not invent a recommendation when cited document evidence is missing", () => {
    const response = composeMixedEvidenceAssistantResponse({
      directorResponse: assistantResponse({ answer: "Plán je 10 mil. Kč." }),
      documentResponse: assistantResponse({
        response_type: "no_answer",
        answer: "Citovatelný zdroj nebyl nalezen.",
        citations: [],
        confidence: "insufficient_source",
      }),
      documentUnavailable: false,
      goal: "recommend",
      language: "cs",
    });

    assert.equal(response.response_type, "answer");
    assert.equal(response.confidence, "insufficient_source");
    assert.match(response.answer ?? "", /Bez citované metodiky z nich AKB nedovozuje doporučení/);
    assert.equal(response.citations.length, 0);
    assert.ok(response.warnings.includes("DOCUMENT_EVIDENCE_INSUFFICIENT"));
  });

  it("returns an actionable insufficient-source response when both source classes fail", () => {
    const response = composeMixedEvidenceAssistantResponse({
      directorResponse: assistantResponse({
        response_type: "no_answer",
        answer: "Živý zdroj nevrátil odpovídající data.",
        confidence: "insufficient_source",
      }),
      documentResponse: null,
      documentUnavailable: true,
      goal: "diagnose",
      language: "cs",
    });

    assert.equal(response.response_type, "no_answer");
    assert.equal(response.confidence, "insufficient_source");
    assert.ok(response.follow_up_questions.length > 0);
    assert.match(response.recommended_action ?? "", /Upřesněte období/);
    assert.ok(response.warnings.includes("DOCUMENT_EVIDENCE_UNAVAILABLE"));
  });

  it("does not present a scenario as a calculated forecast", () => {
    const response = composeMixedEvidenceAssistantResponse({
      directorResponse: assistantResponse({ answer: "Aktuální plán je 10 mil. Kč." }),
      documentResponse: assistantResponse({
        answer: "Metodika popisuje schvalování změn plánu.",
        citations: [citation()],
      }),
      documentUnavailable: false,
      goal: "scenario",
      language: "cs",
    });

    assert.match(response.answer ?? "", /AKB nevypočítalo hypotetické částky/);
    assert.match(response.answer ?? "", /řízený výpočetní model/);
  });
});

function assistantResponse(
  overrides: Partial<AssistantChatResponse> = {},
): AssistantChatResponse {
  return {
    response_type: "answer",
    conversation_id: "conv-test",
    answer: "Ověřená odpověď.",
    message: null,
    questions: [],
    why_needed: null,
    current_context: { answer_source: "test" },
    citations: [],
    follow_up_questions: [],
    suggested_actions: [],
    report_artifacts: [],
    confidence: "high",
    warnings: [],
    missing_information: null,
    recommended_action: null,
    ...overrides,
  };
}

function citation(): Citation {
  return {
    document_id: "doc-1",
    document_version_id: "ver-1",
    document_title: "Metodika finančního plánování",
    version_label: "1.0",
    document_version: "1.0",
    section_path: ["Řízení odchylek"],
    page_number: 4,
    chunk_id: "chunk-1",
  };
}
