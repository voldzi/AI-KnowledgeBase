# ProjectFlow free-form Copilot acceptance

## Scope

AKB routes natural project-status questions to the governed ProjectFlow
read-only domain tool. It does not read the ProjectFlow database and does not
use document RAG as a substitute for unavailable live data.

The projection keeps explicit `organization`, `portfolio`, and `project`
grants separate from their `effectiveScopes` closure. Organization and
portfolio reads do not require redundant local reader membership. Direct
project reads remain fail-closed when ProjectFlow requires membership.

Supported first-cut facts:

- project status;
- schedule status;
- maximum milestone delay;
- next milestone date;
- source `as_of` time;
- authorized ProjectFlow deep link.

## Required behavior

| Scenario | Expected result |
| --- | --- |
| `Jaký je stav projektů?` | ProjectFlow-only query plan and live portfolio table |
| `Máš přístup do ProjectFlow? Jaké evidujeme projekty?` | ProjectFlow-only plan, not access-request clarification |
| `Mám přístup do ProjectFlow?` | source availability and authorized result |
| `Jak požádám o přístup do ProjectFlow?` | ordinary access workflow, not Director Copilot |
| `Co je v projektové dokumentaci?` | document assistant, not live ProjectFlow |
| missing `projectflow:read` | explicit restricted response, zero source/RAG leakage |
| missing `projectflow:access` | explicit application-access denial |
| organization or portfolio grant | preserve broad scope; do not select derived project entries |
| direct project grant without required membership | exact membership denial, fail closed |
| Information Policy denial | no project data and policy-specific reason |
| disabled or unavailable source | explicit no-answer, no document fallback |
| changed projection before response | fail closed before returning live facts |
| interactive user lacks `audit.write` | service audit succeeds without broadening user access |
| service token lacks `akl-api` or exact `audit` grant | fail closed with integration error |

Every ProjectFlow answer carries `answer_source=director_copilot_projectflow`,
the immutable query plan and analysis snapshot, source timestamps and a
bounded audit event. The browser never supplies authoritative capabilities or
scopes. Audit is written by `svc-akb-director-copilot`; the interactive user is
preserved only as the reported actor. Audit metadata records the required
capability, authorized scope types, returned item count and result status,
never tokens or project content.

## Remaining contract dependency

The current ProjectFlow source contract does not expose project display names,
aliases, RAID, capacity or dependency facts. AKB therefore displays the stable
source entity id in this first cut. The source extension is specified in
`docs/integration/PROJECTFLOW_FREE_FORM_COPILOT_HANDOFF.md`.
