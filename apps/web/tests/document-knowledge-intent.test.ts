import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveDocumentKnowledgeIntent } from "../src/lib/assistant/document-knowledge-intent";

describe("document knowledge intent", () => {
  it("recognizes common employee procedures without matching one exact question", () => {
    const result = resolveDocumentKnowledgeIntent("Jak si nastavím dovolenou?");

    assert.equal(result.intent, "procedure");
    assert.equal(result.answerMode, "find_procedure");
    assert.equal(result.taskOriented, true);
    assert.ok(result.retrievalHints.includes("čerpání dovolené"));
  });

  it("recognizes a form location request", () => {
    const result = resolveDocumentKnowledgeIntent("Kde najdu formulář na zahraniční cestu?");

    assert.equal(result.intent, "resource");
    assert.equal(result.answerMode, "find_procedure");
    assert.ok(result.retrievalHints.includes("cestovní příkaz"));
  });

  it("recognizes generic manuals and application procedures", () => {
    const manual = resolveDocumentKnowledgeIntent(
      "Kde najdu uživatelskou příručku docházkového systému?",
    );
    const login = resolveDocumentKnowledgeIntent(
      "Jak se přihlásím do docházkového systému?",
    );

    assert.equal(manual.intent, "resource");
    assert.equal(manual.answerMode, "find_procedure");
    assert.equal(login.intent, "procedure");
    assert.equal(login.answerMode, "find_procedure");
  });

  it("recognizes a documented support channel without assuming its name", () => {
    const result = resolveDocumentKnowledgeIntent("Kde mám napsat problém s IT?");

    assert.equal(result.intent, "support_channel");
    assert.equal(result.answerMode, "find_procedure");
    assert.ok(result.retrievalHints.includes("hlášení problému"));
  });

  it("selects specialized owner, deadline, and obligation answer modes", () => {
    assert.equal(
      resolveDocumentKnowledgeIntent("Kdo schvaluje pracovní cestu?").answerMode,
      "find_owner",
    );
    assert.equal(
      resolveDocumentKnowledgeIntent("Do kdy musím odevzdat cestovní příkaz?").answerMode,
      "extract_deadlines",
    );
    assert.equal(
      resolveDocumentKnowledgeIntent("Jaké doklady potřebuji k žádosti?").answerMode,
      "extract_obligations",
    );
  });

  it("inherits task continuity only for a referential follow-up", () => {
    const context = {
      document_knowledge_state: {
        intent: "procedure",
      },
    };

    const followUp = resolveDocumentKnowledgeIntent("A kde to najdu?", context);
    const newTopic = resolveDocumentKnowledgeIntent("Co znamená NIS2?", context);

    assert.equal(followUp.intent, "procedure");
    assert.equal(followUp.inherited, true);
    assert.equal(newTopic.intent, "general");
    assert.equal(newTopic.inherited, false);
  });

  it("does not contaminate a concrete new employee topic with the previous task", () => {
    const resolution = resolveDocumentKnowledgeIntent("Jak si nastavím dovolenou?", {
      document_knowledge_state: {
        intent: "owner",
        answer_mode: "find_owner",
      },
    });

    assert.equal(resolution.intent, "procedure");
    assert.equal(resolution.inherited, false);
    assert.ok(!resolution.retrievalHints.includes("gestor"));
  });

  it("does not interpret every who-question as a document owner lookup", () => {
    const eligibility = resolveDocumentKnowledgeIntent("Kdo může čerpat studijní volno?");
    const obligation = resolveDocumentKnowledgeIntent("Kdo musí schválit pracovní cestu?");

    assert.equal(eligibility.intent, "general");
    assert.equal(obligation.intent, "obligation");
  });

  it("keeps analytical questions in the general manager mode", () => {
    const result = resolveDocumentKnowledgeIntent("Jak je možno vylepšit finanční plán?");

    assert.equal(result.intent, "general");
    assert.equal(result.answerMode, "manager_brief");
  });

  it("adds safe SSP equivalents to document retrieval without changing intent", () => {
    const result = resolveDocumentKnowledgeIntent("Jaké informace máme k VZMR?");

    assert.equal(result.intent, "general");
    assert.ok(result.retrievalHints.includes("Veřejná zakázka malého rozsahu"));
    assert.ok(result.retrievalHints.length <= 12);
  });
});
