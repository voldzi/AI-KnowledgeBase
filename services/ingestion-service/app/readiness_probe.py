from __future__ import annotations

import json
import sys
from urllib import parse, request

from app.config import ConfigError, load_settings


def main() -> int:
    try:
        settings = load_settings()
        headers: dict[str, str]
        if settings.auth_mode in {"disabled", "mock"}:
            headers = {
                "X-AKL-Subject": "service-account-svc-ingestion",
                "X-AKL-Service-Client-ID": "svc-ingestion",
                "X-AKL-Roles": "service_ingestion",
            }
        else:
            if (
                settings.registry_service_client_id != "svc-ingestion"
                or not settings.registry_service_token_url
                or not settings.registry_service_client_secret
            ):
                return 1
            token_request = request.Request(
                settings.registry_service_token_url,
                data=parse.urlencode(
                    {
                        "grant_type": "client_credentials",
                        "client_id": settings.registry_service_client_id,
                        "client_secret": settings.registry_service_client_secret,
                    }
                ).encode("utf-8"),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            with request.urlopen(token_request, timeout=3) as response:
                payload = json.loads(response.read())
            access_token = payload.get("access_token") if isinstance(payload, dict) else None
            if not isinstance(access_token, str) or not access_token:
                return 1
            headers = {"Authorization": f"Bearer {access_token}"}

        probe = request.Request(
            "http://127.0.0.1:8090/ready",
            headers=headers,
            method="GET",
        )
        with request.urlopen(probe, timeout=3) as response:
            return 0 if response.status == 200 else 1
    except (ConfigError, OSError, ValueError):
        return 1


if __name__ == "__main__":
    sys.exit(main())
