# Retrieval Quality Lab

Retrieval Quality Lab je produkční pracovní plocha AKB pro opakovatelné měření
kvality vyhledávání. Je dostupná v modulu Intelligence na trase
`/intelligence/quality` a používá existující Evaluation Service, RAG Retrieval
Service, Registry API, Qdrant a OpenSearch.

## Účel

Quality Lab odpovídá na provozní otázky, které nelze spolehlivě řešit pouze
ručním zkoušením chatu:

- najde retrieval očekávaný dokument nebo chunk,
- jak kvalitní je pořadí výsledků,
- kolik odpověditelných dotazů končí bez výsledku,
- zda test oprávnění nevrátil zakázaný chunk,
- zda jsou citace dohledatelné ve vráceném kontextu,
- zda se kvalita nebo latence proti předchozímu běhu zhoršila,
- zda je samotný dokumentový korpus připravený pro retrieval.

## Datové vrstvy

Produkční retrieval se nemění:

- Qdrant zůstává vektorovým indexem,
- OpenSearch zůstává fulltextovým a analytickým indexem,
- Registry zůstává autoritou pro metadata a oprávnění,
- Evaluation Service vlastní datasety, běhy, reporty a quality gate.

ChromaDB není součástí produkčního toku. Může být použita pouze mimo AKB jako
lokální experimentální laboratoř pro kandidátní embeddingy nebo chunkování.

## Dataset maturity

Každý evaluační případ má stav úsudku:

| Stav | Význam |
| --- | --- |
| `draft` | Rozpracovaný případ. Zobrazuje se v reportu, ale nevstupuje do quality gate. |
| `silver` | Automaticky nebo deterministicky odvozené očekávání, například název dokumentu -> identita dokumentu. |
| `gold` | Odborně posouzený dotaz s potvrzenými relevantními zdroji a očekávanou odpovědí. |

Datasety jsou výchozím způsobem privátní pro vlastníka. Sdílený dataset může
vytvořit administrátor nebo důvěryhodná evaluační služba. Běhy a reporty jsou
omezené na vlastníka; administrátor může provádět provozní dohled.

## Startovní baseline korpusu

Akce `Vytvořit baseline korpusu`:

1. načte dokumenty dostupné aktuálnímu uživateli z Registry API,
2. vybere až 32 dokumentů vyváženě podle typu a seřadí je podle stavu,
3. vytvoří privátní `silver` dataset s dotazem z evidovaného názvu dokumentu,
4. očekává alespoň jeden chunk stejného `document_id`,
5. používá `retrieve_only`, takže nevolá generační model a měří samotný retrieval.

Baseline úmyslně používá `only_valid=false`, aby odlišila technickou
dohledatelnost indexovaného dokumentu od Registry readiness. Platnost, chybějící
verze, OCR a metadata se zobrazují samostatně v části Připravenost korpusu.

## Metriky

Evaluation Service počítá:

- precision, recall a hit rate,
- explicitní recall a nDCG v řezech definovaných datasetem, včetně `@8` a `@50`,
- MRR prvního relevantního výsledku,
- nDCG pro graded relevance `0..3`,
- zero-result rate a false-zero-result rate,
- authorization leak rate pro explicitní negativní chunky,
- citation correctness a citation traceability,
- answer correctness, faithfulness a no-answer correctness,
- podíl tvrzení označených evidence gate jako podložená a false-answer rate,
- přesnost adaptivního routeru proti očekávanému retrieval profilu,
- retrieval p50/p95 a celkovou p95 latenci,
- strukturované časy analýzy dotazu, embeddingu, retrievalu kandidátů,
  autorizace, rerankingu a parent expansion,
- řezy podle role a kategorie dotazu,
- diagnostickou fázi selhání: retrieval, autorizace, citace, odpověď nebo no-answer.

## Quality gate

Výchozí produkční prahy:

| Kontrola | Výchozí práh |
| --- | ---: |
| Retrieval recall | `>= 0.95` |
| Retrieval nDCG | `>= 0.85` |
| False zero-result rate | `<= 0.02` |
| Authorization leak rate | `<= 0` |
| Citation traceability | `>= 1.0` |
| Retrieval p95 | `<= 3000 ms` |
| Retrieval recall@50 | `>= 0.98` |
| Supported-claim rate | `>= 0.98` |
| False-answer rate | `<= 0.02` |
| Router accuracy | `>= 0.95` |

Draft případy jsou z gate vyloučeny. Autorizační kontrola je aktivní pouze v
datasetu s kategorií `authorization`; citační kontrola pouze u full-answer
případů. Gate je `not_evaluated`, pokud nemá žádný způsobilý signál.

Prahy se konfigurují přes `AKL_EVAL_GATE_*`. Každý nový běh se automaticky
porovná s posledním plně změřeným během stejného datasetu; běhy s chybami nebo
bez vyhodnotitelného gate se jako baseline nepoužijí. Report označí regresi skóre,
recallu, nDCG, citací, falešných nul nebo p95 latence.

Promotion dataset `professional_czech_knowledge_v2` žádá retrieval až do
`top 50`, ale provozní precision a celkové skóre nadále počítá nad `top 8`.
Tím rozlišuje recall kandidátů od kvality finálního pořadí. Nové prahy používají
proměnné `AKL_EVAL_GATE_RETRIEVAL_RECALL_AT_50_MIN`,
`AKL_EVAL_GATE_SUPPORTED_CLAIM_RATE_MIN`,
`AKL_EVAL_GATE_FALSE_ANSWER_RATE_MAX` a
`AKL_EVAL_GATE_ROUTER_ACCURACY_MIN`.

## Role a identita

Quality Lab je dostupný rolím Intelligence: administrátorům, document managerům,
analytikům, auditorům a service governance. Web předává OIDC token aktuálního
uživatele do Evaluation Service a dále do RAG/Registry. Produkční měření proto
probíhá se skutečnými oprávněními volajícího; UI neposkytuje obcházení Registry
autorizace.

## Perzistence a obnova

Produkce používá samostatné volume:

```text
evaluation-datasets -> /data/evaluation-datasets
evaluation-reports  -> /data/evaluation-reports
```

Vestavěný sample dataset se při prvním startu zkopíruje z `/app/datasets`, ale
nepřepisuje uživatelské změny. Zápisy datasetů i reportů používají dočasný
soubor a atomický rename. Obě volume musí být součástí backupu.

## Akceptační postup

1. Vytvořit silver baseline z aktuálního korpusu.
2. Spustit měření a odstranit falešné nulové výsledky nebo chybné indexování.
3. Doplnit skutečné dotazy jednotlivých rolí a odborně je označit jako gold.
4. Přidat negativní no-answer a autorizační případy.
5. Stabilizovat prahy na reprezentativním datasetu.
6. Použít quality gate jako povinný regresní test před změnou retrieval pipeline.
