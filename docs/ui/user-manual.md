# AKB User Manual

## Document control

| Field | Value |
| --- | --- |
| Status | Draft for product-owner review |
| Evidence baseline | AKB web and role matrix at `6405261f9279031bb090a85930fad61397fafe47`, 2026-08-26 |
| SSO verification | [Central SSO local verification](../qa/central-sso-managed-identity-verification.md); target browser acceptance pending |
| Owner | AKB product owner |
| Approvers | Product, accessibility and records-management owners |
| Classification | Internal; publishable to authenticated AKB users after approval |

## What AKB is

AKB is the organization's controlled document and knowledge application. It
helps you find the current authorized document, read its exact version, ask a
question with citations, and complete document tasks assigned to your role.
For authorized managers it can also combine clearly separated information from
Budget, ProjectFlow and ArchFlow.

AKB does not grant access because a result is searchable. Every document,
citation and live business fact is checked against your current access.

## Sign in and sign out

Open the approved AKB or AKB Chat address. If you already have a valid central
STRATOS/Keycloak sign-in, AKB normally opens as the same user without another
password prompt. AKB still maintains its own secure server-side session; no
token is copied between applications or stored in browser storage.

Choose **Stay signed in on this device** only on the central sign-in page,
and only for a personal or managed device. AKB has no second checkbox. Its
maximum duration is 90 days from the central session's start and it expires
after 30 days without activity. Switching applications does not restart this
period. Without verified remembered-device policy, the AKB session is limited
to 8 hours without activity and 24 hours in total, with a session-only cookie.
Access can be withdrawn sooner.

Use the same browser and profile when switching applications. A separately
installed Chat app may need its own first sign-in. If sign-in fails, AKB offers
an explicit retry instead of repeatedly redirecting you.

Signing out revokes the local AKB session. When central logout is available,
AKB also continues to the central sign-out flow. Never share an authenticated
browser profile.

## Why your screen may look different

AKB shows only the areas that match your current role and capabilities. A
typical employee sees Chat, authorized Documents/controlled documentation and
Help. Gestors, reviewers, document managers, auditors and administrators see
additional work areas.

Hiding a menu item is not the security boundary. A direct link is checked again
by the server and may be denied after your role, scope or document policy
changes.

## Find and read a document

1. Open **Documents**.
2. Search by title, document number, topic, owner or available filters.
3. Check the status and effective date. A draft, superseded or historical
   version is not the current valid document.
4. Open the document detail to see metadata, attachments and version history.
5. Use the source viewer to read the exact authorized version. Office files may
   use a generated PDF rendition for display; the original immutable file
   remains the source of record.

Important states:

- **Draft/concept**: still being prepared; not a valid instruction.
- **Approved**: approved in workflow but not necessarily effective at the date
  you selected.
- **Valid/effective**: the current governed version for the relevant date.
- **Superseded/archived/cancelled**: retained for history; not current guidance.

An attachment belongs to a specific document version. Use the in-page return
path or browser Back action to return to the package/version you came from.

## Ask AKB Chat

Use ordinary language. Examples:

- “How do I request annual leave?”
- “Where is the foreign travel form?”
- “Who handles an IT incident?”
- “What does the current internal directive require?”
- “What was the rule effective on 31 July 2023?”
- “What is the authorized IT budget and which projects are delayed?”

For a useful answer, include the date, organizational area or object when it
matters. You can ask a follow-up such as “and what was the highest item?”; AKB
keeps bounded conversation context but rechecks authorization on every turn.

### How to read an answer

- **Document answer** contains citations to exact authorized versions and
  sections/pages where available.
- **Controlled rule** names the effective date, source, rule status and warning
  or conflict when applicable.
- **Live STRATOS data** is shown separately with source time, scope and complete
  or partial status.
- **Interpretation/recommendation** is separate from facts and cites the
  evidence it uses.

Open a citation to inspect the source. Access is checked again when you open it;
a citation in old history does not guarantee current permission.

### Safe answer states

