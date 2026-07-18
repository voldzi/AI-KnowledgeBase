from __future__ import annotations

from opentelemetry import metrics


meter = metrics.get_meter("akb.registry.assistant_history")
history_access_changed_counter = meter.create_counter(
    "akb.assistant.history.messages.redacted",
    description=(
        "Stored assistant messages withheld because their cited source version "
        "is no longer authorized for the current viewer."
    ),
    unit="{message}",
)
history_access_changed_loads_counter = meter.create_counter(
    "akb.assistant.history.loads.redacted",
    description=(
        "Assistant conversation loads containing at least one stored message "
        "withheld after current-access reauthorization."
    ),
    unit="{load}",
)
assistant_feedback_counter = meter.create_counter(
    "akb.assistant.feedback.recorded",
    description="Privacy-safe rating recorded for an assistant response.",
    unit="{feedback}",
)


def record_assistant_history_access_change_metrics(
    redacted_message_count: int,
) -> None:
    if redacted_message_count <= 0:
        return
    attributes = {"reason": "source_access_changed"}
    history_access_changed_counter.add(redacted_message_count, attributes)
    history_access_changed_loads_counter.add(1, attributes)


def record_assistant_feedback_metric(
    *,
    rating: str,
    reason_code: str | None,
) -> None:
    assistant_feedback_counter.add(
        1,
        {
            "rating": rating,
            "reason_code": reason_code or "none",
        },
    )
