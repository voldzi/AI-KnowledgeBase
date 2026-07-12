from intelligence.entities import build_intelligence_metadata, extract_entities


def test_rule_based_entity_extractor_detects_supported_entities() -> None:
    text = (
        "Kontakt: AIIP.Office@example.cz, telefon +420 777 888 999. "
        "Zdroj https://akb.example/doc/123 obsahuje RMO 12/2024 a IP 10.20.30.40. "
        "Platnost od 10. 7. 2026."
    )

    entities = extract_entities(text)
    entity_types = {entity["type"] for entity in entities}
    normalized_values = {entity["normalized_value"] for entity in entities}

    assert {"email", "phone", "url", "document_number", "ipv4", "date"} <= entity_types
    assert "aiip.office@example.cz" in normalized_values
    assert "+420777888999" in normalized_values
    assert "RMO12/2024" in normalized_values
    assert "10.20.30.40" in normalized_values
    assert "10.7.2026" in normalized_values
    assert all(entity["source"] == "chunk_text" for entity in entities)
    assert all(entity["extraction_profile"] == "rule_based_v1" for entity in entities)


def test_intelligence_metadata_is_deduplicated_and_bounded() -> None:
    text = "ops@example.cz ops@example.cz " + " ".join(
        f"RMO {index}/2026" for index in range(1, 70)
    )

    metadata = build_intelligence_metadata(text)

    assert metadata["entity_extraction_profile"] == "rule_based_v1"
    assert metadata["entity_count"] == 48
    assert metadata["entity_values"].count("ops@example.cz") == 1
    assert "email:ops@example.cz" in metadata["entity_pairs"]
    assert "document_number" in metadata["entity_types"]
