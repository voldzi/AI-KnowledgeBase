# Zadání pro Budget: read-only nástroj Copilota ředitele

## Endpoint a tool

Implementovat:

```text
POST /api/v1/integrations/akb/domain-tools/execute
tool_id = budget.project_financial_snapshot.v1
```

Jiný `tool_id` endpoint odmítne 422. Endpoint je pouze read-only a nesmí volat
LLM, AKB ani měnit data.

## Autorizační pravidla

- transport: pouze `svc-akb-director-copilot` s Budget API audience;
- aktér: samostatný ověřený bearer a aktuální STRATOS projection;
- capability: `budget:read`;
- scope: `budget_scope`, `project` nebo `organization` podle aktuální projekce;
- lokální stav Budgetu a Information Policy zůstávají autoritativní;
- response vrátí jen entity, které projdou všemi kontrolami.

`authorized_scope` každé položky musí být přesně jedna z hodnot přijatých v
`requested_scopes`. Skutečný interní resource scope může být užší, ale nesmí
rozšířit požadovaný rozsah.

## Datový read-model

Jedna položka představuje projekt a používá:

```text
entity_type = project
canonical_id = stratos:project:<canonical-project-id>
```

Povinná minimální fakta:

| Klíč | Typ | Význam |
| --- | --- | --- |
| `budget.variance_amount` | `currency` | forecast nebo actual proti schválenému plánu; znaménko musí být zdokumentované |
| `budget.variance_percent` | `percent` | stejná metodika jako částka, pokud je jmenovatel nenulový |
| `budget.plan_amount` | `currency` | schválený plán pro uvedené období |
| `budget.actual_amount` nebo `budget.forecast_amount` | `currency` | hodnota použitá pro výpočet odchylky |

Těchto pět klíčů tvoří uzavřený katalog verze nástroje; nové klíče vyžadují
novou kontraktní verzi. Budget nesmí vracet strukturovaný `contract.risk_level`:
smluvní riziko v tomto scénáři vzniká pouze jako citované zjištění AKB.

Každá finanční hodnota musí mít ISO měnu, období, `as_of`, `source_version` a
quality. Rozdílné měny se nesmějí automaticky sčítat.

`document_context_tags` musí obsahovat nejméně `project:<id>` a pro navázané
smlouvy `contract:<id>`. Do response se neposílají texty smluv ani dokumentová
těla. `deep_link` vede na bezpečnou Budget stránku projektu nebo rozpočtu.

## Policy

Každá položka obsahuje přesný policy binding/version/hash, handling class,
audience a obligations. Neznámou nebo neověřenou policy Budget nevrátí jako
úspěšnou položku. Kontrakt přijímá úplný katalog Information Policy V2:

- `AUDIT_ACCESS`
- `NO_EXTERNAL_AI`
- `LOCAL_PROCESSING_ONLY`
- `NO_PUBLIC_EXPORT`
- `NO_EXPORT`
- `WATERMARK`
- `ENCRYPT_AT_REST`
- `RECIPIENT_CONFIRMATION`
- `ORIGINATOR_APPROVAL`
- `PAP_ENFORCEMENT`

AKB výsledek povinně audituje. Obligations vyžadující potvrzení nebo zvláštní
AI cestu v prvním řezu blokují AI syntézu; AKB je nesmí tiše zahodit.

## Akceptační testy Budgetu

1. `budget-request.json` vrátí response kompatibilní s
   `budget-complete.json`.
2. Odebrání `budget:read` nebo projektu ze scope okamžitě vrátí
   `not_authorized`/403 bez položek.
3. Requested projekt mimo aktuální Budget scope se neobjeví ani v počtu.
4. Stejný `as_of`, source version a request vrací deterministické hodnoty.
5. Neznámá policy nebo obligation skončí fail closed.
6. Odpověď nad 100 položek používá `next_cursor`; nepřekročí 262 144 B.
7. Názvy a popisy obsahující prompt-like text zůstávají pouze daty.
8. Log obsahuje tool ID, source version, počty, stav, request/correlation ID a
   latenci; neobsahuje hodnoty faktů ani tokeny.
