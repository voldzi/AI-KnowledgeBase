# CODEX vlákno 01 — Platform / Infrastructure

Odkaz na centrální zadání: `../00_CENTRALNI_ZADANI_AKL_PLATFORM.md`

Před zahájením práce přečti také:

- `../ARCHITECTURE/01_ARCHITEKTURA_DISTRIBUOVANYCH_SLUZEB.md`
- `../ARCHITECTURE/02_SERVICE_BOUNDARIES.md`
- `../CONTRACTS/03_API_KONTRAKTY_OPENAPI.md`
- `../CONTRACTS/05_DATOVE_KONTRAKTY.md`
- `../CONTRACTS/06_SECURITY_AUTHZ_MODEL.md`
- `../08_INTEGRATION_RULES_FOR_CODEX_THREADS.md`
- `../09_DEFINITION_OF_DONE.md`

---

## 1. Název služby

**Platform / Infrastructure**

---

## 2. Cíl

Vybudovat provozní základ AKL Platform tak, aby bylo možné spouštět jednotlivé služby lokálně i jako samostatně nasaditelné komponenty.

---

## 3. Odpovědnost služby


- Docker Compose pro lokální vývoj.
- Prod-like Docker Compose profil.
- Reverse proxy.
- PostgreSQL.
- Qdrant.
- MinIO.
- Keycloak.
- Ollama nebo vLLM placeholder.
- Prometheus, Grafana, Loki.
- Síťové zóny.
- Healthcheck orchestrace.
- Backup/restore skripty.
- Dokumentace deploymentu.


---

## 4. Co služba nesmí dělat


- Neimplementovat business logiku.
- Neimplementovat datový model dokumentů.
- Neimplementovat RAG logiku.
- Neimplementovat frontend obrazovky mimo případný status page placeholder.


---

## 5. Závislosti na ostatních službách


- Vytváří prostředí pro všechny služby.
- Nepředpokládá, že všechny služby běží na stejném serveru.
- Musí umožnit konfiguraci URL služeb přes environment variables.


---

## 6. Povinné výstupy


```text
infra/docker-compose/docker-compose.dev.yml
infra/docker-compose/docker-compose.prod-like.yml
infra/reverse-proxy/
infra/keycloak/
infra/monitoring/prometheus/
infra/monitoring/grafana/
infra/monitoring/loki/
infra/backup/
docs/deployment/local-dev.md
docs/deployment/multi-server.md
docs/operations/backup-restore.md
.env.example
```


---

## 7. API / integrační body


Minimálně:

```text
GET /health pro každou službu přes reverse proxy
GET /ready pro každou službu, pokud je spuštěná
```

Platform vlákno nevlastní business API.


---

## 8. Definition of Done pro toto vlákno

Služba musí dodat:

- samostatný adresář služby,
- `README.md`,
- `.env.example`,
- `Dockerfile`,
- healthcheck endpoint,
- testy,
- dokumentované API nebo integrační kontrakty,
- bezpečné logování,
- correlation id,
- žádné hardcoded secrets,
- jasně popsané limity,
- kompatibilitu s centrálními kontrakty.

---

## 9. Úvodní prompt pro CODEX

```text
Pracuješ na projektu AKL Platform — AI Knowledge Library.

Tvůj úkol je vytvořit Platform / Infrastructure vrstvu jako samostatný základ pro distribuovanou platformu.

Postupuj podle centrálního dokumentu:
00_CENTRALNI_ZADANI_AKL_PLATFORM.md

Vytvoř infrastrukturu pro služby:
- web frontend
- registry-api
- ingestion-service
- rag-retrieval-service
- llm-gateway-service
- evaluation-service
- governance-service
- PostgreSQL
- Qdrant
- MinIO
- Keycloak
- Ollama nebo vLLM
- Prometheus
- Grafana
- Loki
- reverse proxy

Nevytvářej business logiku.
Zaměř se na Docker Compose, konfiguraci, healthchecky, síťové propojení, monitoring, backup/restore a dokumentaci.

Výstup musí být připravený pro to, aby ostatní CODEX vlákna mohla vyvíjet samostatné služby.
```
