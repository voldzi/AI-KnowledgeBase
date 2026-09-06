# Lokální společná akceptace v Docker Desktopu — 2026-09-05

## Výsledek

Navazující rozšíření o všech pět webů, aktuální STRATOS API a matici
odpovědností/konektorů: [souhrnná akceptace](stratos-suite-acceptance-2026-09-05.md).
Níže zůstává důkaz původního checkpointu včetně jeho image IDs.

Projekt `akb-stratos-test` je sestavený a spuštěný: 21 kontejnerů, všech 18
nakonfigurovaných healthchecků healthy. Tři samostatné STRATOS weby bez Docker
healthchecku odpověděly HTTP 200. Sestaveno všech 14 aplikačních obrazů.
Skutečné přihlášení přes lokální HTTPS Keycloak a serverové relace STRATOS,
AKB i Chatu prošly. STRATOS otevře Access Center. Bootstrap správce má v AKB
zatím 0 aplikačních capabilities, proto AKB i Chat správně otevřou nápovědu.
Doménová oprávnění se mají přidělit přes skutečné centrální Aplikační přístupy.
Nejde o ověření odpovědi Chatu nad přijatým dokumentem.

[Spuštění a ruční test](../deployment/local-acceptance-docker-desktop.md).
Konfigurace a tajné údaje jsou v ignorovaném `data/local-acceptance`;
žádné produkční přihlašovací údaje ani existující business dokumenty se
nepoužily. Použité obrazy pocházejí z existujících Dockerfiles obou projektů.
Testovací profily nevypínají ověřování JWT, centrální politiku ani ClamAV.

## Zdrojový stav a hranice důkazu

- AKB HEAD: `398aec0593c34bbe8dc1d65423c280d483198ded`; větev `codex/document-intake-hardening`, rozpracované lokální změny.
- STRATOS HEAD: `000436cc8ae5250892adf230bcc56caeed512de0`; větev `codex/ui-quality-and-document-intake`.
- Během sestavování probíhala jiná práce v checkoutu STRATOS, včetně vlastního lokálního profilu. Obrazy proto nejsou prohlášeny za čistý neměnný release kandidát. Cizí změny a kontejnery nebyly upraveny. Jejich port 3230 zůstává volný pro daný jiný projekt, společný test používá 3240.
- Lokální baseline AKB prošla proti uloženému origin/main. Aktualizace z Gitea neprošla kvůli odmítnutému SSH klíči; čerstvost hlavní větve před release je neověřená.
- ARM64 aplikační sestavení, ClamAV AMD64 emulace, hostitelský Ollama; tento checkpoint není produkční výkonový benchmark.
- Žádný produkční deploy, push ani mazání existujících dat. Testovací sestava zůstává spuštěná.

## Živé kontroly

```json
{
  "akb_health": {
    "http_status": 200
  },
  "akb_ready": {
    "http_status": 200
  },
  "chat_health": {
    "http_status": 200
  },
  "stratos_health": {
    "http_status": 200
  },
  "stratos_ready": {
    "http_status": 200
  },
  "projectflow_ready": {
    "http_status": 200
  },
  "stratos_web": {
    "http_status": 200
  },
  "projectflow_web": {
    "http_status": 200
  },
  "archflow_web": {
    "http_status": 200
  },
  "stratos_admission": {
    "valid_request_status": 503,
    "reason_code": "DOCUMENT_ADMISSION_CATALOG_NOT_READY",
    "invalid_request_status": 400,
    "anonymous_status": 401
  },
  "akb_admission": {
    "http_status": 503,
    "reason_code": "document_profile_admission_unavailable",
    "body_keys": [
      "error"
    ]
  },
  "antivirus": {
    "clean_allowed": true,
    "standard_test_detected": true
  }
}
```

Scanner dostal čistý syntetický text a standardní EICAR signaturu pouze přes
INSTREAM v paměti. Žádný testovací dokument nebyl tímto testem uložen/admitován.
AKB readiness použila skutečný service token z HTTPS identity a aktuální
centrální službu. 503 je očekávaná ochrana před neúplným příjmem, nikoli
úspěšná akceptace dokumentů.

## Prohlížeč

```json
{
  "stratos": {
    "authenticated": true,
    "accessCenterVisible": true
  },
  "akb": {
    "authenticated": true,
    "path": "/akb/help",
    "capabilityCount": 0
  },
  "chat": {
    "authenticated": true,
    "path": "/help",
    "capabilityCount": 0
  }
}
```

Opakovatelný test: `scripts/local_acceptance_browser_smoke.mjs`.
Ověřená lokální oprávnění pocházejí z centrálního bootstrapu; žádné tokeny ani
mock session nebyly podvrženy. Snímky obrazovky byly pořízeny a přihlášená
stránka Access Center vizuálně zkontrolována. Soukromé snímky jsou v
`data/local-acceptance/*-authenticated.png`.

## Zbývající podmínky před produkcí

