import type { ApiRequestContext, RagAnswer, RagApiClient, RagQueryRequest } from "@/lib/types";

import { cloneMock, mockRagAnswer } from "./data";

export class MockRagClient implements RagApiClient {
  async query(request: RagQueryRequest, _context: ApiRequestContext): Promise<RagAnswer> {
    const answer = cloneMock(mockRagAnswer);
    if (request.query.toLowerCase().includes("neznamy") || request.query.toLowerCase().includes("unknown")) {
      return {
        query_id: "query_no_answer",
        answer: "K dotazu nebyl nalezen dostatecne oporyhodny zdroj.",
        confidence: "insufficient_source",
        citations: [],
        warnings: ["NO_AUTHORIZED_SOURCE"],
        used_chunks: [],
        missing_information: "Chybi citovatelny chunk v povolenych dokumentech."
      };
    }
    return {
      ...answer,
      answer: `${answer.answer} Dotaz: "${request.query}".`
    };
  }
}
