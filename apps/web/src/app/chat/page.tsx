import { PageHeader } from "@/components/page-header";
import { KnowledgeChat } from "@/features/chat/knowledge-chat";
import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContext();
  const answer = await clients.rag.query(
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
