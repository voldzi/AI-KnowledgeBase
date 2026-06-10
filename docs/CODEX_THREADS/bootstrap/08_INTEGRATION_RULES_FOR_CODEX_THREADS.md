# Integrační pravidla pro CODEX vlákna

Odkaz na centrální zadání: `00_CENTRALNI_ZADANI_AKL_PLATFORM.md`

---

## 1. Základní pravidlo

Každé CODEX vlákno vyvíjí samostatnou službu nebo jasně ohraničenou oblast.

Služba musí být samostatně nasaditelná.

---

## 2. Zakázáno

CODEX vlákno nesmí:

- měnit centrální kontrakty bez explicitní dokumentace,
- importovat interní kód jiné služby,
- zapisovat do databáze jiné služby,
- přidávat hardcoded secrets,
- přeskočit authentication/authorization,
- zavádět nezdokumentované endpointy,
- používat mock jako produkční implementaci,
- měnit Docker Compose celé platformy mimo Platform vlákno bez dohody,
- přidat breaking API change bez migration poznámky.

---

## 3. Povinné výstupy každého vlákna

Každé vlákno dodá:

```text
README.md
.env.example
Dockerfile
healthcheck endpoint
testy
OpenAPI/specifikaci, pokud vystavuje API
dokumentaci konfigurace
dokumentaci limitů
seznam integračních bodů
```

---

## 4. Branch naming

```text
feature/platform-infrastructure
feature/registry-api
feature/ingestion-service
feature/rag-retrieval-service
feature/llm-gateway-service
feature/web-frontend
feature/evaluation-service
feature/governance-compliance-service
```

---

## 5. Jak měnit kontrakt

Pokud služba potřebuje změnu kontraktu:

1. vytvořit návrh změny,
2. upravit odpovídající dokument v `CONTRACTS/`,
3. uvést dopad na služby,
4. přidat migration note,
5. zachovat zpětnou kompatibilitu, pokud je to možné.

---

## 6. Integration checklist

Před dokončením vlákna:

- služba jde spustit samostatně,
- služba jde spustit v Dockeru,
- služba má health endpoint,
- služba má mock/stub klienty pro závislosti,
- služba používá env konfiguraci,
- služba loguje correlation id,
- služba má testy,
- služba má dokumentaci,
- služba neobsahuje secrets,
- služba respektuje centrální API a datové kontrakty.

---

## 7. Komunikační pattern

Služby komunikují přes:

- REST API,
- eventy,
- objektové úložiště,
- Qdrant API,
- schválené sdílené JSON Schema.

Ne přes:

- interní import kódu,
- sdílené runtime objekty,
- přímé dotazy do cizí databáze,
- nezdokumentované filesystem cesty.

---

## 8. Minimální integrační test

Každá služba musí mít alespoň jeden integrační test nebo mock test, který simuluje hlavní tok.

Příklad pro RAG:

```text
mock Registry API
mock Qdrant
mock LLM Gateway
POST /rag/query
ověřit odpověď s citací
```

Příklad pro Ingestion:

```text
mock Registry API
mock Object Storage
mock LLM embeddings
vložit sample PDF/TXT
ověřit vznik chunků
```

---

## 9. Společný slovník

Používat termíny:

- Document
- DocumentVersion
- DocumentChunk
- RetrievedChunk
- Citation
- IngestionJob
- RAG Answer
- Authorization Check
- AuditEvent

Nepoužívat paralelní názvy typu:

- fileRecord místo DocumentFile,
- sourceBlock místo DocumentChunk,
- permissionCheck místo Authorization Check,
pokud to není zdokumentovaná specializace.
