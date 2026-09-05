# Central SSO and managed identity: local verification

Date: 2026-08-27. Branch: `codex/managed-stratos-identity`.

This evidence covers the AKB change containing this document. It is not a
production release, IAM acceptance or a browser installation test. Production
configuration, Keycloak, STRATOS, directories and client registrations were
not changed. The default issuer mode remains `external_oidc`.

## Baseline and scope

- Gitea `origin` was fetched before closing the change.
- Starting AKB HEAD: `894129bd9305903d75d1947aef6d2be58b9e761e`.
- Verified `origin/main`: `dbe8042be7581defc315fd9966b19204a496a5d4`.
- `check_working_baseline.py --base origin/main`: passed. Production ancestry
  was not checked because this change is not being deployed.
- The other document-workflow worktree was left untouched.
- Contract inputs: STRATOS `docs/64_MULTI_SOURCE_IDENTITY.md` and
  `docs/65_CENTRAL_SSO.md`. Neither the Director domain bundle nor the
  Controlled Rules public contract was changed.
- Runtime changes concern AKB web, standalone Chat, Registry and RAG identity
  boundaries. No STRATOS application or runner was modified.

## Executed checks

| Check | Result |
| --- | --- |
| Web: all `tests/*.test.ts`, Node test runner with `react-server` and `tsx` | 649 passed; no failures or skips |
| Web TypeScript: `pnpm exec tsc --noEmit` | Passed |
| Registry: `python -m pytest -q` | 315 passed, 1 skipped |
| RAG retrieval: `python -m pytest -q` | 247 passed |
| Root preflight tool tests | 3 passed |
| `tests/shell/test_web_docker_entrypoint.sh` | Passed for external and managed credentials, missing-file rejection and private file modes |
| Docker Home Compose with its example env: `config --quiet` | Passed; no container started |
| `ruby scripts/generate_openapi_index.rb --check` | Passed |
| `bash scripts/validate-skeleton.sh` | Passed |
| Shell syntax and `git diff --check` | Passed |

The Python suites used a temporary Python 3.12 environment with the repository
dependencies. Tests reported existing Starlette/httpx, HTTP 422 and Alembic
deprecation warnings. The skipped test is
`test_postgres_0018_backfills_and_enforces_document_version_identity`: its
isolated PostgreSQL admin URL was not configured. It must not be pointed at
the production database to remove the skip.

Reproduction commands, from the corresponding working directories:

```sh
# apps/web
pnpm exec node --conditions=react-server --import tsx --test tests/*.test.ts
pnpm exec tsc --noEmit

# services/registry-api, then services/rag-retrieval-service
python -m pytest -q

# Repository root
python3 -m unittest discover -s tests -p test_managed_identity_preflight.py
bash tests/shell/test_web_docker_entrypoint.sh
docker compose --env-file infra/docker-compose/docker-home.env.example \
  -f infra/docker-compose/docker-compose.docker-home.yml config --quiet
ruby scripts/generate_openapi_index.rb --check
bash scripts/validate-skeleton.sh
sh -n apps/web/docker-entrypoint.sh
git diff --check
```

## Security and lifecycle evidence

Tests use locally generated RSA keys, synthetic tokens and stubbed provider,
projection and Registry responses. Registry tests exercise its HTTP API and
database logic using isolated test fixtures, not a production directory.

| Boundary | Verified behavior | Test locations |
| --- | --- | --- |
| Configuration | Explicit approved HTTPS managed issuer; unchanged external default; no legacy secret sent to managed browser endpoints | Web `managed-config`, `managed-identity` |
| Token validation | Access and ID token separation, RS256 signature, issuer, audiences, expiry, subject and nonce; mixed service/human claims rejected | Web `managed-identity`; Registry/RAG `test_managed_identity` |
| Central policy | Exact signed boolean/start; 30d/90d or 8h/24h; no deadline reset by application entry, refresh or `auth_time`; expired policy rejected | Web `central-sso-policy`, `managed-session` |
| Navigation | No local remember checkbox; one normal PKCE redirect; error/logout retry guard; foreign Origin and invalid callback rejected | Web `auth-login-route`, `auth-sso-route`, `managed-auth-routes` |
| Opaque session | Hashed selector, encrypted tokens, app/client/issuer binding, session-only or remaining-lifetime cookie | Web `server-session`, `managed-session` |
| Revocation races | Compare-and-swap, policy downgrade, same-identity silent synchronization, no overwrite of expired/revoked session; selective and global revocation | Web `managed-session`; Registry `test_managed_sessions_audit`, `test_web_sessions` |
| Authorization | Fresh projection on each relevant call; removed grant or unavailable projection denies; no static role fallback | Web `managed-identity`, `access-projection`; Registry/RAG `test_managed_identity` |
| Identity isolation | Equal login/email does not merge subjects; changed source/client rejected; external audience cannot inherit employee-directive scope | Web and Registry managed identity tests |
| Director | Three distinct, signed, single-audience service tokens; exact client and read scope; no Registry privilege; manifest cache/in-flight lookup separated by identity configuration | Web `managed-identity`, `director-copilot-v2-client` |
| Rules reader | Exact audience, service role, scope, trusted client and separate route grant; other routes rejected | Registry `test_managed_identity` |
| Audit and tracing | Fixed internal audit schema, HMAC-only write, forbidden content fields rejected without echo; sensitive trace fields and identity routes removed | Registry `test_managed_sessions_audit`, `test_safe_telemetry`; web `safe-trace-exporter` |

No real token, cookie, password or document was used as a log-test sentinel.
Synthetic sentinel checks passed; this is not a claim that production proxy,
APM or SIEM storage was inspected. Local correlation values identify synthetic
fixtures only and are not presented as production acceptance evidence.

## Remaining acceptance gates

1. Build the affected immutable production images and run required Gitea CI
   on the final release candidate. Local unit tests and Compose rendering do
   not replace these checks.
2. Provision a distinct Chat token-encryption key before any deployment of
   this candidate. Verify both BFF keys and the internal Registry HMAC secret
   outside Git and test rotation/re-login in an isolated environment.
3. IAM must confirm the actual Keycloak version, deployed
   `stratos-session-policy-mapper`, both browser registrations, signed claims
   and unchanged central-start value through refresh and application switches.
4. Exercise real PostgreSQL refresh/logout concurrency and the isolated
   migration fixture. The SQLite test results do not prove PostgreSQL lock
   behavior under concurrent processes.
5. Test AKB, Budget and standalone Chat transitions in the same browser/profile,
   both remember choices, logout, account switching, denied callbacks, network
   outages and an isolated PWA's first login. No real browser/PWA result is
   claimed in this report.
6. Test real directory disable, group/grant removal and source outage. The
   fifteen-minute AKB identity interval is not a directory synchronization SLA.
7. Before a full managed migration, agree managed worker credentials for
   Ingestion, Governance, Evaluation, LLM Gateway and RAG-to-Registry. These
   identities are not defined in the supplied browser/Director/rules contract;
   unknown service tokens remain denied. Do not reuse user or Director tokens.
8. Inspect proxy/application/exporter/audit storage using synthetic test
   identities, then obtain joint approval before production activation.

Detailed settings, IAM handoff and rollout order:
[central SSO runbook](../security/managed-identity.md).
