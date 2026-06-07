# Prirucka pro onboarding znalostni baze

## Cil dokumentu

Tento onboardingovy material popisuje, jak novy spravce znalostni baze zaklada dokument, overuje metadata a sleduje ingestion stav.

## Prvni kontrola

Spravce musi pred publikaci potvrdit vlastnika, gestora, klasifikaci a vazbu na workflow task.

## Viewer a citace

Kazda citace se ma otevrit v detailu dokumentu s informaci o verzi, lokaci a citovatelnem textu. Podepsany zdroj slouzi jen pro aktualni dokumentovou verzi a ma kratkou expiraci.

### Kontrolni seznam

- overit vlastnika dokumentu,
- potvrdit gestora,
- zkontrolovat workflow task.

| Oblast | Stav |
| --- | --- |
| Owner | Ready |
| Gestor | Ready |
| Workflow | Review |

```text
source-context: required
signed-source: short-lived
```

## Provozni poznamky

Pokud neni zdrojovy objekt ve storage dostupny, aplikace nesmi predstirat plny preview rezim a musi ukazat explicitni stav.
