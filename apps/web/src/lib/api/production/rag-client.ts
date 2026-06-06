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

import type { AklFetch } from "../http-client";
import { requestJson } from "../http-client";

export class ProductionRagClient implements RagApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher?: AklFetch
  ) {}

  query(request: RagQueryRequest, context: ApiRequestContext): Promise<RagAnswer> {
    return requestJson<RagAnswer>({
      service: "rag-retrieval-service",
      operation: "query",
      baseUrl: this.baseUrl,
      path: "/rag/query",
      method: "POST",
      body: request,
      context,
      fetcher: this.fetcher
    });
  }

  openCitation(chunkId: string, context: ApiRequestContext): Promise<SourceContext> {
    return requestJson<SourceContext>({
      service: "rag-retrieval-service",
      operation: "openCitation",
      baseUrl: this.baseUrl,
      path: `/citations/${encodeURIComponent(chunkId)}/open?subject_id=${encodeURIComponent(context.subjectId)}`,
      method: "GET",
      context,
      fetcher: this.fetcher
    });
  }

  openAssistantCitation(chunkId: string, context: ApiRequestContext): Promise<SourceContext> {
    return requestJson<SourceContext>({
      service: "rag-retrieval-service",
      operation: "openAssistantCitation",
      baseUrl: this.baseUrl,
      path: `/assistant/citations/${encodeURIComponent(chunkId)}/open?subject_id=${encodeURIComponent(context.subjectId)}`,
      method: "GET",
      context,
      fetcher: this.fetcher
    });
  }

  assistantChat(request: AssistantChatRequest, context: ApiRequestContext): Promise<AssistantChatResponse> {
    return requestJson<AssistantChatResponse>({
      service: "rag-retrieval-service",
      operation: "assistantChat",
      baseUrl: this.baseUrl,
      path: "/assistant/chat",
      method: "POST",
      body: request,
      context,
      fetcher: this.fetcher
    });
  }

  assistantClarify(request: AssistantChatRequest, context: ApiRequestContext): Promise<AssistantChatResponse> {
    return requestJson<AssistantChatResponse>({
      service: "rag-retrieval-service",
      operation: "assistantClarify",
      baseUrl: this.baseUrl,
      path: "/assistant/clarify",
      method: "POST",
      body: request,
      context,
      fetcher: this.fetcher
    });
  }

  assistantSuggestions(context: ApiRequestContext, language: AklLanguage = "cs"): Promise<AssistantSuggestionsResponse> {
    return requestJson<AssistantSuggestionsResponse>({
      service: "rag-retrieval-service",
      operation: "assistantSuggestions",
      baseUrl: this.baseUrl,
      path: language === "cs" ? "/assistant/suggestions" : `/assistant/suggestions?response_language=${encodeURIComponent(language)}`,
      method: "GET",
      context,
      fetcher: this.fetcher
    });
  }

  assistantConversation(conversationId: string, context: ApiRequestContext): Promise<AssistantConversationResponse> {
    return requestJson<AssistantConversationResponse>({
      service: "rag-retrieval-service",
      operation: "assistantConversation",
      baseUrl: this.baseUrl,
      path: `/assistant/conversations/${encodeURIComponent(conversationId)}`,
      method: "GET",
      context,
      fetcher: this.fetcher
    });
  }
}
