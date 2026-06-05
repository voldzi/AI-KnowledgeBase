# Architektura distribuovaných služeb

Tento dokument definuje cílovou architekturu AKL Platform jako sadu samostatně nasaditelných služeb.

Odkaz na centrální zadání: `../00_CENTRALNI_ZADANI_AKL_PLATFORM.md`

---

## 1. Architektonický styl

AKL Platform používá service-oriented architekturu.

Služby musí být:

- samostatně spustitelné,
- samostatně nasaditelné,
- síťově oddělitelné,
- nezávisle škálovatelné,
- navázané na ostatní služby pouze přes kontrakty,
- provozovatelné na různých serverech.

---

## 2. Komponenty

```text
+-------------------+
|   Web Frontend    |
+---------+---------+
          |
          v
+-------------------------------+
| Identity & Document Registry  |
+---------+---------------------+
          |
          | REST / Events
          v
+-------------------+       +----------------+
| Ingestion Service | ----> | Object Storage |
+---------+---------+       +----------------+
          |
          v
+----------------+
|     Qdrant     |
+----------------+

+-----------------------+
| RAG Retrieval Service |
+-----+------------+----+
      |            |
      v            v
+----------+   +-------------+
|  Qdrant  |   | LLM Gateway |
+----------+   +------+------+
                      |
                      v
              +---------------+
              | Ollama / vLLM |
              +---------------+
```

---

## 3. Komunikační principy

### 3.1 Synchronní komunikace

Použít pro:

- dotazy frontend → backend,
- RAG query,
- LLM completion,
- kontrolu oprávnění,
- získání metadat dokumentu.

Technologie:

- HTTPS,
- REST,
- JSON,
- OpenAPI.

### 3.2 Asynchronní komunikace

Použít pro:

- ingestion job created,
- ingestion completed,
- document version published,
- vector index updated,
- audit event produced,
- document validity expiring.

Technologie:

- nejprve jednoduchý event table / outbox pattern,
- později message broker,
- AsyncAPI kontrakty.

---

## 4. Datové vlastnictví

| Data | Vlastník |
|---|---|
| Dokumenty a verze | Identity & Document Registry API |
| Uživatelé, role, oprávnění | Identity & Document Registry API / Keycloak |
| Originální soubory | Object Storage |
| Chunky a metadata chunků | Registry API + Ingestion Service |
| Vektory | Qdrant |
| LLM konfigurace | LLM Gateway |
| Eval datasety | Evaluation Service |
| Governance výsledky | Governance Service |

Služba nesmí zapisovat do databáze jiné služby, pokud to není výslovně povoleno kontraktem.

---

## 5. Deployment model

Každá služba má vlastní:

- Dockerfile,
- konfiguraci,
- health endpoint,
- readiness endpoint,
- logování,
- metriky.

Příklad odděleného nasazení:

```text
Server A: Web Frontend + Reverse Proxy
Server B: Registry API + PostgreSQL
Server C: Ingestion Service + Object Storage
Server D: RAG Retrieval Service + Qdrant
Server E: LLM Gateway + GPU runtime
Server F: Monitoring
```

---

## 6. Network zones

Doporučené zóny:

| Zóna | Obsah |
|---|---|
| Public / DMZ | Reverse proxy, Web Frontend |
| Application zone | Registry API, RAG, Ingestion, LLM Gateway |
| Data zone | PostgreSQL, Qdrant, MinIO |
| AI compute zone | Ollama/vLLM GPU runtime |
| Management zone | Grafana, Prometheus, Loki, admin tools |

---

## 7. Chybové scénáře

Systém musí rozumně reagovat, když:

- LLM Gateway není dostupná,
- Qdrant není dostupný,
- OCR selže,
- dokument nelze parsovat,
- uživatel nemá oprávnění,
- retrieval nevrátí relevantní zdroje,
- dokument je archivní nebo nahrazený,
- existuje konflikt mezi dokumenty.

---

## 8. Doporučení pro CODEX

Každé vlákno musí:

- respektovat service boundary,
- neměnit kontrakt jiné služby bez návrhu,
- přidat healthcheck,
- přidat dokumentaci,
- nepřidávat implicitní runtime závislosti na jiné službě bez env konfigurace,
- implementovat mock klienty pro integrační testy.
