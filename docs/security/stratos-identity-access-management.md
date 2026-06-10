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

- `GET /api/v1/directory/users?query=<text>`
- `POST /api/v1/directory/users/import`
- `GET /api/v1/access/roles`
- `POST /api/v1/access/roles`
- `PATCH /api/v1/access/roles/{role_mapping_id}`

All endpoints require `admin.manage`. In production this is granted by roles such as:

- `stratos_superadmin`
- `stratos_admin`
- `akb_admin`
- legacy/internal `admin`

## Deployment

After deploying the code, run the schema migration:

```bash
cd /srv/akl/repo
docker exec akl-registry-api-1 alembic upgrade head
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

Then restart AKB registry and web:

```bash
cd /srv/akl/repo
docker compose --env-file /srv/akl/env/akl.prod.env -f infra/docker-compose/docker-compose.docker-home.yml up -d registry-api web
```
