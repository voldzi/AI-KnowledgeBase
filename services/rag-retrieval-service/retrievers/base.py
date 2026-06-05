from __future__ import annotations

from typing import Protocol

from app.schemas import RagQueryFilters, RetrievedChunk


class Retriever(Protocol):
    async def retrieve(
        self,
        *,
        query: str,
        filters: RagQueryFilters,
        limit: int,
        query_vector: list[float] | None = None,
    ) -> list[RetrievedChunk]:
        ...

    async def readiness(self) -> str:
        ...
