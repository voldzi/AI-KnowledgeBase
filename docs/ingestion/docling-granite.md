# Docling a GraniteDocling

## Cíl

AKB používá Docling jako volitelnou strukturální extrakční vrstvu nad
immutable originálem dokumentu. Přínosem je přesnější zachování hierarchie,
tabulek, stránek a geometrické provenance. GraniteDocling je specializovaný
PDF pipeline; nenahrazuje Registry, Information Policy, audit, embeddings,
hybridní retrieval ani citace.

Implementace je připnutá na zúžený profil `docling-slim==2.124.0` s explicitně
vybranými formáty a lokálními modely. Produkční profil používá standardní
Docling na CPU v režimu `prefer`; nativní parser zůstává auditovatelným
fallbackem. GraniteDocling zůstává připravenou volbou pro pozdější
akcelerovaný profil a v CPU produkci se neaktivuje.

## Režimy

| Režim | Autoritativní výsledek | Selhání Docling |
|---|---|---|
| `off` | nativní parser/OCR | Docling se nenačítá |
| `shadow` | nativní parser/OCR | nativní výsledek + obsahově bezpečný diagnostický stav |
| `prefer` | Docling, pokud vrátí použitelný výsledek | řízený návrat na nativní parser |
| `enforce` | pouze Docling | job skončí fail-closed |

Shadow metadata obsahují jen počty bloků, stran, tabulek, znaků, čas a poměrové
metriky. Neobsahují text dokumentu. `prefer` fallback je ve výsledku viditelný
kódem `DOCLING_PREFERRED_FALLBACK` nebo `DOCLING_LOW_TEXT_FALLBACK`.

## Pipeline a zařízení

- `standard`: standardní Docling pro PDF i podporované Office/web formáty;
- `granite`: GraniteDocling pro PDF, standardní Docling pro ostatní formáty;
- `mlx`: doporučený interaktivní Apple Silicon runtime;
- `cpu`: deterministický fallback pro headless macOS a běžné CPU prostředí;
- `cuda`, `mps`, `auto`: explicitní akcelerátor podle cílové infrastruktury.

Headless macOS proces nemusí mít přístup k Metal ani na Apple Silicon. Proto
musí CI a serverový test používat `cpu`, pokud Metal preflight neprojde.

## Modelový balík

Lokální vývojová příprava může stáhnout modely `layout`, `tableformer`,
`granitedocling` a `granitedocling_mlx` do ignorovaného adresáře `data/`:

```bash
./scripts/setup_docling_local.sh
```

Skript vypíše kanonický digest pro
`AKL_INGESTION_DOCLING_ARTIFACTS_SHA256`. Digest zahrnuje relativní cestu,
velikost a SHA-256 každého souboru. Symlink mimo kořen balíku je odmítnut.
Na Apple Silicon skript vyžaduje Python 3.14 a používá samostatný uzamčený
`requirements-docling-macos.c4.lock`; PDF se při nativním smoke testu ověřuje
přes GraniteDocling/MLX. Produkční Linux/amd64 používá Python 3.12, plný
`requirements-docling.c4.lock` a CPU variantu PyTorch z pevně určeného indexu.

Produkční standardní balík se vytváří pouze z uzavřeného manifestu
`services/ingestion-service/docling_models/source-bundle.json`. Manifest
připíná přesné commity veřejných repozitářů layout a TableFormer modelů.
Provisioner odmítne neúplný obsah, symlink, již existující cíl i jinou revizi,
odstraní transportní cache a vytvoří read-only balík s kanonickým digestem.

Produkční aktivace vyžaduje:

- Docling nainstalovaný v ingestion image (`AKL_INSTALL_DOCLING=true` při buildu);
- kombinovaný `requirements-docling.c4.lock` s přesnými verzemi a SHA-256
  všech instalačních artefaktů; build nesmí použít neuzamčený requirements
  soubor ani runtime resolver;
- pouze binární balíčky; zdrojový build nové závislosti je odmítnut;
- zúžený `docling-slim` profil bez nepoužívaného RapidOCR backendu; skenované
  dokumenty používají explicitně systémový Tesseract s instalovanými jazyky;
- modelový balík připravený skriptem
  `scripts/provision_docling_model_bundle.sh --sha <release-sha>` nad přesným
  release SHA;
- modelový balík připojený pouze pro čtení a pouze do izolovaného
  `docling-worker`; host nastaví `AKL_INGESTION_DOCLING_ARTIFACTS_SOURCE_DIR`
  a cesta ve workeru zůstává `/opt/docling-artifacts`;
