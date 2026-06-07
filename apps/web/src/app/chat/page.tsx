import { PageHeader } from "@/components/page-header";
import { KnowledgeChat } from "@/features/chat/knowledge-chat";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { ApiClientError, type RagAnswer } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContext();
  const answer = await loadInitialAnswer(
    clients.rag.query(
      {
        subject_id: context.subjectId,
        query: "Jak se schvaluje vyjimka z bezpecnostnich pravidel?",
        filters: {
          document_types: ["directive", "methodology"],
          only_valid: true,
          classification_max: "internal",
          tags: []
        },
        answer_mode: "normative_with_citations",
        max_chunks: 8
      },
      context
    )
  );

  return (
    <>
      <PageHeader
        title={{ cs: "Znalostní chat", en: "Knowledge chat" }}
        description={{
          cs: "RAG dotazovací plocha s viditelnou důvěryhodností, varováními a citacemi u každé odpovědi se zdroji.",
          en: "RAG query surface with visible confidence, warnings and citations for every sourced answer."
        }}
      />
      <KnowledgeChat initialAnswer={answer} />
    </>
  );
}

async function loadInitialAnswer(request: Promise<RagAnswer>): Promise<RagAnswer> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiClientError && error.status >= 500) {
      return unavailableInitialAnswer(error);
    }
    throw error;
  }
}

function unavailableInitialAnswer(error: ApiClientError): RagAnswer {
  return {
    query_id: error.traceId,
    answer: "Znalostní vyhledávání je dočasně nedostupné. Stránka je načtená, zkuste dotaz znovu později nebo ověřte stav RAG/Qdrant služby.",
    confidence: "insufficient_source",
    citations: [],
    warnings: [error.code || "RAG_UPSTREAM_UNAVAILABLE"],
    used_chunks: [],
    missing_information: error.message
  };
}
