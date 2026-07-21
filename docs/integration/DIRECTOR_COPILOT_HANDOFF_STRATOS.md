# Zadání pro STRATOS: identita a access projection Copilota ředitele

## Výstup vlastníka STRATOS

1. Založit neveřejnou OAuth2 client-credentials identitu:
   `svc-akb-director-copilot`.
2. Vydávaný service token musí mít přesně cílové audience Budget API a
   ProjectFlow API. Nesmí získat běžné uživatelské capabilities ani přístup k
   jiným aplikačním endpointům.
3. Zdrojové aplikace musí identitu povolit pouze na:
   `POST /api/v1/integrations/akb/domain-tools/execute`.
4. Bezpečně předat secret vlastníkovi AKB jako soubor; secret nesmí být v Git,
   compose YAML, logu ani browserovém prostředí.
5. `GET /api/v1/auth/me` musí pro ověřenou osobu vracet u každé aplikace:
   `application`, `capabilities`, `effectiveScopes` a `validUntil`.
6. `effectiveScopes` musí být autoritativní aktivní closure. Raw nebo neaktivní
   grants se nesmějí vydávat za runtime přístup.

## Existující capability model

Nová role `director` ani nová globální capability se nezavádí.

- Budget nástroj vyžaduje `budget:read` a aktivní Budget scope.
- ProjectFlow nástroj vyžaduje `projectflow:read`, centrální scope a následně
  lokální projektové členství v ProjectFlow.
- AKB chat vyžaduje `akb:chat` a dokumentové RAG dále aplikuje AKB scope a
  Information Policy.

Profil vedení je pouze průnik těchto oprávnění. Nesmí je rozšiřovat.

## Tokenový tok

AKB posílá dva nezávislé tokeny:

```text
Authorization: Bearer <svc-akb-director-copilot>
X-STRATOS-Actor-Authorization: Bearer <current-person-token>
```

První token dokládá oprávněný transport z AKB. Druhý dokládá aktéra a zdrojová
aplikace jej použije pro aktuální access projection. Hodnota `actor.subject_id`
v requestu se musí shodovat s `sub` ověřeného actor tokenu.

## Negativní akceptace STRATOS

- token jiné služby -> 403;
- správný client s chybnou audience -> 403;
- service token použitý zároveň jako actor token -> 401/403;
- neaktivní osoba, membership nebo application access -> 403;
- expirovaný `validUntil` -> 403;
- podvržené capability/scope hlavičky -> bez vlivu na rozhodnutí;
- nedostupný Access Governance -> 503 fail closed.

## Předání AKB

STRATOS vrátí:

- issuer a token URL;
- client ID a seznam audiences bez secretu v dokumentaci;
- potvrzení route-bound grantů obou zdrojových aplikací;
- fixture access projection pro organization, project a denied scénář;
- auditní důkaz negativních testů;
- způsob bezpečného mountu secret souboru do `web` a `chat-web` AKB.
