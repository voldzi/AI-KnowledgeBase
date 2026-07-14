from __future__ import annotations


class LegacyMutationBlocked(RuntimeError):
    """Raised before a retired legacy caller can perform any work."""


def retire_legacy_mutation(operation: str) -> None:
    """Unconditionally stop a retired mutating caller before it reads or writes."""

    raise LegacyMutationBlocked(
        f"LEGACY_MUTATION_RETIRED: {operation} is retired and cannot run in any environment. "
        "Use the governed application flow."
    )
