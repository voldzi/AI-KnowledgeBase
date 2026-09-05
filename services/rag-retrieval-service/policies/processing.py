from app.schemas import RetrievedChunk


def policy_metadata(chunks: list[RetrievedChunk]) -> dict[str, object]:
    """Carry the same source restrictions to composition and verification."""
    rank = {"PUBLIC": 0, "INTERNAL": 1, "PROJECT_MANAGEMENT": 2, "RESTRICTED": 3}
    handling_class = "PUBLIC"
    obligations: set[str] = set()
    binding_ids: set[str] = set()
    policy_hashes: set[str] = set()
    for chunk in chunks:
        summary = chunk.metadata.get("policy_summary")
        if isinstance(summary, dict):
            candidate = summary.get("handlingClass")
            if isinstance(candidate, str) and rank.get(candidate, -1) > rank[handling_class]:
                handling_class = candidate
            raw_obligations = summary.get("obligations")
            if isinstance(raw_obligations, list):
                obligations.update(item for item in raw_obligations if isinstance(item, str))
        binding_id = chunk.metadata.get("policy_binding_id")
        policy_hash = chunk.metadata.get("policy_hash")
        if isinstance(binding_id, str) and binding_id.strip():
            binding_ids.add(binding_id.strip())
        if isinstance(policy_hash, str) and policy_hash.strip():
            policy_hashes.add(policy_hash.strip())
    if not binding_ids:
        return {}
    return {
        "policy_version": "information-policy-2.0.0",
        "policy_binding_ids": sorted(binding_ids),
        "policy_hashes": sorted(policy_hashes),
        "handling_class": handling_class,
        "legal_classification": "NONE",
        "obligations": sorted(obligations),
    }
