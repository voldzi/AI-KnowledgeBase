# LLM Gateway Service

LLM Gateway Service je samostatně nasaditelná FastAPI služba AKB Platform. Poskytuje jednotné API nad lokálními nebo OpenAI-compatible LLM runtime:

- Ollama
- vLLM / OpenAI-compatible endpoint
- mock provider pro testy

## Odpovědnost

Služba zajišťuje:

- chat completion,
- streaming chat completion přes SSE,
- embeddings,
- model listing,
- Local Model Manager API pro provider status, doporučené modely, explicitní pull a test modelů,
- provider routing,
- timeouty a retry pro HTTP providery,
- bezpečné technické logování,
- correlation id propagaci,
- základní in-process rate-limit placeholder.

## Co služba nedělá

Služba nesmí implementovat:

- RAG retrieval,
- document-level authorization,
- citace,
- ukládání dokumentů,
- UI logiku,
- přímé dotazy do databází jiných služeb.

RAG Retrieval Service musí před voláním LLM Gateway předat pouze kontext, který uživatel smí číst.

## API

Base URL:

```text
https://llm-gateway.local
```

Endpointy:

```text
GET  /health
GET  /ready
GET  /api/v1/providers
GET  /api/v1/models
GET  /api/v1/models/recommended
POST /api/v1/models/pull
POST /api/v1/models/test-chat
POST /api/v1/models/test-embedding
GET  /api/v1/config/effective
POST /api/v1/chat/completions
POST /api/v1/embeddings
```

