# Compliance Checks

Tento dokument popisuje baseline pravidla Governance / Compliance Service.

## Povinne Vlastnosti Vystupu

Kazda compliance odpoved musi mit:

- citace na kontrolni zdroje,
- seznam zdroju,
- confidence,
- warnings,
- stav `compliant`, `non_compliant`, `needs_review`, nebo `insufficient_source`.

## Baseline Pravidla

| Rule ID | Ucel | Typicky vystup |
|---|---|---|
| `governance.control_sources.required` | Kontrola nesmi bezet bez citovanych kontrolnich zdroju. | `insufficient_source` |
| `governance.control_sources.available` | Evidence pouzitych smernic/metodik/policies. | `passed` |
| `governance.owner_or_gestor.required` | Navrh musi identifikovat vlastnika nebo gestora. | `failed` pri absenci |
| `governance.validity_window.required` | Navrh ma obsahovat platnost nebo ucinnost. | `warning` pri absenci |
| `governance.exception_approval.required` | Pokud navrh mluvi o vyjimkach, musi uvest schvalovatele. | `failed` pri absenci |
| `governance.draft_traceability.recommended` | Caller by mel dodat citace puvodu draftu. | `manual_review` pri absenci |

## Confidence

- `high`: pravidlo ma jasny signal v draftu a kontrolni zdroje maji vysoke retrieval score.
- `medium`: zdroje existuji, ale signal je heuristicky nebo castecny.
- `low`: zdrojova opora je slaba.
- `insufficient_source`: chybi kontrolni zdroje.
- `conflicting_sources`: vyhrazeno pro konfliktni zdroje z conflict detection workflow.

## Review Interpretace

`non_compliant` znamena, ze sluzba nasla citovany problem pro review. Neznamena automaticke zamitnuti dokumentu. Autoritativni rozhodnuti musi probehnout pres Registry workflow a prislusne role.
