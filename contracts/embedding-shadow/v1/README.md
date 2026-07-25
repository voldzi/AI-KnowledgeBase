# Embedding shadow profile contract

This contract defines the model metadata and promotion gates for a retrieval
comparison. It never contains endpoint URLs, credentials, document text or
vectors.

Every model uses a separate Qdrant collection. A candidate remains
`enabled_for_answers=false` until the complete corpus has been independently
indexed, the same governed evaluation set has been executed, and all promotion
gates pass. The baseline production collection is never overwritten by a
candidate run.