Chybové odpovědi používají společný AKL envelope:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {},
    "trace_id": "string"
  }
}
```

Kompletní kontrakt služby je v `services/llm-gateway-service/openapi.yaml`.

## Local Model Manager

Model Manager je control-plane část LLM Gateway. Web Frontend ji může použít pro budoucí obrazovku `Settings -> Local AI Models`.

Podporované workflow:

```text
1. Zobrazit aktivní provider a dostupnost providerů.
2. Zobrazit dostupné a doporučené modely.
3. Explicitně stáhnout model přes aktivního providera, pokud je pull povolen.
4. Otestovat chat model.
5. Otestovat embedding model.
6. Zobrazit efektivní konfiguraci bez secrets.
```

Model pull je explicitní akce přes `POST /api/v1/models/pull`; při startu služby se žádné modely automaticky nestahují.

Výchozí doporučení pro Phase 02 real local RAG:

```text
chat: gemma4:12b-mlx
embedding: bge-m3
max_tokens: 512
ollama_think: false
```

Ollama endpoint může být jeden nebo řízený failover seznam:

```text
AKL_OLLAMA_BASE_URL=http://192.168.200.3:11434
AKL_OLLAMA_BASE_URLS=http://192.168.200.3:11434,http://192.168.200.2:11434,http://192.168.1.176:11434
AKL_LLM_CHAT_MODEL_FALLBACKS={"gemma4:31b-mlx":["gemma4:12b-mlx"]}
AKL_OLLAMA_ENDPOINT_TIMEOUT_SECONDS=3
```

`AKL_OLLAMA_BASE_URLS` je explicitní allowlist. Gateway neprohledává lokální síť; pouze zkusí nakonfigurované URL v pořadí.
Před chatem gateway načte katalog modelů z dostupných uzlů. Nejprve hledá
požadovaný model napříč celým allowlistem a teprve pokud není nikde dostupný,
použije první dostupný model z explicitního `AKL_LLM_CHAT_MODEL_FALLBACKS`.
Odpověď uvádí skutečně použitý model a fallback se zapisuje jako strukturované
varování bez obsahu dotazu nebo odpovědi.
Každý kandidát se nejdřív ověří krátkým timeoutem
`AKL_OLLAMA_ENDPOINT_TIMEOUT_SECONDS`; plný LLM request se posílá až na aktivní
endpoint. Poslední úspěšný endpoint se v běžícím procesu zkouší jako první,
aby mrtvý preferovaný kandidát nezpomaloval readiness ani každý další dotaz.
Při jeho výpadku se znovu vyhodnotí celý explicitní seznam.

Pro thinking-capable Ollama modely gateway podporuje:

```json
{
  "model": "gemma4:12b-mlx",
  "prompt": "Odpověz česky jednou větou.",
  "think": false,
  "max_tokens": 256
}
```

`think` i `max_tokens` jsou podporované také v `/api/v1/chat/completions`. Pro Ollama se `max_tokens` mapuje na `options.num_predict`; pokud request hodnotu neobsahuje, použije se `AKL_LLM_DEFAULT_MAX_TOKENS`.

Pokud Ollama vrátí pouze `message.thinking` a prázdné `message.content`, gateway vrátí chybu `EMPTY_CONTENT_THINKING_ONLY` místo úspěšné prázdné odpovědi.

## Streaming

`POST /api/v1/chat/completions` používá stejný request jako ne-streaming režim. Pokud `stream=true`, odpověď má `Content-Type: text/event-stream`.

Každá datová zpráva obsahuje JSON chunk:

```text
data: {"id":"...","model":"...","delta":"text","finish_reason":null,"provider":"mock"}
```

Stream končí rámcem:

```text
data: [DONE]
```

## Bezpečnost

Produkční start je odmítnut, pokud:

- není nastaveno `AKL_AUTH_MODE=bearer`,
- chybí `AKL_SERVICE_TOKEN`,
- je povolen mock provider.

V docker-home profilu používá LLM Gateway samostatný service token
`AKL_LLM_GATEWAY_SERVICE_TOKEN`. Compose ho mapuje do LLM Gateway jako
`AKL_SERVICE_TOKEN` a do klientských služeb jako `AKL_LLM_GATEWAY_TOKEN`.
Tento token je pouze pro interní volání chat/embedding endpointů a nesmí se
používat jako Registry/OIDC token pro autorizaci dokumentů.

Produkční kontrakt navíc vynucuje:

```text
AKL_LLM_REQUIRE_CALLER_IDENTITY=true
AKL_LLM_GATEWAY_AUDIENCE=llm-gateway-service
AKL_LLM_GATEWAY_ALLOWED_CALLER_ROLES=service_ingestion,service_rag
```

Ingestion volá gateway jako `svc-ingestion` s rolí `service_ingestion`; RAG
jako `svc-rag` s rolí `service_rag`. Caller OIDC token z browseru nebo AIIP se
do tohoto downstream volání nepoužívá ani nepřeposílá. Ingestion může v auditní
hlavičce `X-AKL-On-Behalf-Of` zachovat pouze identifikátor osoby, který už
potvrdil z Registry-issued proof; hlavička sama není autorita.

Služba loguje request id, correlation id, provider, model, počty vstupů, latenci, status a token usage. Neloguje celé prompty, odpovědi, embedding input texty, bearer tokeny ani API klíče.

## Headers

Služba přijímá a vrací:

```text
X-Request-ID
X-Correlation-ID
```

Při volání externího LLM runtime propaguje:

```text
X-Request-ID
X-Correlation-ID
X-Service-Name
```

Inbound service bearer token se nepřeposílá do LLM runtime.

## Limity

- Rate limiting je pouze single-process placeholder.
- Streaming retry je aplikován jen před úspěšným zahájením streamu.
- Ollama `/api/tags` neposkytuje stabilní capability metadata, proto gateway capabilities odhaduje podle názvu modelu.
- OpenAI-compatible provider očekává endpointy `/v1/models`, `/v1/chat/completions` a `/v1/embeddings`.
- `AKL_LLM_ALLOW_MODEL_PULL=false` je bezpečný default. Pull zapínej pouze pro lokální správu modelů.
- `AKL_OLLAMA_THINK=false` je bezpečný default pro lokální modely, které jinak mohou vracet thinking-only výstup.
