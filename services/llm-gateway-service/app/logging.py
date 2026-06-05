from __future__ import annotations

import logging
import sys

from app.config import Settings
from app.context import get_correlation_id, get_request_id


class CorrelationFilter(logging.Filter):
    def __init__(self, service_name: str) -> None:
        super().__init__()
        self.service_name = service_name

    def filter(self, record: logging.LogRecord) -> bool:
        record.service_name = self.service_name
        record.request_id = get_request_id()
        record.correlation_id = get_correlation_id()
        return True


def configure_logging(settings: Settings) -> None:
    root = logging.getLogger()
    root.setLevel(settings.log_level)

    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s service=%(service_name)s "
        "request_id=%(request_id)s correlation_id=%(correlation_id)s "
        "logger=%(name)s %(message)s"
    )

    if not root.handlers:
        handler = logging.StreamHandler(sys.stdout)
        root.addHandler(handler)

    for handler in root.handlers:
        handler.setFormatter(formatter)
        handler.addFilter(CorrelationFilter(settings.service_name))
