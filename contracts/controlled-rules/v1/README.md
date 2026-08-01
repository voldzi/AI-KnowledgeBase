# AKB Controlled Rules API v1

The contract exposes effective-dated, human-verified controlled rules to
Budget without granting access to AKB databases or general document APIs.

## Endpoint

```text
GET /api/v1/integrations/controlled-rules-read/rules
    ?domain=public_procurement
    &valid_on=YYYY-MM-DD
```

The caller is the dedicated OIDC client `svc-budget-controlled-rules`. Its
token must have the Registry audience, role `service_budget_rules_read`, and
the sole route grant `controlled-rules-read`. The upload client
`stratos-akb-service` is intentionally not accepted.

`valid_on` is mandatory and always means the date of the planned operation.
The caller cannot request approved, draft, inactive, or otherwise
non-consumable packages.

## Outcomes

- `complete`: verified rules are usable without an operational warning.
- `complete_with_warning`: rules remain usable, but a known bounded warning,
  currently an overdue source review, must be displayed to the user.
- `no_data`: no verified rule may be used; Budget must not substitute a local
  numeric constant.
- `conflict`: source integrity, precedence, catalog, or citation validation
  failed; no rule is returned as a decision input.

Budget must additionally require `decision_eligible=true`, a known contract
revision, a known warning set, a valid `source_version`, at least one rule, and
an exact citation for every rule. Unknown fields, statuses, warnings, reason
codes, or normative keys fail closed.

## Audit

AKB records `controlled_rules.read.returned` and bounded
`controlled_rules.read.denied` events with service client id, domain,
`valid_on`, outcome, item count, source version, reason code and correlation
id. Tokens, document content, quoted text and rule values are never copied to
audit metadata.

## Contract files

- `controlled-rules-response.schema.json`: closed response schema.
- `controlled-rules-error.schema.json`: Registry error envelope.
- `public-procurement-normative-catalog.json`: canonical keys and aliases.
- `fixtures/`: acceptance examples for consumers.

The catalog is a controlled vocabulary. Extraction may propose a value, but a
public-procurement package cannot become valid until every accepted or edited
rule uses a registered key with the matching category.

This consumer revision accepts only gestor-reviewed extraction profile
`controlled_document_rules_v1` revision `3`. Earlier generated-key profiles
remain historical evidence and are never translated into consumer rules.
