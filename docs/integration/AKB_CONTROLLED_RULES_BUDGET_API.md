# AKB Controlled Rules API pro Budget

## Účel

Tento kontrakt je jediný podporovaný read-only vstup Budgetu k ověřeným
pravidlům veřejných zakázek v AKB. Budget nečte databázi AKB, obecné dokumentové
API ani interní gestorovu projekci `/controlled-documentation/rules`.

Endpoint vrací pouze pravidla, která jsou:

- součástí balíčku ve stavu `valid` k požadovanému dni;
- gestorem potvrzená nebo opravená;
- citovaná do přesné verze dokumentu daného balíčku;
- klasifikovaná jako `public` nebo `internal`;
- bez konfliktu a bez zastínění vyšším účinným předpisem;
- registrovaná v uzavřeném katalogu významových klíčů.

## Identita a síťová hranice

STRATOS vytvoří samostatný confidential OIDC client:

```text
client_id: svc-budget-controlled-rules
service-account role: service_budget_rules_read
audience: akl-api
Registry route: controlled-rules-read
```

Klient nesmí mít globální uživatelskou roli, route pro upload, obecné čtení
dokumentů, audit-read ani administraci. Jeho secret je uložen mimo Git a mimo
Compose. Existující `stratos-akb-service` zůstává výhradně upload transportem a
nový endpoint jej vždy odmítne.

AKB produkční konfigurace musí obsahovat přesné mapování:

```text
AKL_REGISTRY_TRUSTED_SERVICE_CLIENT_IDS=...,svc-budget-controlled-rules,...
AKL_REGISTRY_SERVICE_CLIENT_ROUTE_GRANTS=...,svc-budget-controlled-rules=controlled-rules-read,...
```

Endpoint je interní. HAProxy ani veřejný web pro něj nevytvářejí anonymní
přístup.

## Request

```http
GET /api/v1/integrations/controlled-rules-read/rules?domain=public_procurement&valid_on=2026-07-31
Authorization: Bearer <service token>
X-Correlation-ID: <uuid>
Accept: application/json
```

`valid_on` je povinné datum plánované operace. Budget nesmí posílat parametry
pro zahrnutí konceptů, schválených neplatných nebo historicky zrušených
balíčků. Hlavičky `X-AKL-*` ani klientem deklarovaný scope nejsou autorizačním
vstupem.

Spotřebitelský endpoint přijímá výhradně gestorem ověřené výsledky profilu
`controlled_document_rules_v1` revize `3`. Starší generované hashové klíče se
nikdy nepřevedou na rozhodovací pravidlo automaticky; do nového katalogu musí
být pravidlo znovu vytěženo a věcně potvrzeno.

## Uzavřený výsledek

Kontrakt je `akb-controlled-rules-1`, revize `1.0.0`. Přesné JSON Schema,
katalog a fixtures jsou v `contracts/controlled-rules/v1`.

| `status` | `decision_eligible` | Význam pro Budget |
| --- | --- | --- |
| `complete` | `true` | Pravidla lze použít. |
| `complete_with_warning` | `true` | Pravidla lze použít a uživateli se zobrazí upozornění na opožděný přezkum. |
| `no_data` | `false` | Z ověřených pravidel nelze určit výsledek. |
| `conflict` | `false` | Podklady jsou rozporné nebo porušují integritu kontraktu. |

Budget použije pravidla jen při současném splnění všech podmínek:

1. známý kontrakt a revize;
2. známý `status`, warning a katalogový klíč;
3. `decision_eligible=true`;
4. neprázdné `rules` a `sources`;
5. každé pravidlo odkazuje na vrácený `package_id`;
6. citovaná verze je členem stejného balíčku;
7. `source_version` má platný formát a odpověď odpovídá uzavřenému schématu.

Neznámé pole, stav, warning, reason code, katalogová revize nebo klíč znamená
fail-closed. Budget nesmí použít lokální právní limit, poslední úspěšnou hodnotu
ani uživatelem ručně vybraný typ akce jako náhradu aktuálního rozhodovacího
podkladu.

## Stavové a chybové kódy

Úspěšná HTTP odpověď může nést tyto warnings:

```text
NO_APPLICABLE_AUTHORIZED_CONTROLLED_DOCUMENT_PACKAGE
CONTROLLED_RULE_EXTRACTION_V3_REQUIRED
NO_VERIFIED_CONTROLLED_RULES_AVAILABLE
SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE
SOURCE_REVIEW_DATE_INVALID
POTENTIAL_RULE_CONFLICT_REQUIRES_GESTOR_REVIEW
CONTROLLED_RULE_PACKAGE_COORDINATES_MISMATCH
CONTROLLED_RULE_CITATION_OUTSIDE_PACKAGE
CONTROLLED_RULE_EDIT_INVALID
CONTROLLED_RULE_NORMATIVE_KEY_UNKNOWN
CONTROLLED_RULE_NORMATIVE_KEY_CATEGORY_MISMATCH
```

Známé chyby transportu a autorizace:

```text
unauthorized
untrusted_service_identity
service_route_forbidden
controlled_rules_service_required
controlled_rules_source_policy_denied
controlled_rule_domain_unsupported
validation_error
```

`401`, `403`, `409`, `422`, `429`, `5xx`, timeout a nevalidní JSON se v Budgetu
zobrazí jako „Pravidlo nyní nelze bezpečně určit z AKB“. Nesmí být zaměněny za
stav, že organizace žádné pravidlo nemá.

## Audit a soukromí

AKB zapisuje:

- `controlled_rules.read.returned` pro každý dokončený výsledek včetně
  `no_data` a `conflict`;
- `controlled_rules.read.denied` pro autentizovanou, ale nepovolenou servisní
  identitu nebo zdrojovou policy.

Audit obsahuje client id, doménu, datum, stav/reason, počet položek,
`source_version`, katalogovou revizi a correlation id. Neobsahuje token,
hodnoty pravidel, citovaný text ani obsah dokumentu. Neověřený token je odmítnut
před doménovým auditem a zůstává pouze v bezpečnostní telemetrii autentizační
vrstvy.

## Akceptace Budgetu

Před produkční aktivací musí STRATOS/Budget ověřit:

1. platný servisní token a přesnou jedinou route;
2. odmítnutí upload klienta a tokenu bez role;
3. aktuální i historický dotaz s přesným `valid_on`;
4. zákon zastíní stejný interní `normative_key`;
5. nezávislé interní pravidlo zůstane `supplemental`;
6. konflikt vrátí nula rozhodovacích pravidel;
7. neplatný, schválený nebo zrušený balíček se nevrátí;
8. chybějící data nevedou k nulové nebo lokálně pevné částce;
9. každé zobrazené rozhodnutí uchová `source_version`, klíč, balíček a citaci;
10. correlation id je dohledatelné v auditu AKB i Budgetu.

Budget může odpověď krátce cachovat pouze podle organizace, domény a
`valid_on`. Cache musí uchovávat `source_version`, nesmí přežít změnu
kontraktu/katalogu a při chybě nesmí vydávat starou hodnotu jako aktuální
právní výsledek.
