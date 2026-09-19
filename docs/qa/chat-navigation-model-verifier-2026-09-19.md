# Navigation and model verification — 19 September 2026

## Changes

- Clicking another AKB module navigates immediately on mobile and desktop.
  Clicking the current module still opens its secondary navigation. A later
  click can supersede an in-flight transition. A fixed, non-blocking status
  names the destination, even if the old page is scrolled or still loading.
- The model evidence verifier accepts layout-only whitespace differences in
  quotes. It still requires every non-whitespace character and exact source
  identity, and checks numeric/polarity constraints and all answer statements.
- Verification token use and estimated cost are added to the answer's total
  usage. The additive `llm_usage.verification` breakdown names the verifier.
  Failed parsing still accounts for the completed model call; unknown prices
  remain unknown. The existing OpenAPI usage object permits additive fields.
- The opt-in Compose profile `docker-compose.chat-verifier.yml` selects
  `gpt-5.6-luna` for a separate evidence-checking call in **shadow** mode.
  This does not certify answer completeness or silently remove unverified
  sentences. Source-processing restrictions still pass through the LLM gateway.
  Restricted sources may be denied external processing and use the existing
  deterministic fallback, with an explicit fallback warning.

## Why not add a new RAG framework now?

The running application already uses OpenAI for answers whose source policy
permits external processing; the configured external model is `gpt-5.6-luna`.
Docling, Qdrant and the existing retrieval/authorization boundaries remain.
The missing capability addressed here is an actually exercised independent
model check, rather than another orchestration dependency.

