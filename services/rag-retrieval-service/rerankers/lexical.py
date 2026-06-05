from __future__ import annotations

from app.schemas import RetrievedChunk
from retrievers.scoring import hybrid_score, sparse_score


class LexicalReranker:
    def rerank(self, *, query: str, chunks: list[RetrievedChunk], limit: int) -> list[RetrievedChunk]:
        reranked: list[RetrievedChunk] = []
        for chunk in chunks:
            lexical = sparse_score(query, chunk.text)
            base = chunk.score
            rerank = hybrid_score(base, lexical, 0.65)
            metadata = {
                **chunk.metadata,
                "rerank_score": round(rerank, 6),
                "rerank_method": "lexical_overlap",
            }
            reranked.append(chunk.model_copy(update={"score": round(rerank, 6), "metadata": metadata}))

        return sorted(reranked, key=lambda item: (item.score, item.metadata.get("sparse_score", 0)), reverse=True)[
            :limit
        ]
