# Clean Pilot C4 Base Images

The C4 registry freeze keeps `--pull` enabled. Reproducibility is provided by
digest-pinned application base images, not by relying on mutable registry tags.

| Runtime | Immutable base image |
| --- | --- |
| Python services | `python:3.12-slim@sha256:e5c9fa26ffb76e11e0f054f30dc2523a2f9693f0c36c0cf1e39b27e152d899fc` |
| Web service | `node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3` |

Changing either digest is a runtime-input change. It requires a reviewed C4
bundle, a repeated fixed-point C4 verification, and fresh disposable C6
rehearsals before it can be accepted as Clean Pilot evidence.
