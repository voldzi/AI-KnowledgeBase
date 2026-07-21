# Zadání pro ProjectFlow: read-only nástroj Copilota ředitele

## Endpoint a tool

Implementovat:

```text
POST /api/v1/integrations/akb/domain-tools/execute
tool_id = projectflow.project_delivery_snapshot.v1
```

Jiný `tool_id` endpoint odmítne 422. Endpoint je deterministický, read-only a
bez LLM nebo zpětného volání AKB.

## Autorizační pravidla

- transport: pouze `svc-akb-director-copilot` s ProjectFlow API audience;
- aktér: samostatný ověřený bearer a aktuální STRATOS projection;
- capability: `projectflow:read`;
- centrální scope: `project`, `portfolio` nebo `organization`;
- ProjectFlow musí navíc ověřit lokální členství/viditelnost každého projektu;
- Information Policy a stav projektu se aplikují před sestavením response.

Organization nebo portfolio scope nesmí obejít lokální projektové členství,
pokud je pro čtení projektu závazné.

## Datový read-model

Jedna položka představuje projekt a používá shodné kanonické ID jako Budget:

```text
entity_type = project
canonical_id = stratos:project:<canonical-project-id>
```

Povinná minimální fakta:

| Klíč | Typ | Význam |
| --- | --- | --- |
| `milestone.max_delay_days` | `duration_days` | nejvyšší kladné zpoždění aktivního kritického milníku |
| `project.status` | `text` | kanonický stav projektu |
| `project.schedule_status` | `text` | stav harmonogramu, například on_track/at_risk/delayed |
| `milestone.next_due_date` | `date` | nejbližší relevantní termín, pokud existuje |

Tyto čtyři klíče tvoří uzavřený katalog verze nástroje. Další fakta se bez nové
kontraktní verze nevracejí.

Zpoždění `0` znamená bez aktuálně zpožděného milníku. Metodika kritického
milníku a baseline musí být verzovaná v `source_version`.

`document_context_tags` musí obsahovat `project:<id>` a případné stabilní tagy
navázaných smluv nebo výstupů. `deep_link` vede na bezpečný detail projektu.

## Policy

Každá položka vrací exact policy binding/version/hash, handling class, audience
a známé obligations. Policy nesmí být odvozena z požadovaného scope ani z
hlaviček AKB.

Obligations musí být hodnotou z úplného centrálního Information Policy V2
katalogu. AKB zachovává jejich sjednocení ve snapshotu, povinně audituje výsledek
a při nesplnitelné AI/recipient/originator/PAP obligation nevolá model.

## Akceptační testy ProjectFlow

1. `projectflow-request.json` vrátí response kompatibilní s
   `projectflow-complete.json`.
2. Odebrání `projectflow:read` okamžitě deny.
3. Centrální project scope bez lokálního členství nevrátí projekt.
4. Portfolio/organization dotaz nevrátí projekt mimo lokálně povolenou množinu.
5. `canonical_id` je byte-identical s Budgetem pro stejný projekt.
6. Změna baseline nebo milníku změní `source_version` a `as_of`.
7. Neznámá policy, obligation nebo scope skončí fail closed.
8. 100+ projektů používá cursor a nepřekročí response limit.
9. Log neobsahuje názvy projektů, fakta, popisy, tokeny ani raw response.
