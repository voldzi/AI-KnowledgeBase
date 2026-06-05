# Security & authorization model

Odkaz na centrální zadání: `../00_CENTRALNI_ZADANI_AKL_PLATFORM.md`

---

## 1. Cíl bezpečnostního modelu

Systém musí zajistit, že uživatel dostane odpověď pouze z dokumentů, ke kterým má oprávnění.

To platí i pro RAG:

- retrieval nesmí vrátit zakázané chunky,
- odpověď nesmí citovat zakázaný dokument,
- LLM nesmí dostat kontext, který uživatel nemá právo číst.

---

## 2. Authentication

Doporučený model:

- Keycloak,
- OIDC,
- JWT access token,
- service accounts pro komunikaci mezi službami.

Každý request mezi službami musí obsahovat:

```text
Authorization: Bearer <token>
X-Request-ID: <uuid>
X-Correlation-ID: <uuid>
```

---

## 3. Role

Základní role:

```text
admin
document_manager
document_owner
reviewer
reader
auditor
service_ingestion
service_rag
service_llm_gateway
service_evaluation
service_governance
```

---

## 4. Akce

Povolené akce:

```text
document.create
document.read
document.update
document.delete
document.version.create
document.version.publish
document.version.archive
document.ingest
document.reindex
rag.query
rag.compare
rag.check_compliance
audit.read
audit.write
admin.manage
```

---

## 5. Document-level access control

Příklad access policy:

```json
{
  "policy_id": "pol_123",
  "document_id": "doc_123",
  "subjects": ["role:reader", "user:user_123", "group:IT"],
  "actions": ["document.read", "rag.query"],
  "constraints": {
    "classification_max": "internal",
    "valid_only": true
  }
}
```

---

## 6. Authorization check flow

```text
Frontend/RAG/Ingestion
        |
        v
Registry API /authz/check
        |
        v
Decision: allowed / denied
```

Pro vlastní `subject_id` se role a skupiny nesmí brát z request body. Registry musí použít role/skupiny ověřeného principalu z mock/OIDC auth vrstvy. Role/skupiny v request body jsou důvěryhodné pouze pro admin nebo service-account zprostředkované kontroly jiného subjektu.

RAG flow:

```text
1. uživatel položí dotaz
2. RAG služba vytvoří candidate retrieval query
3. metadata filter předem omezí dokumenty dle uživatele
4. po retrieval se provede authz filter nad candidate document_ids
5. LLM dostane pouze povolené chunky
6. odpověď obsahuje pouze povolené citace
7. audit se zapíše přes Registry API
```

---

## 7. Klasifikace dokumentů

Doporučené úrovně:

```text
public
internal
restricted
confidential
```

Pravidlo:

- uživatel s nižší úrovní nesmí získat kontext vyšší úrovně,
- filtr se musí aplikovat před LLM,
- nestačí filtrovat až výsledek odpovědi.

---

## 8. Auditní požadavky

Auditovat:

- přihlášení,
- upload dokumentu,
- změnu metadat,
- změnu oprávnění,
- publikaci verze,
- spuštění ingestion jobu,
- RAG dotaz,
- použité zdroje,
- odpověď nebo její hash,
- export,
- administrativní změny.

Pro citlivé prostředí je vhodné auditovat hash odpovědi a metadata, ne vždy plný text odpovědi.

---

## 9. Logging

Do technických logů nesmí jít:

- celé dokumenty,
- celé prompty,
- citlivé odpovědi,
- tokeny,
- hesla,
- API klíče,
- osobní údaje, pokud nejsou nezbytné.

Logovat lze:

- request id,
- correlation id,
- service name,
- latency,
- status code,
- error code,
- počet chunků,
- ID dokumentů, pokud je to schválené.

---

## 10. Service accounts

Každá služba má vlastní service account.

Příklad:

```text
svc-ingestion
svc-rag
svc-llm-gateway
svc-evaluation
svc-governance
```

Každý service account má minimální potřebná oprávnění.

---

## 11. Dev režim

Dev režim může mít mock uživatele, ale musí být jasně označen:

```text
AKL_AUTH_MODE=mock
```

Keycloak/OIDC baseline používá:

```text
AKL_AUTH_MODE=oidc
Authorization: Bearer <jwt>
```

Registry API validuje JWT podpis a claims přes JWKS. RAG Retrieval, Ingestion a LLM Gateway bearer token vyžadují a propagují, ale v Phase 02D neduplikují lokální JWT signature validation; dokumentová rozhodnutí vynucuje Registry `/authz/check` nebo `/authz/filter-documents`.

Produkce musí odmítnout start, pokud:

```text
AKL_ENV=production
AKL_AUTH_MODE=mock
```

K Phase 02D zůstává mimo baseline plný browser OIDC login flow a per-user filtrování historie ingestion jobů/reportů.

---

## 12. Bezpečnostní požadavky na CODEX

Každé vlákno musí:

- používat env proměnné,
- nepřidávat secrets do repozitáře,
- nepřeskakovat authz,
- přidat auditní body,
- dokumentovat bezpečnostní limity,
- nepřidávat debug endpointy dostupné bez ochrany.
