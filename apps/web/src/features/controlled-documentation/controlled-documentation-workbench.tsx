"use client";

import {
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  FilePlus2,
  Files,
  ListChecks,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { StratosButton } from "@/components/stratos/button";
import { withAppBasePath } from "@/lib/app-url";
import {
  controlledPackageDatesFromVersion,
  controlledPackageMemberRelation,
  nextControlledPackageStatus,
  type ControlledPackageMemberRole,
} from "@/lib/controlled-documentation/contract";
import {
  controlledDocumentationErrorMessage,
  controlledDocumentationWarningLabel,
  controlledPackageRuleProgress,
} from "@/lib/controlled-documentation/presentation";
import type {
  AuthorizationHint,
  ControlledDocumentPackage,
  ControlledDocumentPackageList,
  ControlledDocumentPackageStatus,
  ControlledDocumentSourceType,
  ControlledRuleList,
  ControlledRuleProposal,
  Document,
  DocumentVersion,
} from "@/lib/types";

type MemberDraft = {
  documentId: string;
  versionId: string;
  role: ControlledPackageMemberRole;
};

const sourceLabels: Record<ControlledDocumentSourceType, string> = {
  law: "Zákon",
  implementing_regulation: "Prováděcí předpis",
  internal_directive: "Interní směrnice",
  internal_instruction: "Interní pokyn",
  methodology: "Metodika",
  form: "Formulář",
  informative_guidance: "Informativní výklad",
};

const statusLabels: Record<ControlledDocumentPackageStatus, string> = {
  draft: "Koncept",
  approved: "Schváleno",
  valid: "Platné",
  superseded: "Nahrazeno",
  cancelled: "Zrušeno",
  archived: "Archivováno",
};

export function ControlledDocumentationWorkbench({
  initialPackages,
  initialRules,
  documents,
  authorization,
}: {
  initialPackages: ControlledDocumentPackageList;
  initialRules: ControlledRuleList;
  documents: Document[];
  authorization: AuthorizationHint;
}) {
  const [domain, setDomain] = useState(initialRules.domain);
  const [validOn, setValidOn] = useState(initialRules.valid_on);
  const [packages, setPackages] = useState(initialPackages);
  const [rules, setRules] = useState(initialRules);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const acceptedCount = rules.rules.filter((rule) =>
    ["accepted", "edited"].includes(rule.verification_status),
  ).length;
  const proposedCount = rules.rules.filter(
    (rule) => rule.verification_status === "proposed",
  ).length;
  const activePackages = packages.items.filter(
    (item) => item.status === "valid",
  ).length;

  async function refresh(selectedDomain = domain, selectedDate = validOn) {
    setBusy("refresh");
    setError(null);
    try {
      const [packageResponse, ruleResponse] = await Promise.all([
        fetch(
          withAppBasePath(
            `/api/controlled-documentation/packages?domain=${encodeURIComponent(selectedDomain)}&valid_on=${encodeURIComponent(selectedDate)}&include_inactive=${authorization.can_update}`,
          ),
        ),
        fetch(
          withAppBasePath(
            `/api/controlled-documentation/rules?domain=${encodeURIComponent(selectedDomain)}&valid_on=${encodeURIComponent(selectedDate)}&approved_only=false&include_inactive=${authorization.can_update}`,
          ),
        ),
      ]);
      if (!packageResponse.ok || !ruleResponse.ok) {
        throw new Error("Řízené předpisy se nepodařilo načíst.");
      }
      setPackages((await packageResponse.json()) as ControlledDocumentPackageList);
      setRules((await ruleResponse.json()) as ControlledRuleList);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Řízené předpisy se nepodařilo načíst.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function transition(
    item: ControlledDocumentPackage,
    target: ControlledDocumentPackageStatus,
  ) {
    setBusy(item.package_id);
    setError(null);
    try {
      const response = await fetch(
        withAppBasePath(
          `/api/controlled-documentation/packages/${encodeURIComponent(item.package_id)}/status`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_status: target }),
        },
      );
      if (!response.ok) {
        throw new Error(await responseMessage(response));
      }
      setNotice(`Balíček je nyní ve stavu „${statusLabels[target]}“.`);
      await refresh();
    } catch (transitionError) {
      setError(
        transitionError instanceof Error
          ? transitionError.message
          : "Stav balíčku se nepodařilo změnit.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function extract(item: ControlledDocumentPackage) {
    setBusy(`extract:${item.package_id}`);
    setError(null);
    try {
      const response = await fetch(
        withAppBasePath("/api/controlled-documentation/extract"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            package_id: item.package_id,
            domain: item.domain,
            documents: item.members.map((member) => ({
              document_id: member.document_id,
              document_version_id: member.document_version_id,
            })),
            classification_max: "internal",
          }),
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = (await response.json()) as { rules?: unknown[] };
      setNotice(
        `Připraveno ${result.rules?.length ?? 0} citovaných návrhů k ověření gestorem.`,
      );
      await refresh();
      requestAnimationFrame(() => {
        document
          .getElementById("controlled-rules")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (extractionError) {
      setError(
        extractionError instanceof Error
          ? extractionError.message
          : "Návrh pravidel se nepodařilo vytvořit.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function reviewRule(
    extractionId: string,
    packageId: string,
    ruleId: string,
    proposal: ControlledRuleProposal,
    decision: "accepted" | "rejected" | "edited",
  ) {
    setBusy(`rule:${ruleId}`);
    setError(null);
    try {
      const response = await fetch(
        withAppBasePath(
          `/api/controlled-documentation/extractions/${encodeURIComponent(extractionId)}/feedback`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            field: `rules.${ruleId}`,
            ai_value: proposal,
            final_value: decision === "rejected" ? null : proposal,
            decision,
            source_entity_id: packageId,
          }),
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      setNotice(
        decision === "rejected"
          ? "Návrh byl odmítnut."
          : decision === "edited"
            ? "Pravidlo bylo opraveno a potvrzeno."
            : "Pravidlo bylo potvrzeno.",
      );
      setEditingRule(null);
      await refresh();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "Rozhodnutí se nepodařilo uložit.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="controlled-docs">
      <section className="controlled-docs__metrics" aria-label="Stav řízených předpisů">
        <Metric icon={BookOpenCheck} label="Balíčky" value={packages.items.length} detail={`${activePackages} platných k datu`} />
        <Metric icon={SearchCheck} label="Ověřená pravidla" value={acceptedCount} detail="použitelná aplikacemi" />
        <Metric icon={Sparkles} label="K posouzení" value={proposedCount} detail="citovaných návrhů" />
        <Metric icon={CalendarClock} label="Stav k datu" value={formatDate(validOn)} detail="lze změnit pro historii" />
      </section>

      <section className="controlled-docs__toolbar">
        <label className="stratos-field" htmlFor="controlled-domain">
          <span>Oblast</span>
          <input
            id="controlled-domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
        </label>
        <label className="stratos-field" htmlFor="controlled-valid-on">
          <span>Platnost k datu</span>
          <input
            id="controlled-valid-on"
            type="date"
            value={validOn}
            onChange={(event) => setValidOn(event.target.value)}
          />
        </label>
        <StratosButton
          type="button"
          onClick={() => void refresh(domain, validOn)}
          disabled={busy === "refresh"}
        >
          <SearchCheck aria-hidden="true" /> Zobrazit
        </StratosButton>
      </section>

      {notice ? <p className="controlled-docs__notice"><CheckCircle2 aria-hidden="true" />{notice}</p> : null}
      {error ? <p className="controlled-docs__error" role="alert"><XCircle aria-hidden="true" />{error}</p> : null}
      {[...new Set([...packages.warnings, ...rules.warnings])].map((warning) => (
        <p className="controlled-docs__warning" key={warning}>
          <ShieldCheck aria-hidden="true" /> {controlledDocumentationWarningLabel(warning)}
        </p>
      ))}

      {authorization.can_update ? <PublishingGuide /> : null}

      {authorization.can_update ? (
        <PackageComposer
          documents={documents}
          domain={domain}
          onCreated={async () => {
            setNotice("Nový balíček byl založen jako koncept.");
            await refresh();
          }}
        />
      ) : null}

      <section className="panel controlled-docs__releases">
        <header className="panel__header">
          <div>
            <p className="eyebrow">Vydání a historie</p>
            <h2>Balíčky dokumentů</h2>
          </div>
        </header>
        <div className="controlled-docs__release-list">
          {packages.items.length === 0 ? (
            <p className="muted">Pro zvolenou oblast a datum není dostupný žádný balíček.</p>
          ) : packages.items.map((item) => {
            const ruleProgress = controlledPackageRuleProgress(
              item.package_id,
              rules.rules,
            );
            const nextStatus = nextControlledPackageStatus(item.status);
            const publicationBlocked =
              item.status === "approved" && !ruleProgress.readyForPublication;
            return (
            <article className="controlled-docs__release" key={item.package_id}>
              <div className="controlled-docs__release-main">
                <span className={`status-pill is-${item.status}`}>{statusLabels[item.status]}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>
                    {sourceLabels[item.source_type]} · vydání {item.release_label} · účinné od {formatDate(item.effective_from)}
                    {item.effective_to ? ` do ${formatDate(item.effective_to)}` : ""}
                  </p>
                </div>
              </div>
              <div className="controlled-docs__member-list">
                {item.members.map((member) => (
                  <a
                    href={withAppBasePath(`/documents/${member.document_id}`)}
                    key={member.member_id}
                  >
                    <Files aria-hidden="true" />
                    <span>{member.label || memberRoleLabel(member.member_role)}</span>
                    <small>verze {shortId(member.document_version_id)}</small>
                  </a>
                ))}
              </div>
              {item.status === "approved" ? (
                <PackageWorkflow progress={ruleProgress} />
              ) : null}
              <div className="controlled-docs__actions">
                {item.status === "approved" && authorization.can_update ? (
                  <StratosButton
                    type="button"
                    tone={ruleProgress.total === 0 ? "primary" : undefined}
                    disabled={busy === `extract:${item.package_id}`}
                    onClick={() => void extract(item)}
                  >
                    <Sparkles aria-hidden="true" /> {ruleProgress.total === 0 ? "Navrhnout pravidla" : "Navrhnout znovu"}
                  </StratosButton>
                ) : null}
                {nextStatus && authorization.can_publish ? (
                  <StratosButton
                    type="button"
                    tone={item.status === "draft" || !publicationBlocked ? "primary" : undefined}
                    disabled={busy === item.package_id || publicationBlocked}
                    title={publicationBlocked ? publicationBlockReason(ruleProgress) : undefined}
                    onClick={() => void transition(item, nextStatus)}
                  >
                    <CheckCircle2 aria-hidden="true" /> {nextStatusLabel(item.status)}
                  </StratosButton>
                ) : null}
                {["draft", "approved"].includes(item.status) && authorization.can_update ? (
                  <StratosButton
                    type="button"
                    disabled={busy === item.package_id}
                    onClick={() => void transition(item, "cancelled")}
                  >
                    <XCircle aria-hidden="true" /> Zrušit {item.status === "draft" ? "koncept" : "vydání"}
                  </StratosButton>
                ) : null}
                {item.status === "valid" && authorization.can_update ? (
                  <StratosButton
                    type="button"
                    disabled={busy === `extract:${item.package_id}`}
                    onClick={() => void extract(item)}
                  >
                    <Sparkles aria-hidden="true" /> Navrhnout pravidla
                  </StratosButton>
                ) : null}
              </div>
            </article>
            );
          })}
        </div>
      </section>

      <section className="panel controlled-docs__rules" id="controlled-rules">
        <header className="panel__header">
          <div>
            <p className="eyebrow">Kontrola gestorem a data pro aplikace</p>
            <h2>Návrhy, pravidla a limity</h2>
          </div>
        </header>
        <div className="controlled-docs__rule-list">
          {rules.rules.length === 0 ? (
            <p className="muted">Zatím nejsou připravena žádná pravidla. U schváleného vydání nejprve zvolte „Navrhnout pravidla“.</p>
          ) : rules.rules.map((rule) => (
            <article className="controlled-docs__rule" key={`${rule.extraction_id}:${rule.proposal.rule_id}`}>
              <div>
                <span className="controlled-docs__rule-category">{categoryLabel(rule.proposal.category)}</span>
                <h3>{rule.proposal.title}</h3>
                <p className="controlled-docs__rule-value">{formatRuleValue(rule.proposal.value, rule.proposal.currency, rule.proposal.unit)}</p>
                <blockquote>{rule.proposal.citation.quoted_text}</blockquote>
                <p className="muted">
                  Autorita {rule.authority_rank} · jistota {Math.round(rule.proposal.confidence * 100)} % · {rule.verification_status === "proposed" ? "čeká na ověření" : "ověřeno"}
                </p>
              </div>
              {rule.verification_status === "proposed" && authorization.can_publish ? (
                <>
                  <div className="controlled-docs__actions">
                    <StratosButton
                      type="button"
                      tone="primary"
                      disabled={busy === `rule:${rule.proposal.rule_id}`}
                      onClick={() => void reviewRule(rule.extraction_id, rule.package_id, rule.proposal.rule_id, rule.proposal, "accepted")}
                    >
                      <CheckCircle2 aria-hidden="true" /> Potvrdit
                    </StratosButton>
                    <StratosButton
                      type="button"
                      disabled={busy === `rule:${rule.proposal.rule_id}`}
                      onClick={() => setEditingRule(
                        editingRule === `${rule.extraction_id}:${rule.proposal.rule_id}`
                          ? null
                          : `${rule.extraction_id}:${rule.proposal.rule_id}`,
                      )}
                    >
                      Upravit
                    </StratosButton>
                    <StratosButton
                      type="button"
                      disabled={busy === `rule:${rule.proposal.rule_id}`}
                      onClick={() => void reviewRule(rule.extraction_id, rule.package_id, rule.proposal.rule_id, rule.proposal, "rejected")}
                    >
                      <XCircle aria-hidden="true" /> Odmítnout
                    </StratosButton>
                  </div>
                  {editingRule === `${rule.extraction_id}:${rule.proposal.rule_id}` ? (
                    <RuleEditor
                      key={`${rule.extraction_id}:${rule.proposal.rule_id}`}
                      proposal={rule.proposal}
                      busy={busy === `rule:${rule.proposal.rule_id}`}
                      onCancel={() => setEditingRule(null)}
                      onSave={(proposal) => reviewRule(
                        rule.extraction_id,
                        rule.package_id,
                        rule.proposal.rule_id,
                        proposal,
                        "edited",
                      )}
                    />
                  ) : null}
                </>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function PublishingGuide() {
  const steps = [
    ["1", "Schválit vydání", "Potvrďte správný hlavní dokument a přílohy."],
    ["2", "Navrhnout pravidla", "AKB připraví hodnoty s přesnými citacemi."],
    ["3", "Ověřit návrhy", "Gestor každý návrh potvrdí, opraví nebo odmítne."],
    ["4", "Vyhlásit jako platné", "Aplikace dostanou jen ověřená pravidla."],
  ];

  return (
    <section className="controlled-docs__guide" aria-labelledby="publishing-guide-title">
      <div className="controlled-docs__guide-heading">
        <ListChecks aria-hidden="true" />
        <div>
          <p className="eyebrow">Doporučený postup</p>
          <h2 id="publishing-guide-title">Od vydání k platným pravidlům</h2>
        </div>
      </div>
      <ol>
        {steps.map(([number, title, detail]) => (
          <li key={number}>
            <span>{number}</span>
            <div><strong>{title}</strong><small>{detail}</small></div>
          </li>
        ))}
      </ol>
    </section>
  );
}

type RuleProgress = ReturnType<typeof controlledPackageRuleProgress>;

function PackageWorkflow({ progress }: { progress: RuleProgress }) {
  const detail =
    progress.total === 0
      ? "Další krok: nechte AKB navrhnout citovaná pravidla z hlavního dokumentu a příloh."
      : progress.pending > 0
        ? `Další krok: posuďte ${progress.pending} ${czechProposalCount(progress.pending)} v části Návrhy, pravidla a limity.`
        : progress.readyForPublication
          ? "Pravidla jsou ověřena. Po zveřejnění přesných verzí dokumentů lze vydání vyhlásit jako platné."
          : "Všechny návrhy byly odmítnuty. Před platností spusťte vytěžení znovu a potvrďte alespoň jedno citované pravidlo.";

  return (
    <div className="controlled-docs__package-workflow">
      <strong>Aktuální krok</strong>
      <p>{detail}</p>
    </div>
  );
}

function publicationBlockReason(progress: RuleProgress) {
  if (progress.total === 0) return "Nejprve navrhněte pravidla.";
  if (progress.pending > 0) return "Nejprve posuďte všechny návrhy pravidel.";
  return "Před platností musí být alespoň jedno pravidlo potvrzené.";
}

function czechProposalCount(count: number) {
  if (count === 1) return "návrh";
  if (count >= 2 && count <= 4) return "návrhy";
  return "návrhů";
}

function PackageComposer({
  documents,
  domain,
  onCreated,
}: {
  documents: Document[];
  domain: string;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [packageKey, setPackageKey] = useState("");
  const [releaseLabel, setReleaseLabel] = useState("1");
  const [sourceType, setSourceType] =
    useState<ControlledDocumentSourceType>("internal_directive");
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [reviewDueOn, setReviewDueOn] = useState("");
  const [mainDocumentId, setMainDocumentId] = useState("");
  const [mainVersionId, setMainVersionId] = useState("");
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableDocuments = useMemo(
    () => documents.slice().sort((left, right) => left.title.localeCompare(right.title, "cs")),
    [documents],
  );

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      if (!title || !packageKey || !mainDocumentId || !mainVersionId) {
        throw new Error("Doplňte název, klíč a přesnou hlavní verzi.");
      }
      const response = await fetch(
        withAppBasePath("/api/controlled-documentation/packages"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            package_key: packageKey,
            release_label: releaseLabel,
            title,
            domain,
            source_type: sourceType,
            effective_from: effectiveFrom,
            primary_document_id: mainDocumentId,
            primary_document_version_id: mainVersionId,
            members: [
              {
                member_role: "main_document",
                relation_type: "related_to",
                document_id: mainDocumentId,
                document_version_id: mainVersionId,
                label: title,
                ordinal: 0,
              },
              ...members
                .filter((member) => member.documentId && member.versionId)
                .map((member, index) => ({
                  member_role: member.role,
                  relation_type: controlledPackageMemberRelation(member.role),
                  document_id: member.documentId,
                  document_version_id: member.versionId,
                  ordinal: index + 1,
                })),
            ],
            metadata: reviewDueOn ? { review_due_on: reviewDueOn } : {},
          }),
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      setOpen(false);
      await onCreated();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Balíček se nepodařilo založit.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="controlled-docs__composer">
      <StratosButton type="button" tone="primary" onClick={() => setOpen((value) => !value)}>
        <FilePlus2 aria-hidden="true" /> {open ? "Zavřít založení" : "Založit balíček"}
      </StratosButton>
      {!open ? null : (
        <div className="controlled-docs__composer-form">
          <div className="controlled-docs__form-grid">
            <Field label="Název balíčku">
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Směrnice č. 2/2023 včetně příloh" />
            </Field>
            <Field label="Stálý klíč">
              <input value={packageKey} onChange={(event) => setPackageKey(slugKey(event.target.value))} placeholder="public_procurement:sm-2-2023" />
            </Field>
            <Field label="Vydání">
              <input value={releaseLabel} onChange={(event) => setReleaseLabel(event.target.value)} />
            </Field>
            <Field label="Druh autority">
              <select value={sourceType} onChange={(event) => setSourceType(event.target.value as ControlledDocumentSourceType)}>
                {Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Účinné od">
              <input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
            </Field>
            <Field label="Doporučená revize">
              <input type="date" value={reviewDueOn} onChange={(event) => setReviewDueOn(event.target.value)} />
            </Field>
          </div>
          <div className="controlled-docs__source-row">
            <Field label="Hlavní dokument">
              <select value={mainDocumentId} onChange={(event) => { setMainDocumentId(event.target.value); setMainVersionId(""); }}>
                <option value="">Vyberte dokument</option>
                {availableDocuments.map((document) => <option key={document.document_id} value={document.document_id}>{document.title}</option>)}
              </select>
            </Field>
            <VersionPicker
              documentId={mainDocumentId}
              value={mainVersionId}
              onChange={(versionId, version) => {
                setMainVersionId(versionId);
                const dates = controlledPackageDatesFromVersion(
                  version?.valid_from ?? null,
                );
                if (dates.effectiveFrom) setEffectiveFrom(dates.effectiveFrom);
                if (dates.reviewDueOn) setReviewDueOn(dates.reviewDueOn);
              }}
            />
          </div>
          {members.map((member, index) => (
            <div className="controlled-docs__source-row" key={index}>
              <Field label={`Příloha ${index + 1}`}>
                <select
                  value={member.documentId}
                  onChange={(event) => setMembers((current) => current.map((item, position) => position === index ? { ...item, documentId: event.target.value, versionId: "" } : item))}
                >
                  <option value="">Vyberte dokument</option>
                  {availableDocuments.map((document) => <option key={document.document_id} value={document.document_id}>{document.title}</option>)}
                </select>
              </Field>
              <VersionPicker
                documentId={member.documentId}
                value={member.versionId}
                onChange={(versionId) => setMembers((current) => current.map((item, position) => position === index ? { ...item, versionId } : item))}
              />
              <Field label="Role">
                <select value={member.role} onChange={(event) => setMembers((current) => current.map((item, position) => position === index ? { ...item, role: event.target.value as MemberDraft["role"] } : item))}>
                  <option value="attachment">Příloha</option>
                  <option value="form">Formulář</option>
                  <option value="template">Vzor</option>
                </select>
              </Field>
              <StratosButton type="button" onClick={() => setMembers((current) => current.filter((_, position) => position !== index))}>
                <XCircle aria-hidden="true" /> Odebrat
              </StratosButton>
            </div>
          ))}
          <div className="controlled-docs__actions">
            <StratosButton type="button" onClick={() => setMembers((current) => [...current, { documentId: "", versionId: "", role: "attachment" }])}>
              <FilePlus2 aria-hidden="true" /> Přidat přílohu nebo formulář
            </StratosButton>
            <StratosButton type="button" tone="primary" disabled={submitting} onClick={() => void submit()}>
              <CheckCircle2 aria-hidden="true" /> {submitting ? "Zakládám…" : "Založit koncept"}
            </StratosButton>
          </div>
          {error ? <p className="controlled-docs__error"><XCircle aria-hidden="true" />{error}</p> : null}
        </div>
      )}
    </section>
  );
}

function VersionPicker({
  documentId,
  value,
  onChange,
}: {
  documentId: string;
  value: string;
  onChange: (value: string, version?: DocumentVersion) => void;
}) {
  const [versions, setVersions] = useState<DocumentVersion[]>([]);

  useEffect(() => {
    let cancelled = false;
    setVersions([]);
    if (!documentId) return () => { cancelled = true; };
    void fetch(
      withAppBasePath(
        `/api/controlled-documentation/versions?document_id=${encodeURIComponent(documentId)}`,
      ),
    )
      .then(async (response) => {
        if (!response.ok) return { items: [] };
        return response.json() as Promise<{ items: DocumentVersion[] }>;
      })
      .then((result) => {
        if (!cancelled) setVersions(result.items);
      });
    return () => { cancelled = true; };
  }, [documentId]);

  return (
    <Field label="Přesná verze">
      <select
        value={value}
        disabled={!documentId}
        onChange={(event) => {
          const versionId = event.target.value;
          onChange(
            versionId,
            versions.find(
              (version) => version.document_version_id === versionId,
            ),
          );
        }}
      >
        <option value="">{documentId ? "Vyberte verzi" : "Nejprve dokument"}</option>
        {versions.map((version) => (
          <option key={version.document_version_id} value={version.document_version_id}>
            {version.version_label} · {version.status} · od {version.valid_from ? formatDate(version.valid_from) : "neurčeno"}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="stratos-field"><span>{label}</span>{children}</label>;
}

function RuleEditor({
  proposal,
  busy,
  onCancel,
  onSave,
}: {
  proposal: ControlledRuleProposal;
  busy: boolean;
  onCancel: () => void;
  onSave: (proposal: ControlledRuleProposal) => Promise<void>;
}) {
  const [normativeKey, setNormativeKey] = useState(proposal.normative_key);
  const [title, setTitle] = useState(proposal.title);
  const [value, setValue] = useState(
    typeof proposal.value === "string"
      ? proposal.value
      : JSON.stringify(proposal.value),
  );
  const [unit, setUnit] = useState(proposal.unit ?? "");
  const [currency, setCurrency] = useState(proposal.currency ?? "");
  const [vatBasis, setVatBasis] = useState(proposal.vat_basis);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const normalizedKey = slugKey(normativeKey);
    if (normalizedKey.length < 3 || !title.trim()) {
      setError("Doplňte stálý klíč a srozumitelný název pravidla.");
      return;
    }
    try {
      await onSave({
        ...proposal,
        normative_key: normalizedKey,
        title: title.trim(),
        value: parseRuleValue(value),
        unit: unit.trim() || null,
        currency: currency.trim().toUpperCase() || null,
        vat_basis: vatBasis,
      });
    } catch {
      setError("Opravené pravidlo se nepodařilo uložit.");
    }
  }

  return (
    <div className="controlled-docs__rule-editor">
      <div className="controlled-docs__form-grid">
        <Field label="Stálý klíč pravidla">
          <input
            value={normativeKey}
            onChange={(event) => setNormativeKey(event.target.value)}
          />
        </Field>
        <Field label="Název">
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Hodnota">
          <input value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <Field label="Jednotka">
          <input value={unit} onChange={(event) => setUnit(event.target.value)} />
        </Field>
        <Field label="Měna">
          <input
            value={currency}
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value)}
          />
        </Field>
        <Field label="DPH">
          <select value={vatBasis} onChange={(event) => setVatBasis(event.target.value)}>
            <option value="including_vat">Včetně DPH</option>
            <option value="excluding_vat">Bez DPH</option>
            <option value="not_applicable">Neuplatní se</option>
            <option value="unknown">Neuvedeno</option>
          </select>
        </Field>
      </div>
      <p className="muted">
        Citace, zdrojová verze a jistota zůstávají neměnné. Pro stejné pravidlo
        napříč zákonem a směrnicí použijte shodný stálý klíč.
      </p>
      <div className="controlled-docs__actions">
        <StratosButton type="button" tone="primary" disabled={busy} onClick={() => void save()}>
          <CheckCircle2 aria-hidden="true" /> Uložit a potvrdit
        </StratosButton>
        <StratosButton type="button" disabled={busy} onClick={onCancel}>
          Zrušit
        </StratosButton>
      </div>
      {error ? <p className="controlled-docs__error">{error}</p> : null}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof BookOpenCheck;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="controlled-docs__metric">
      <Icon aria-hidden="true" />
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </div>
  );
}

function nextStatusLabel(status: ControlledDocumentPackageStatus) {
  if (status === "draft") return "Schválit vydání";
  if (status === "approved") return "Vyhlásit jako platné";
  return "";
}

function memberRoleLabel(role: ControlledDocumentPackage["members"][number]["member_role"]) {
  return {
    main_document: "Hlavní dokument",
    attachment: "Příloha",
    form: "Formulář",
    template: "Vzor",
  }[role];
}

function categoryLabel(category: string) {
  return {
    financial_limit: "Finanční limit",
    deadline: "Lhůta",
    obligation: "Povinnost",
    prohibition: "Zákaz",
    responsibility: "Odpovědnost",
    permission: "Oprávnění",
    exception: "Výjimka",
  }[category] ?? category;
}

function formatRuleValue(value: unknown, currency: string | null, unit: string | null) {
  if (typeof value === "number") {
    return `${new Intl.NumberFormat("cs-CZ").format(value)}${currency ? ` ${currency === "CZK" ? "Kč" : currency}` : unit ? ` ${unit}` : ""}`;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function parseRuleValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("cs-CZ").format(date);
}

function shortId(value: string) {
  return value.length > 16 ? `${value.slice(0, 12)}…` : value;
}

function slugKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function responseMessage(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  return controlledDocumentationErrorMessage(
    payload?.error?.code,
    payload?.error?.message || "Operaci se nepodařilo dokončit.",
  );
}
