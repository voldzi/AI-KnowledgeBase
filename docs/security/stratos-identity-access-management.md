# STRATOS Identity And Access Management In AKB

AKB follows `STRATOS/docs/35_STRATOS_APP_INTEGRATION_GUIDE.md` for user and access management.

## Runtime Model

- Keycloak realm: `stratos`
- Directory reader client: `stratos-directory-reader`
- Browser never calls Keycloak Admin API directly.
- AKB web calls its own Next API route: `/api/admin/access`.
- Next API calls Registry API with the current authenticated subject.
- Registry API calls Keycloak Admin API only through a read-only client credentials adapter.

## Registry Tables

AKB keeps application-local identity and role state in PostgreSQL:

- `user_profiles`
  - `user_id` is the Keycloak subject for imported users.
  - `identity_source` is `keycloak`, `oidc`, `local`, or `service`.
  - `enabled` reflects directory state at import time.
  - `status` is `active`, `invited`, `suspended`, or `removed`.
- `role_mappings`
  - stores AKB application roles for users, groups, units, and services.
  - `status` is used instead of physical deletion.
  - changes are written to `audit_events`.

Only active role mappings are used for authorization.

## API Contract

Registry API:

- `GET /api/v1/directory/users?query=<text>` searches directory users for workflow assignment. It requires `workflow.task.write` and does not import users or grant roles.
- `GET /api/v1/admin/directory/users?query=<text>` searches the directory from the administration surface.
- `POST /api/v1/admin/directory/users/import`
- `GET /api/v1/access/roles`
- `POST /api/v1/access/roles`
- `PATCH /api/v1/access/roles/{role_mapping_id}`

Administration endpoints require `admin.manage`. In production this is granted by roles such as:

- `stratos_superadmin`
- `stratos_admin`
- `akb_admin`
- legacy/internal `admin`

## Deployment

Registry schema migrations are part of the immutable exact-SHA release. Do not
run Alembic manually from `/srv/akl/repo` or against an unverified image. The
release workflow creates and validates a Registry PostgreSQL custom dump before
running the one target image head:

```bash
RELEASE_SHA=0123456789abcdef0123456789abcdef01234567
/srv/akl/current/scripts/deploy_docker_home_release.sh --sha "$RELEASE_SHA"
```

To create or update the shared Keycloak directory reader and write its secret into the AKB env file:

```bash
/srv/akl/runbooks/ensure-stratos-directory-reader.sh
```

The script asks for the Keycloak admin password, creates `stratos-directory-reader` if missing, assigns only:

- `realm-management:view-users`
- `realm-management:query-users`

and writes:

```env
AKL_KEYCLOAK_ADMIN_BASE_URL=http://127.0.0.1:8081
AKL_KEYCLOAK_REALM=stratos
STRATOS_KEYCLOAK_DIRECTORY_CLIENT_ID=stratos-directory-reader
STRATOS_KEYCLOAK_DIRECTORY_CLIENT_SECRET=<secret>
```

After changing the persistent Keycloak credential, publish a reviewed commit
when code/config contracts also change and use the immutable release workflow.
A credential-only incident restart must use a separately reviewed secret
rotation procedure pinned to the already running image digests. Do not issue an
ad-hoc Compose `up` from `/srv/akl/repo` or rely on mutable/default image tags.

The full production release and forward-fix rules are in
`docs/OPERATIONS/immutable-docker-home-release.md`.
