# RAG V2 Mode Comparison
Tento report je povinná šablona release evidence. Výsledky nelze doplnit bez
reprezentativního českého gold datasetu a korpusových profilů 1x, 5x a 20x.

| Režim | recall@50 | recall@8 | nDCG@8 | auth leak | claim support | false answer | p95 | Stav |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| současný V1 | neměřeno | neměřeno | neměřeno | neměřeno | neměřeno | neměřeno | neměřeno | baseline čeká |
| cross-encoder | neměřeno | neměřeno | neměřeno | neměřeno | neměřeno | neměřeno | neměřeno | shadow čeká |
| ColBERT | neměřeno | neměřeno | neměřeno | neměřeno | neměřeno | neměřeno | neměřeno | encoder/backfill čeká |
| cascade | neměřeno | neměřeno | neměřeno | neměřeno | neměřeno | neměřeno | neměřeno | benchmark čeká |

Report musí uvést přesný dataset hash, corpus profile, model a revision, Qdrant
verzi, konfiguraci, počet dotazů, interval spolehlivosti, p50/p95 a oddělené
výsledky pro češtinu, exact ID, časové, porovnávací a autorizační dotazy.
Produkční režim nesmí být zvolen podle jednotlivých ručních ukázek.