| State | Meaning | What to do |
| --- | --- | --- |
| Insufficient source / `no_data` | AKB found no sufficiently precise authorized evidence | Refine the subject/date or contact the document owner |
| Partial | Some authorized branches or pages are missing/incomplete | Use only the clearly identified portion; read the warning |
| Conflict | Authoritative rules cannot be resolved into one decision | Escalate to the gestor/legal owner; do not choose one silently |
| Not authorized | The source exists but your current access does not allow it, or the system cannot safely distinguish | Request access through the approved process; do not ask another user to copy content |
| Unavailable | A required live source or service is temporarily unavailable | Retry later or use the shown owner; AKB will not substitute old documents for live data |
| Stale/review overdue | Evidence is attributable but its review date has passed | Confirm with the named gestor before a consequential decision |

AKB does not invent an answer when evidence or authorization is missing.

## Complete a document task

Users with document-read access open **My workspace (Moje prace)** and follow the link to the
authoritative document/version. Review the source, metadata, attachments,
effective dates and any extraction/compliance warnings before choosing an
action. Do not approve solely because a generated proposal looks plausible.

**My workspace > Awaiting approval (Ke schvaleni)** contains reviews assigned to you
or your approval group. Open the exact version, then approve or request changes.
Approval does not publish it. The submitter cannot decide their own submission;
an assignment alone does not grant approval permission.

**My workspace > My documents (Moje dokumenty)** lists documents you own, manage or
approve. Filter by your responsibility, version state, expiry or review due
date. The upcoming-deadline window is 30 days in the Prague calendar. A pending
replacement does not hide the expiry of the published version. An overdue
review is a warning, not an automatic withdrawal of the document.

Gestors submit the latest prepared version from the approval section of the
document detail. Returned comments appear in their personal task. After changes,
submit a new review. A changed source, policy or assignment invalidates the
old approval. Publication remains a separate authorized action.

Each tab loads its own page. Filters and the page are retained when returning
from a document. The displayed count covers only documents or tasks you may
access, not every stored file or version. The team view is restricted to
document-management users; personal access alone does not allow approval.

The lists refresh on opening, after decisions, or with the refresh control.
Derived tasks and SLA warnings can take up to the configured maintenance
interval (normally one minute) to appear. A loading or unavailable state is not
an empty queue; use retry when a request fails.
Automatic e-mail delivery is not enabled. See [workflow details and planned
notifications](workflow-inbox.md).

## Create or replace a document

This section is visible only to authorized content roles.

1. In **Documents**, start a new document and select its type,
   classification, owner/gestor and a distinct approver.
2. Add the first source file. AKB validates size/type, scans it and stores it in
   quarantine until clean.
3. Wait for processing. Review the faithful preview, extracted text and
   citations.
4. Resolve warnings and complete the review/approval workflow.
5. Publish only the exact reviewed version.

To replace a valid document, create a new version. Never edit the old source
file. Set the effective date and change summary so current and historical
questions select the correct version.

## Controlled directives and rules

Authorized gestors use **Controlled documentation** to group a directive/law
with exact attachments and versions. Proposed extracted rules are suggestions,
not automatically valid decisions. Verify amount, unit, VAT basis, scope,
effective date, citation and precedence before approval.

Law takes precedence over a conflicting internal directive. Internal rules may
still add organization-specific steps where the law does not decide them.

## Privacy and safe use

- Upload only material you are authorized to place in AKB.
- Choose the correct classification and audience.
- Do not paste passwords, tokens, private keys or unrelated personal data into
  chat or metadata.
- Do not treat a confidence label as legal approval.
- Report a wrong citation, unauthorized result or suspicious file immediately
  through the approved support channel.
- Use **Help** for role-specific guidance. Technical identifiers are available
  to support roles but are not required for normal use.

## Mobile and accessibility

On mobile, the shared top-bar control and bottom app rail open navigation. Chat
keeps the composer reachable and places the thread list in a separate panel.
Keyboard users can navigate interactive elements with visible focus, close
dialogs with Escape and return focus to the invoking control. Report any hidden
navigation, clipped text, missing label or inaccessible source viewer as a
product defect.

## When to contact support

Provide the time, action, safe error code and anonymized correlation ID shown by
AKB. Do not send the document body, chat answer, session cookie or authentication
details unless an approved secure support process explicitly requires it.

## Related guidance

- In-product **Help**
- `docs/ui/information-architecture.md`
- `docs/ui/document-workbench.md`
- `docs/ui/stratos-ui-adapter.md`
