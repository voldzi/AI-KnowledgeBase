# Intelligence Workbench Product QA

Validated: 2026-07-10.

Run this gate for changes to Intelligence search, role navigation, audit,
administration, employee chat layout, OpenSearch contracts or readiness status.

## Automated Baseline

```bash
pnpm --dir apps/web typecheck
pnpm --dir apps/web test
bash scripts/validate-skeleton.sh
ruby scripts/generate_openapi_index.rb --check
python3 -m json.tool openapi/openapi.json >/dev/null
```

## Role Matrix

Use admin role preview and verify:

| Profile | Expected navigation |
| --- | --- |
| Employee | Chat and Help only; no document/admin quick actions |
| Reviewer | Tasks and Documents; no Upload, Intelligence, Audit or Admin |
| Gestor | Documents and Upload; no Audit or Admin |
| Analyst | Documents, Intelligence and Chat; no Audit or Admin |
| Auditor | Intelligence and Audit; no Upload or Admin |
| Admin | Complete navigation including Administration |

Direct URL and API authorization must still reject forbidden operations even
when an item is absent from navigation.

## Search Scenarios

1. Open `/intelligence#search` with an analyst or admin profile.
2. Type a corpus term and confirm suggestions appear immediately without a
   visible layout jump.
3. Add term, phrase, field, entity and operator chips; each chip must display
   the selected value and be removable.
4. Confirm server validation reports inferred mode, cost and clause count.
5. Confirm an authorized result count appears after the 350 ms debounce.
6. Run a known query and verify every hit links to an authorized AKB document
   and carries chunk/source context.
7. Run an exact or fielded query with zero hits. Confirm broader recovery
   actions appear, show their preview counts when available and can be run.
8. Stop OpenSearch or Ingestion preview temporarily. Local composition must
   remain usable and the UI must state that the estimate is unavailable.
9. Open advanced settings and verify raw query, mode, field and proximity remain
   available without competing with the primary composer by default.
10. Verify entity-specific search is in the Entities section, not duplicated in
    the main Search section.

## Audit And Admin

- Audit text, event-type and severity filters combine correctly.
- Clear filters restores the full authorized list.
- CSV contains only visible rows and the fixed metadata columns.
- Admin directory search does not run for non-admin users.
- Assigning, removing and reactivating a role updates the Registry-backed table.
- No token, password, prompt, answer or document body appears in audit export or
  browser console output.

## Responsive And Accessibility

Check 1440 x 900, 1024 x 768, 390 x 844 and 360 x 800:

- no clipped navigation labels, buttons or query chips,
- no nested `main` landmarks in the employee chat portal,
- mobile chat shows header and composer before the transcript,
- the thread panel is closed initially, keyboard reachable and reports
  `aria-expanded`,
- focus indicators remain visible on suggestions, recovery actions, filters and
  icon buttons,
- status/error messages use `role=status` or `role=alert` where appropriate.

## Performance Acceptance

- query suggestion data is computed from the already loaded permission-scoped
  page payload,
- query preview performs no entity-facet or analyst-case reload,
- the preview response transfers only a total count and bounded recovery data,
- warm preview latency should be recorded for 10 runs; investigate median above
  250 ms or p90 above 500 ms before release,
- compare browser network calls while typing and reject duplicate or stale
  preview requests that survive request cancellation.