- přesný obsahový SHA-256;
- žádné stahování modelu za běhu; modelový balík se připravuje odděleně před aktivací;
- `AKL_INGESTION_DOCLING_EXECUTION_MODE=uds` a pevný socket
  `/run/akb-docling/worker.sock`;
- úspěšný readiness a skutečný syntetický konverzní smoke test.

## Bezpečnostní hranice

- Docling běží v samostatném kontejneru bez sítě, service credentials,
  databáze, objektového úložiště a dokumentových volume. Ingestion předává
  pouze bajty právě zpracovávaného zdroje přes privátní Unix socket.
- Docling dostává kopii zdroje v novém privátním dočasném adresáři s režimem
  `0700`; vstup, request a odpověď workeru mají `0600`. Nikdy nedostává URL.
- Každý převod běží v dalším samostatném procesu s omezeným prostředím.
  Nadřazený proces uplatní tvrdý timeout, ukončí celou skupinu procesu a
  odmítne neuzavřenou odpověď.
- Výchozí kapacita je jedna Docling úloha. Vyčerpaná fronta skončí viditelným,
  bezpečným stavem namísto neomezeného růstu RAM.
- Remote services a externí pluginy jsou vypnuté.
- Worker vždy nastavuje offline režim Hugging Face/Transformers. Produkce ani
  shadow převod nesmí za běhu stahovat modely.
- Originál, Registry verze, publication status a Information Policy zůstávají
  autoritativní mimo parser.
- Výjimky nevracejí obsah backendové chyby, dokumentu ani lokální cestu.
- Do logu a auditu se neukládá text, Docling JSON, obrázky ani tabulková data.
- `enforce` neprovádí méně důvěryhodný parser fallback.
- Worker má read-only root filesystem, odebrané capabilities,
  `no-new-privileges`, omezení CPU/RAM/PID a kapacitu jedna úloha.
- Parsing běží mimo webový event loop a Docling navíc mimo proces ingestion
  služby, aby dlouhá inference neblokovala health ani webový proces.

## Lokální ověření

Smoke test vrací jen agregované metriky a hashe:

```bash
data/docling-venv/bin/python scripts/docling_local_smoke.py \
  --artifacts data/docling-models \
  --pipeline granite --device mlx dokument.pdf

data/docling-venv/bin/python scripts/docling_local_smoke.py \
  --artifacts data/docling-models \
  --pipeline standard --device cpu manual.docx
```

Před změnou z `shadow` na `prefer` musí reprezentativní český korpus prokázat:

- žádnou regresi autorizace, publication gate ani source-open;
- citovatelnou stránku/sekci alespoň stejně často jako nativní parser;
- lepší nebo stejnou úplnost tabulek a pořadí bloků;
- nulový výskyt obsahu dokumentů v logu a auditu;
- změřené p50/p95 podle typu dokumentu a stanovený kapacitní limit workeru;
- ověřený timeout, ukončení procesu a návrat kapacity po chybě;
- ruční kontrolu nejméně dokumentů s tabulkami, skeny, vícesloupcovou sazbou,
  přílohami, poznámkami a českými interními předpisy.

Neznámý formát, neověřený modelový digest, částečný převod bez review nebo
nedostupný parser nesmí být vydáván za plně důvěryhodný výsledek.

## Řízený rollout

1. **Lokální technická kvalifikace:** sestavit hashově uzamčený image, ověřit offline
   standardní Docling, nativní macOS GraniteDocling, stabilitu digestu,
   fallbacky, izolovaný timeout a regresní testy.
2. **Produkční bezpečná aktivace:** připravit immutable standardní modelový
   balík, spustit izolovaný worker a v `prefer` provést syntetický release probe.
   Při selhání Docling zůstane nativní parser dostupný a fallback je viditelný.
3. **Shadow korpus:** spustit `shadow` na reprezentativní sadě bez změny
   autoritativních chunků. Korpus musí pokrýt interní předpisy, manuály,
   tabulky, skeny, formuláře a vícesloupcové dokumenty. Výsledek nesmí
   snížit úspěšnost citací, úplnost textu ani přesnost tabulek proti
   nativnímu parseru.
4. **Selektivní optimalizace:** podle evaluačních výsledků upravit profily,
   OCR a typy dokumentů. Granite povolit jen na
   ukončitelném akcelerovaném workeru a pro PDF třídy, kde přináší měřené
   zlepšení. Fallback zůstává viditelný v reportu.
5. **`enforce`:** použít pouze pro schválený extrakční profil s připnutým
   image a modelem, procesním timeoutem, kapacitním limitem, monitoringem,
   rollbackem a opakovatelným reindexem.

Neznámá nebo smíšená třída dokumentu zůstává na nižší etapě. Samotná
dostupnost modelu není důvodem k automatickému přepnutí.
