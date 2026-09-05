#!/usr/bin/env python3
"""Fail-closed proof for the local application-test container boundary."""

from __future__ import annotations

import os
from pathlib import Path
import socket


FORBIDDEN_ENV_MARKERS = (
    "TOKEN",
    "SECRET",
    "PASSWORD",
    "PRIVATE_KEY",
    "DATABASE_URL",
    "AWS_ACCESS_KEY",
)
PRODUCTION_HOSTS = ("docker.home.cz", "stratos.zeleznalady.cz")


def main() -> int:
    forbidden_names = sorted(
        name
        for name in os.environ
        if any(marker in name.upper() for marker in FORBIDDEN_ENV_MARKERS)
    )
    if forbidden_names:
        raise SystemExit("LOCAL_CI_FORBIDDEN_ENVIRONMENT")

    forbidden_paths = (
        Path("/source/.env"),
        Path("/source/.env.local"),
        Path("/var/run/docker.sock"),
        Path.home() / ".ssh",
        Path.home() / ".docker",
    )
    if any(path.exists() for path in forbidden_paths):
        raise SystemExit("LOCAL_CI_FORBIDDEN_MOUNT")

    for host in PRODUCTION_HOSTS:
        try:
            socket.getaddrinfo(host, 443)
        except OSError:
            continue
        raise SystemExit("LOCAL_CI_NETWORK_IS_NOT_ISOLATED")

    print("local_container_boundary=passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