[LlamaIndex query pipelines](https://docs.llamaindex.ai/en/stable/module_guides/querying/pipeline/)
can organize multi-step retrieval; [Ragas metrics](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/)
can support offline faithfulness and relevance evaluation. Neither repairs
stale authority evidence or proves authorization. They were reviewed, not
installed or claimed as deployed improvements. Structured model output is a
useful next contract improvement, but schema adherence alone does not prove
semantic correctness ([OpenAI documentation](https://developers.openai.com/api/docs/guides/structured-outputs)).

## Validation checkpoint

- Live isolated verifier diagnostic on an authorized public procurement
  passage: correct paraphrase supported; reversed discrimination claim and
  fabricated 999-day obligation unsupported. The previous implementation
  rejected the correct quote because PDF extraction included a blank line.
- Local browser: module switch displays its destination immediately; another
  click during a transition opens Chat. At 390px, Documents opens in one tap;
  a second tap opens its submenu. Viewport restored afterwards.
- Typecheck and 15 focused existing web navigation tests passed.
- RAG local and exact Linux image: 423 tests passed before the citation-marker
  follow-up. Three additional regression cases cover exact authorized citation
  handles, altered numeric obligations and unknown citation markers.
- Live browser confirmed an immediate named navigation status and completed
  Documents → Chat switching. A transient authority fetch failure triggered the
  first rollback; STRATOS subsequently confirmed healthy uninterrupted services.
- First live API smoke returned HTTP 200, persisted the answer and opened its
  exact citation. OpenAI generation plus verification used 9,707 tokens with
  estimated cost USD 0.0041994. This is one measured example, not a budget forecast.
- The smoke exposed a verifier defect: digits in technical citation handles were
  treated as asserted quantities. Exact authorized citation markers are now
  excluded only from semantic numeric/overlap checks. Actual claim numbers,
  unknown markers and exact verifier/source identity checks remain intact.
- A second live response used deterministic fallback after malformed verifier
  output. Shadow verification is diagnostic, not a guarantee of correctness.
  Those intermediate candidates were rolled back; see final activation below.

Temporal-closure issuance remains coordinated with STRATOS. Do not treat this
UI/model change as deployment of the separate historical-admission contract.

The live RAG answer limit is 1,536 output tokens. Verification repeats every
claim and its supporting passages; reusing that limit truncated normal multi-
claim JSON receipts (gateway HTTP 200 followed by incomplete-answer rejection).
Verification now requests its own bounded 8,192-token output allowance. This is
an upper bound, not a reservation or a fixed cost; actual usage remains recorded.

## Server acceptance and remaining limitations

Candidate `2d33a66` completed the authenticated API and navigation smoke on
`docker.home.cz`: persisted response, exact citation HTTP 200, OpenAI verifier
selected, no verifier fallback in that run, 10,397 total tokens, USD 0.0049614
estimated total. All three affected services were healthy. Navigation displayed
its destination immediately and completed Documents → Chat while Documents
was still loading. The verifier reported partial support, not full correctness.

The live receipt also exposed citation-only lines being treated as separate
claims. The follow-up removes only exact authorized citation markers before
splitting answer statements, consistently for model and deterministic checks.
Unknown markers and actual numeric obligations are still checked.

Known limits: shadow verification does not suppress unsupported statements;
model format failures can still use the explicit deterministic fallback. The
initial session probe intermittently reported unavailable authority; four
fresh authenticated probes from the web container returned 200 in 78–248 ms,
and STRATOS confirmed no restart. Its underlying transient cause is unresolved.
Registry-backed page loads were around 24 seconds in observed logs. Navigation
feedback is fixed; data-loading latency is not claimed to be fixed. Historical
temporal-closure activation remains pending joint consumer acceptance.

A full-response diagnostic first identified a format fallback caused by legal
abbreviations. Preserving each complete list item removed that fallback, but a
later real legal answer exposed the opposite granularity problem: one
unsupported sentence caused another supported sentence in the same bullet to
be removed. Verification now atomizes list items by sentence while protecting
legal abbreviations and dotted dates, and joins PDF layout line breaks before
selecting evidence. It does not silently accept missing claims, duplicate
source IDs or changed numbers.


## Final activation

- RAG revision: `def2dab526dc318e70eeb228cd4f09b2842a646f`.
- Web/chat-web artifacts: `0476cf1`, activated in release `2d33a66`.
- Branch: `codex/perfect-chat-evidence-lineage`, backed up on GitHub.
- Local and exact Linux/amd64 RAG image: **428 tests passed**.
- Authenticated final API smoke: HTTP 200, persisted answer, four expected
  procurement principles present, exact citation open HTTP 200.
- OpenAI verifier: `gpt-5.6-luna`, no format fallback in final smoke;
  six claims, two supported including the main claim, zero citation-only claims.
  Aggregate evidence status remains **partial**. This is functional acceptance
  of diagnostic verification, not factual certification of the whole answer.
- Final sample: 10,092 tokens, estimated USD 0.0047044 including verification;
  verification used 6,281 tokens, estimated USD 0.0031492.
- Public readiness: `ready`, no degraded dependencies.
- Records: `/srv/akb/state/chat-integrity-2d33a66` (navigation/model profile),
  `/srv/akb/state/chat-integrity-def2dab` (final RAG). Each manifest preserves
  prior image identity and Compose chain for rollback. Rollback overrides are
  stored per affected service; reactivate with the recorded chain and
  `up -d --no-build --no-deps --pull never`, then health/readiness and smoke.
- No document, version, policy, storage or database migration was performed.
  No STRATOS release or temporal-closure grant was activated by this change.

Next quality work remains explicit: calibrate semantic verification on diverse
multi-turn questions, separate source metadata from normative assertions,
finish temporal-closure joint acceptance, and diagnose intermittent session
probe failures. Do not describe the existing 200-turn diagnostic or this smoke
as proof that all human questions are answered correctly.

## Navazující kandidát kvality

Následující pre-pilot kandidát mění opt-in profil z diagnostického `shadow` na
fail-closed `repair`. Částečná odpověď dostane nejvýše jeden přepis pouze ze
stejných autorizovaných výňatků a poté nové úplné ověření. Profil současně
zapíná běžící GTE cross-encoder a rozšíření o bezprostředně sousední chunky;
každý soused se před použitím znovu autorizuje na přesném dokumentu a verzi.

Krátká nedostupnost session autority nyní okamžitě skryje chráněný obsah, ale
na stejné stránce provede tři krátké kontrolní pokusy. Původní obsah se obnoví
jen při shodném stabilním otisku identity a oprávnění. Odhlášení nebo změna
přístupu se nikdy neobnoví na místě.

První živý průchod tohoto kandidáta bezpečně určil správnou verzi zákona, ale
lexikální hledání uvnitř verze zvýhodnilo název dokumentu společný všem jeho
chunkům. Do odpovědi se proto dostaly jiné paragrafy a composer správně odmítl
odpovědět. Navazující obecná oprava při přesném dokumentovém scope odstraní
název dokumentu z hodnocených OpenSearch polí i identifikátorových klauzulí;
sekce, článek, odstavec a obsah pasáže zůstávají hodnocené. Regrese ověřuje, že
globální hledání si silné hledání názvu zachová a přesně scoped hledání nikoli.

Následný živý test ukázal, že stejný název zůstal také v embeddingu a vstupu
cross-encoderu, a osm nejvýše hodnocených pasáží se proto nezměnilo. Druhá
oprava po autoritativním určení dokumentu odstraňuje z vnitrodokumentového
dotazu pouze souvislou odlišující část známého názvu, včetně běžného českého
skloňování. Otázka na zásady či povinnosti zůstane zachována; jednotlivé
obecné slovo se za odkaz na dokument nepovažuje.

Živá čtyřdotazová kontrola následně prokázala, že veřejná statistická povinnost
prošla s přesnými citacemi, zatímco dotazy nad Budget smlouvou skončily po
úspěšné lokální kompozici na HTTP 403 externího verifieru. Zdroj je správně
`RESTRICTED` s politikou `AMBER+STRICT`; nejde o důvod tuto politiku oslabit.
Verifier proto nově dědí stejný výběr interního modelu jako composer. Veřejné
zdroje mohou dále používat OpenAI. Přirozená otázka „Kdy musí být…“ se zároveň
klasifikuje jako hledání lhůty; dříve propadla do obecného IT režimu, přestože
správná veřejná pasáž s třicetidenní lhůtou byla mezi vybranými zdroji.

První živý test interního verifieru odkryl nezávislou provozní chybu: obecný
30sekundový HTTP limit zahodil legitimní lokální inferenci a automatické retry
současně spouštělo její další kopie. Jediný chatový požadavek proto skončil až
po 222 sekundách, přestože retrieval i výběr správné smlouvy proběhly správně.
RAG nyní odděluje generativní timeout od ostatních závislostí, generaci bez
idempotency klíče automaticky neopakuje, omezuje celý evidence pipeline a pro
lokální verifier používá 4096tokenový strop. Bezpečnostní selhání zůstává
fail-closed; změna pouze odstraňuje duplicitní práci a nekontrolovanou frontu.

## Navazující živé ověření právních a smluvních odpovědí

Externí Structured Outputs nejprve odmítly evidence schema kvůli nepodporovanému
`uniqueItems`. Schema tento pokyn již neposílá; server dál sám odmítá duplicitní
chunk ID. Stejný dotaz na základní zásady zadávání veřejných zakázek poté přešel
z no-answer na plně podloženou odpověď s vysokou důvěrou. Obsahoval
transparentnost, přiměřenost, rovné zacházení i zákaz diskriminace a všechny tři
citace šly autorizovaně otevřít.

A/B test veřejného dotazu na statistickou mlčenlivost porovnal Lunu a Sol nad
stejným korpusem a politikou. Sol zachoval také sankci 200 000 Kč z další části
zákona a otevřel obě konkrétní citace. Naměřený celkový odhad byl 0,0472012 USD
pro Sol proti 0,0045424 USD pro Lunu. Jde o jeden vzorek, nikoli rozpočtovou
předpověď. Kvalitativní profil proto používá Sol pro veřejné ověření a případnou
jednorázovou opravu. Omezená SIS smlouva zůstala na interním modelu kvůli
`NO_EXTERNAL_AI`; v živém testu vrátila podrobný rozsah podpory a tři platné
citace. Evidence gate zůstává fail-closed v obou trasách.

Opravný prompt nově vyžaduje jednu samostatně doložitelnou skutečnost na větu,
explicitní subjekt a pokud možno terminologii i slovosled zdroje. Verifier smí
přijmout věrnou parafrázi, ale stále musí zachovat subjekt, modalitu, čísla,
podmínky a výjimky. Konečný obsahový certifikát vyžaduje samostatnou kurátorovanou
sadu 200 lidských dotazů; uvedené cílené průchody jej nenahrazují.

## Obnovitelná sada 200 lidských právních dotazů

`scripts/evaluate_assistant_human_questions.py` používá neměnný manifest
`czech-law` revize 2. Pro každý ze 100 schválených zákonů položí dvě české
otázky: úvodní dotaz na účel a oblast úpravy a navazující praktický dotaz ve
stejném vlákně. Druhý dotaz je svázaný s přesným rodičovským message ID a
otiskem zdrojového scope. Test proto nemůže tiše přeskočit k jinému zákonu.

Každá odpověď musí uvést očekávaný zákon, zachovat neměnné `document_id` a
`document_version_id`, znovu autorizovaně otevřít každou citaci a zobrazit jen
výroky označené evidenční bránou jako podložené. Nezávislá kontrola porovnává
citované pasáže s celým aktuálně autorizovaným oknem vieweru. Toleruje pouze
malý sazečský rozdíl vzniklý extrakcí PDF; změněné číslo nebo významová negace
zůstávají odmítnuté. Report neukládá dotazy, odpovědi, texty zdrojů, tokeny ani
přihlašovací údaje. Uchovává pouze identifikátory testů, souhrnné metriky a
dvojice dokument/verze použitých citací.

Kontrolní dvouotáčkový běh před úplnou dávkou prošel 2/2. Zachoval jediný
konkrétní dokument a verzi, otevřel všechny citace a nezobrazil nepodložený
výrok. Jeden tah měl plnou a jeden částečnou evidenci; u částečné evidence byly
nepodložené vedlejší výroky odstraněny před zobrazením. Průměrná odezva byla
60,1 s a celkový odhad obou tahů 0,123746 USD. Jde o smoke validaci metriky;
výsledek celé 200dotazové dávky se zaznamená samostatně po jejím dokončení.