1. Dokončit centrální adaptéry pro nativní verze, veřejné kolekce, ProjectFlow a ArchFlow; readiness zatím úmyslně vrací `DOCUMENT_ADMISSION_CATALOG_NOT_READY`.
2. V AKB upravit a otestovat Budget binary authorization pro organizační publikum a `recipient_set`, zejména TLP:RED. Nynější přesné omezení na `budget_scope` tyto případy odmítá.
3. Společně ověřit pozitivní Budget příjem, scanner attestation, potvrzení root/version, opakování po ztrátě odpovědi, zpracování a odpověď Chatu s přesnou citací. STRATOS implementaci replay již obsahuje; 42 unit a 6 skutečných PostgreSQL regresí prošlo při kontrole zdrojů před sestavením této sestavy.
4. Ověřit změnu odpovědné osoby, historické snímky a časovou platnost, odvolání oprávnění, přísnější klasifikaci a vypršení relací. Dokončit obnovu nativního vytváření kořene po ztrátě odpovědi/reloadu.
5. Automatické S3 mazání nezapínat, dokud neexistuje ověřený kontrakt neměnné verze objektu; zkoušené MinIO ignoruje DeleteObject IfMatch.
6. Připravit neměnný kandidát z aktuální hlavní větve a provést cílové produkční buildy a předepsané CI/bezpečnostní/release kontroly. Lokální zdraví kontejnerů je nenahrazuje.

## Identita běžících obrazů

Tabulka zachycuje skutečné Docker image IDs tohoto lokálního checkpointu,
nikoli registry digest nebo příslib reprodukce ze samotného HEAD.

| Služba | Platforma | Image ID |
| --- | --- | --- |
| chat-web | linux/arm64/v8 | `sha256:4ce95117e56778123a69f22f92fc570d10322fef5a0fd8793f2d6a4c0098356d` |
| clamav | linux/amd64 | `sha256:b25d9199257ae7ef45e0cc4c7eaa60ce7e5447796f0090d5ff311d1a30980cc3` |
| evaluation-service | linux/arm64 | `sha256:1bd426e98cb0a790725e239869c7f986526e951b21efa5cdbd3e5f808a46639f` |
| governance-service | linux/arm64 | `sha256:60ecc61bce5dbd908895e78a8ad7ccb48c70ee76503de8fd95f80ce10f67e48d` |
| ingestion-service | linux/arm64 | `sha256:8e2bb09c0df7ff3075ec98a7d1e8c89a774cdfb55cfd1eb6eb180fc0efd54210` |
| keycloak | linux/arm64 | `sha256:be6a86215213145bfb4fb3e2b3ab982a806d00262655abdcf3ffa6a38d241c7c` |
| llm-gateway-service | linux/arm64 | `sha256:61300fe4f4134f2e69dcdd986d1bd0b335e039951e77ec5db37b1e20aca86c8d` |
| minio | linux/arm64 | `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e` |
| opensearch | linux/arm64 | `sha256:8690b204fe914c60ca76d451ac73bc0481e034d32d3779944c8caca56a2b003f` |
| postgres | linux/arm64/v8 | `sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685` |
| qdrant | linux/arm64 | `sha256:75eab8c4ba42096724fdcfde8b4de0b5713d529dde32f285a1f86fdcb2c9e50c` |
| rag-retrieval-service | linux/arm64 | `sha256:d8a816679e6c5f03017dd193e9f4740c9475beff802960381ce9d07a2244de38` |
| registry-api | linux/arm64 | `sha256:ff86d98b356bcb737f7fa85c16d91a1758e472a54d07a236054040fe859f3a8d` |
| stratos-api | linux/arm64/v8 | `sha256:752044f89c598bd6b625861864409d9721e7ce21e6f40f296ecf3317a0738018` |
| stratos-archflow | linux/arm64/v8 | `sha256:c5e8d931ae4285d57fdef4c572b8ed8de145a4bbee705bf9f812792eb3e736ce` |
| stratos-postgres | linux/arm64/v8 | `sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2` |
| stratos-projectflow-api | linux/arm64/v8 | `sha256:123625ecf8d7f086bd8c78a2742963a7415535227fbfad247b649f8131c8da5f` |
| stratos-projectflow-web | linux/arm64/v8 | `sha256:7c32f69c8380db348c2b991eda859c8f7b4b2d583d1cfb4338455ed35ef94d50` |
| stratos-report-renderer | linux/arm64/v8 | `sha256:08ce77ccb1f7a38a21abcb1a21bf1dae04c35608327af1110bab30eac21f3b8a` |
| stratos-web | linux/arm64/v8 | `sha256:783b4df09f38b31a3ce3922cb9dfff85aeb4f0139afe5359e7c65e4a1e994cac` |
| web | linux/arm64/v8 | `sha256:e69178a24b4c437c44a4ff15c2bcc36af9d3ebc4ae2c81af5d4ed9414b000700` |
