from __future__ import annotations

from app.schemas import RetrievedChunk
from retrievers.scoring import hybrid_score, sparse_score


class LexicalReranker:
    def rerank(self, *, query: str, chunks: list[RetrievedChunk], limit: int) -> list[RetrievedChunk]:
        reranked: list[RetrievedChunk] = []
        for chunk in chunks:
            content_score = sparse_score(query, chunk.text)
            title_score = sparse_score(query, chunk.citation.document_title)
            base = chunk.score
            content_rerank = hybrid_score(base, content_score, 0.65)
            title_bonus = 0.4 * title_score if title_score >= 0.75 else 0.0
            rerank = min(1.0, content_rerank + title_bonus)
            metadata = {
                **chunk.metadata,
                "rerank_score": round(rerank, 6),
                "rerank_method": "source_aware_lexical_overlap",
                "rerank_content_score": round(content_score, 6),
                "rerank_title_score": round(title_score, 6),
            }
            reranked.append(chunk.model_copy(update={"score": round(rerank, 6), "metadata": metadata}))

        return sorted(reranked, key=lambda item: (item.score, item.metadata.get("sparse_score", 0)), reverse=True)[
            :limit
        ]
