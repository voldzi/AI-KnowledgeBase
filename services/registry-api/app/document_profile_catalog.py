"""Validation backed by the same shipped catalog used by the generic UI."""
from copy import deepcopy
from datetime import date
from functools import lru_cache
import json
from pathlib import Path
from urllib.parse import urlsplit


@lru_cache(maxsize=1)
def _catalog():
    return json.loads(Path(__file__).with_name("document_profile_catalog.json").read_text())


def document_profile_catalog():
    return deepcopy(_catalog())


def document_profile(profile_id: str, revision: str):
    for profile in _catalog()["profiles"]:
        if profile["id"] == profile_id and profile["revision"] == revision:
            return deepcopy(profile)
    raise ValueError("Unknown document profile or catalog revision")


def validate_profile_root(root):
    profile = document_profile(root.profile.id, root.profile.revision)
    if root.document_type not in profile["documentTypes"]:
        raise ValueError("Document type is not permitted by its profile")
    if root.provenance.source_system not in profile["sourceSystems"]:
        raise ValueError("Source system is not permitted by its profile")
    if profile["family"] == "official_public_reference" and not any(
        author.kind in {"organization", "external_authority"} for author in root.authorship
    ):
        raise ValueError("Official references require an identified issuing authority")


def validate_profile_policy(profile_reference, binding):
    policy = document_profile(profile_reference.id, profile_reference.revision).get("protection", {})
    if ("handlingClasses" in policy and binding.handling_class not in policy["handlingClasses"]
        or "tlpValues" in policy and binding.tlp not in policy["tlpValues"]):
        raise ValueError("Protection policy does not match the approved document profile shape")


def _valid_value(field, value):
    if value is None:
        return field["nullable"]
    if field["type"] == "reference_list":
        return (isinstance(value, list) and bool(value) and all(isinstance(item, str) and item.strip() == item and bool(item) for item in value)
                and len(set(value)) == len(value))
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        return False
    if field["type"] == "date":
        try:
            return date.fromisoformat(value).isoformat() == value
        except ValueError:
            return False
    if field["type"] == "enum":
        return value in {option["value"] for option in field["options"]}
    if field["type"] == "https_url":
        parsed = urlsplit(value)
        return bool(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password)
    return field["type"] in {"reference", "string"}


def validate_profile_version(root, version):
    profile = document_profile(root.profile.id, root.profile.revision)
    lifecycle = version.lifecycle
    if lifecycle.mode not in profile["lifecycle"]["modes"]:
        raise ValueError("Lifecycle mode is not permitted by the document profile")
    if profile["lifecycle"]["reviewAtRequired"] and lifecycle.review_at is None:
        raise ValueError("This document profile requires an explicit review date")
    if (lifecycle.review_rule_id not in profile["lifecycle"]["reviewRuleIds"]
        or lifecycle.retention_rule_id not in profile["lifecycle"]["retentionRuleIds"]):
        raise ValueError("Unknown review or retention rule for the document profile")
    evidence = version.domain_evidence
    expected_keys = {field["name"] for field in profile["domainFields"]} | {"family"}
    if set(evidence) != expected_keys or evidence.get("family") != profile["family"]:
        raise ValueError("Domain evidence must contain exactly the selected profile fields")
    for field in profile["domainFields"]:
        if not _valid_value(field, evidence[field["name"]]):
            raise ValueError("Document domain evidence contains an invalid or missing field")
    if profile["family"] == "contract":
        if root.provenance.source_system == "STRATOS_BUDGET" and evidence["contractReference"] != root.provenance.source_record_id:
            raise ValueError("Contract evidence must identify the exact registered Budget contract")
        if evidence["executionStatus"] != "draft" and evidence["executionEvidenceReference"] is None:
            raise ValueError("Executed or terminated contracts require source execution evidence")
        record_only = evidence["executionStatus"] in {"draft", "terminated"}
        if record_only != (lifecycle.mode == "record"):
            raise ValueError("Draft or terminated contract evidence is a record; signed/effective contracts require normative dates")
    if profile["family"] == "official_public_reference" and evidence["sourceKind"] == "regulation":
        if lifecycle.mode == "record" or evidence["effectiveDateEvidenceReference"] is None:
            raise ValueError("A regulation requires verified normative effectivity")
