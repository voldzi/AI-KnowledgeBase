# Připravenost chatu a nového naplnění AKB

## Rozsah a ověřený stav

Kontrola 5. 9. 2026 vychází z Gitea main a produkčního release
`0cf4dd9f86cf5ffef2381c91b5970bba7eb136c2`. Pracovní změny nejsou tímto
dokumentem prohlášeny za nasazené.

Dokončený reset STRATOS výslovně ponechal AKB beze změny. Kontrola Registry
v read-only transakci zjistila 517 dokumentů, 579 verzí a 114 konverzací;
nejnovější dokument vznikl 27. 8. a nejnovější verze 28. 8. 2026. Není
doloženo, že by po resetu došlo k novému importu těchto dokumentů. Reset
STRATOS proto není důkazem nulového stavu AKB.

AKB vyžaduje vlastní postup podle [owner reset runbooku](../OPERATIONS/akb-epoch-reset.md):
vymezené cílové store, ověřená záloha a izolovaná obnova, schválení, odstavení
writerů, vlastní reset, kontrola nulového stavu a opakovaná kontrola po
obnovení workerů. Technické identity a konfigurace nejsou obchodní data.
Audit musí zůstat dohledatelný v zabezpečeném archivu. Žádný krok nesmí
automaticky zopakovat reset STRATOS nebo měnit jeho oprávnění.

## Připravené opravy

- Úlohy vznikají z výslovně povolených auditních událostí, nyní
  `ingestion.job.failed`. Interní eskalace a neznámé warningy zůstávají
  auditními záznamy. Vícecyklový test pokrývá i posun času přes několik SLA.
- Výpis úloh používá dávky po 200 kandidátech a drží jen požadovanou stránku.
  Přesný `total` se nadále počítá až po autorizaci všech kandidátů. Jde o
  omezení paměti, nikoli tvrzení, že celková práce má konstantní složitost.
- Důkazní kontrola nepovažuje slovní podobnost za sémantickou podporu;
  modelové hodnocení má uzavřený kontrakt a nesmí přepsat hodnocenou odpověď.
  Podrobnosti a podmínky aktivace jsou v [RAG V2](../rag/rag-v2.md).
- Sestavení odpovědi i její ověření sdílejí zdrojová omezení zpracování.
  Tím není vytvořen nový TLP kontrakt pro sdílení kombinovaných odpovědí.
- Chybové evaluační případy způsobí neúspěch quality gate, nezmizí z verdiktu.
- Release kontrola vyžaduje všech deset známých kvalitativních kontrol,
  jejich způsobilost, konzistentní počty, konečná číselná měření a skutečné
  splnění uvedených prahů. Duplicitní/neznámé kontroly a chybějící kategorie
  jsou odmítnuty. Autorizační únik musí mít hodnotu i práh nula.

Průzkumná evaluační sada může nadále měřit jen část metrik. Není však
použitelná jako úplná release evidence. Nezávislé odborné hodnocení zůstává
nutné: automatické skóre založené na vlastním úsudku chatu nestačí.

## Zbývající podmínky před nasazením a importem

1. Dokončit SSO diagnostiku ve stejném prohlížeči. Při kontrole skončil vstup
   přes in-app browser chybou `ERR_TOO_MANY_REDIRECTS`; anonymní HTTP klient
   prošel `/akb/chat` (307), `/akb/api/auth/sso` (303) na přihlašovací formulář
   centrálního issueru (200). Ruční retry formulář AKB byl dostupný. Není
   dosud prokázáno místo vzniku smyčky existujícího profilu. Neprodlužovat
   naslepo relaci ani neobcházet access projection.
2. Kvalifikovat Docling na schválených českých PDF, skenech, tabulkách,
   přílohách a manuálech mimo produkci. Kontrolovat čísla, jednotky, pořadí
   textu a přesné stránky; unit testy nejsou měřením OCR kvality. Režim
   produkce neměnit bez tohoto výsledku.
3. Kvalifikovat interní verifier proti ručně potvrzené pravdě, včetně změn
   čísla, znaménka, jednotky, DPH, data, negace, podmínky a subjektu. Měřit
   také falešná odmítnutí správných parafrází a latenci druhého modelu.
4. Rozšířit schválenou gold sadu na pracovní postupy, formuláře, smlouvy,
   právní pravidla, živé finance/projekty, smíšené otázky a navazující tahy.
   Cílových 200 odborně posouzených scénářů není dnešní naměřený výsledek.
5. Ověřit TLP/publikum/PAP/obligations na všech čtecích i exportních cestách
   a při změně práv během relace. U více zdrojů zachovat průnik příjemců;
   samotná nejpřísnější barva není rozhodnutím o sdílení.
6. Po stabilním přihlášení ověřit role, desktop/mobil, klávesnici, loading,
   návrat zpět a otevření přesné citace. Neprohlašovat UX za akceptované
   pouze na základě zdrojového kódu.
7. Teprve poté finální lokální ověření, standardní trusted CI a build-once
   release se stejným SHA. Produkční gate, záloha a rollback se nemění.

## Nulový start

Před prvním novým importem musí AKB doložit nulu dokumentů, verzí, blobů,
ingest jobů, indexovaných chunků/vektorů, citací, historie chatu/RAG,
evaluačních business dat a starých policy/publication/session vazeb.
Ověřit také nulové odvozené úlohy. Po spuštění maintenance nesmí vzniknout
obchodní data. Stará ID musí být odmítnuta na všech čtecích površích.
Seznam dokumentů v UI sám o sobě tuto podmínku neprokazuje.
