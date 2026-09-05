# AKB OpenAPI Contract

`openapi/openapi.json` is the root JSON-first OpenAPI contract for AKB platform
REST surfaces. It is generated from:

- service-local OpenAPI files in `services/*/openapi.yaml`,
- Next.js web bridge routes in `apps/web/src/app/api/**/route.ts`,
- common AKB system and error schemas maintained by
  `scripts/generate_openapi_index.rb`.

Regenerate after API route or service OpenAPI changes:

```bash
ruby scripts/generate_openapi_index.rb
```

Validate:

```bash
python3 -m json.tool openapi/openapi.json >/dev/null
npx @redocly/cli lint openapi/openapi.json
```

The service-local `openapi.yaml` files are retained during this migration as
legacy source contracts for each service. They must stay aligned with runtime
`/openapi.json`; the root JSON contract is the repository-level binding artifact
used by CI and cross-application integration work.

Director Copilot V2 uses the pinned closed schemas and manifest bundle in
`contracts/director-copilot/v2/` and
`apps/web/src/lib/director-copilot-v2/contracts/`. Source application endpoints
remain external to AKB and are therefore not merged into `openapi/openapi.json`.
