# Workflow Inbox

Workflow Inbox je produkcni vrstva pro organizacni praci nad dokumenty. Cilem je, aby spravci dokumentu, gestori a auditori nemuseli hledat rizikove stavy napric registrem, ingestion boardem a auditem.

Route: `/tasks`

## Stav Po Inkrementu

Implementovano ve web aplikaci:

- hlavni navigace obsahuje polozku `Ukoly / Tasks`,
- dashboard ukazuje pocet workflow ukolu,
- `/tasks` zobrazuje metriky otevrenych, blokujicich a review ukolu,
- inbox podporuje vyhledavani a filtry podle priority, stavu a typu,
- detail ukolu ukazuje odpovednost, zdrojovy signal, vazany dokument, verzi, ingestion job a primarni akci,
- Registry API tasky lze z detailu priradit, vratit k uprave, schvalit nebo uzavrit,
- provozni ingestion signaly vedou na zdrojovou obrazovku: dokumentovy workbench, ingestion nebo audit,
- detail dokumentu ve workflow zalozce zobrazuje task historii pro dany dokument.
- Registry API poskytuje `GET /workflow/tasks` a `POST /workflow/tasks/{task_id}/actions`.

## Read Model

Soucasny inbox ma dva zdroje:

- autoritativni Registry API tasky z `GET /workflow/tasks`,
- provozni ingestion tasky dopocitane ve webu z `IngestionJob.status`.

Registry API tasky jsou perzistentni a vznikaji idempotentni synchronizaci z `Document.status`, `Document.classification` a `AuditEvent.severity`. Synchronizace zachovava manualni rozhodnuti nad taskem, takze `request_changes` nebo `assign` nezmizí pri dalsim nacteni inboxu. Ingestion tasky zustavaji v UI doplnkem, protoze stav zpracovani vlastni Ingestion Service.

Webove rozhodnuti jde pres Next route `/api/workflow/tasks/{task_id}/actions`, ktera pouze validuje vstup a predava request do Registry API s aktualnim server request contextem. Po uspesne akci se inbox obnovi z autoritativniho list endpointu.

## Typy Odvozenych Ukolu

- `review`: dokument je ve stavu `review`.
- `draft`: dokument je ve stavu `draft` a potrebuje doplneni pred revizi.
- `governance`: citlivy dokument neni platny a vyzaduje kontrolu pred publikaci.
- `ingestion`: zpracovani bezi, skoncilo s varovanim nebo selhalo.
- `audit`: auditni udalost se severity `warning`, `error` nebo `critical`.

## Produkcni Cil

Registry API uz dodava prvni perzistentni workflow task kontrakt:

- task id, stav, priorita, deadline a vlastnik,
- vazba na dokument, verzi, ingestion job a audit event,
- akce `assign`, `request_changes`, `approve`, `publish`, `archive`, `resolve`,
- zapis rozhodnuti do audit logu,
- authz kontrola pro kazdou akci.

Samotne dokumentove rozhodnuti, napr. realna publikace verze, zustava oddelene v dokumentovych endpointach. `workflow.task.publish` auditne zachycuje workflow rozhodnuti, ale nenahrazuje `/documents/{document_id}/versions/{version_id}/publish`.

## SLA Eskalace

Pri kazdem nacteni `GET /workflow/tasks` probehne eskalacni pruchod nad
aktivnimi tasky (`open`, `waiting`, `blocked`):

- task po terminu `due_at` dostane zvysenou prioritu (low → medium → high → critical),
- pokud ma assignment nastaven eskalacni subjekt (`escalation_subject_id`),
  task se preradi na nej a `owner_label` prevezme `escalation_label`,
- do metadat tasku se zapise `sla_escalated`, `sla_escalated_at` a
  `previous_owner_id`,
- zapise se audit udalost `workflow.task.sla_escalated` se severitou `warning`.

Eskalace je idempotentni — flag `sla_escalated` zajisti, ze probehne jen jednou.

## Dalsi Rez

1. Governance Service: vracet vysledky compliance/conflict checks jako vstup do tasku.
2. Ingestion Service: publikovat varovani do workflow tasku pres Registry API misto webove derivace.
3. Registry API: viceurovnove schvalovatele (multi-step approval chains).
4. Web UI: doplnit audit tab dokumentu s filtrovanou historii workflow a publikace.
