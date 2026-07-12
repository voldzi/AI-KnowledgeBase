from __future__ import annotations

from app.config import Settings
from indexers.opensearch import CompositeIndexer, OpenSearchIndexer
from indexers.qdrant import QdrantIndexer


def create_indexer(settings: Settings):
    if settings.indexer_targets == ("mock",):
        return QdrantIndexer(settings)

    indexers = []
    if "qdrant" in settings.indexer_targets:
        indexers.append(QdrantIndexer(settings))
    if "opensearch" in settings.indexer_targets:
        indexers.append(OpenSearchIndexer(settings))

    if len(indexers) == 1:
        return indexers[0]
    return CompositeIndexer(tuple(indexers))
