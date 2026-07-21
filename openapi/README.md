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

The governed AIIP upload bridge is an explicit exception to generic web-route
indexing. Its preflight, binary content, and confirm operations are maintained
as closed schemas in the generator because they carry two independent
identities, immutable governance lineage, signed upload headers, and an opaque
post-persistence receipt. Do not replace those operations with `GenericJson` or
move `X-AKL-Upload-Token` out of preflight `required_headers`.

`openapi/director-copilot-domain-tools.v1.json` is a separate binding OpenAPI
contract implemented by Budget and ProjectFlow and consumed by the AKB server.
It deliberately is not merged into `openapi/openapi.json`: AKB does not host
that source-application endpoint. Its schemas and conformance fixtures are in
`contracts/director-copilot/v1/`.
