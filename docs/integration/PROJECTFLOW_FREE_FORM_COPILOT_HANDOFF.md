# ProjectFlow handoff: free-form Copilot source extension

## Goal

Extend the existing governed read-only ProjectFlow domain tool so AKB can
answer natural project questions with human-readable, current and
source-authorized facts. ProjectFlow remains the source of truth and final PEP.

## Required next contract version

Add bounded, typed facts for:

- project display name, code and approved aliases;
- portfolio/program identity;
- progress and status summary;
- milestone counts, delayed milestone names and dates;
- active risks, issues and dependencies with severity;
- responsible owner/manager display names;
- capacity summary and last material change time.

The contract must retain:

- canonical project id, source version, `as_of`, deep link and policy lineage;
- current actor reauthorization, `projectflow:read`, central effective scopes
  and local ProjectFlow membership;
- deterministic filters for project ids, portfolio ids, time range, status and
  bounded pagination;
- no free SQL, no prompt execution and no embedded LLM;
- strict response-size and item limits;
- exact positive, partial, not-authorized and unavailable fixtures.

## Entity catalog

ProjectFlow should expose an authorized, bounded entity lookup for project
code, display name and approved aliases. AKB uses it only for entity
resolution; the lookup must not reveal projects outside the actor's effective
scope and local membership.

## Access requirement

An organization or portfolio scope does not currently replace local project
membership. If leadership must see all current and future projects, STRATOS
and ProjectFlow should implement a managed portfolio-observer group or another
explicit policy-backed membership mechanism. AKB must not synthesize this
access.

## Acceptance fixtures

Provide fixtures for:

- organization-wide portfolio observer;
- one-project reader;
- ambiguous project alias;
- project outside scope;
- revoked local membership;
- partial portfolio page;
- stale source version;
- unavailable Access Governance.
