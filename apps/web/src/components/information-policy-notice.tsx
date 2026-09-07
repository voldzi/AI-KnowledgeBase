"use client";

import { InformationLabelBadge, type InformationPolicyDetails } from "@voldzi/stratos-ui";

import type { AklLanguage } from "@/lib/language";

interface InformationPolicyNoticeProps {
  policy: InformationPolicyDetails | null;
  language: AklLanguage;
  title: string;
}

const audienceLabels: Record<string, { cs: string; en: string }> = {
  organization: { cs: "Oprávnění uživatelé organizace", en: "Authorized organization members" },
  organization_unit: { cs: "Oprávnění uživatelé vybraných útvarů", en: "Authorized members of selected units" },
  budget_scope: { cs: "Oprávnění uživatelé finančního rozsahu", en: "Authorized members of the financial scope" },
  project: { cs: "Oprávnění uživatelé vybraných projektů", en: "Authorized members of selected projects" },
  document: { cs: "Oprávnění uživatelé dokumentového rozsahu", en: "Authorized members of the document scope" },
  recipient_set: { cs: "Pouze výslovně určení příjemci", en: "Explicitly named recipients only" },
  public: { cs: "Veřejné publikum; zveřejnění vyžaduje schválenou publikaci", en: "Public audience; public access requires an approved publication" },
};

export function InformationPolicyNotice({ policy, language, title }: InformationPolicyNoticeProps) {
  const cs = language === "cs";
  if (!policy) {
    return <div className="notice notice--warning">
      <strong>{title}</strong>
      <p>{cs
        ? "Pravidla tohoto obsahu nejsou dostupná nebo nesouhlasí. Před dalším sdílením je ověřte s gestorem."
        : "This content's rules are unavailable or inconsistent. Check them with the document owner before sharing."}</p>
    </div>;
  }

  const externalAiBlocked = policy.handlingClass === "RESTRICTED"
    || policy.obligations.some((value) => ["NO_EXTERNAL_AI", "LOCAL_PROCESSING_ONLY"].includes(value));

  return <section className="notice" aria-label={title}>
    <strong>{title}</strong>
    <div className="tag-list">
      <InformationLabelBadge value={policy} labels={{
        public: cs ? "Veřejné" : "Public",
        internal: cs ? "Interní" : "Internal",
        restricted: cs ? "Omezené" : "Restricted",
      }} />
      {!policy.tlp ? <span className="tag">{cs ? "TLP neurčeno" : "TLP not specified"}</span> : null}
    </div>
    <p>{audienceLabels[policy.audience.scopeType]?.[language]
      ?? (cs ? "Publikum ověřte s gestorem." : "Check the audience with the document owner.")}</p>
    {!policy.tlp ? <p>{cs
      ? "TLP je povinné. Dokud gestor nedoplní schválenou politiku, AKB odmítne příjem a použití tohoto obsahu."
      : "TLP is required. AKB rejects admission and use of this content until its owner provides an approved policy."}</p> : null}
    {policy.obligations.includes("NO_EXPORT") ? <p>{cs ? "Export není povolen." : "Export is not permitted."}</p> : null}
    {externalAiBlocked ? <p>{cs ? "Obsah nesmí být předán externí AI." : "Content must not be sent to external AI."}</p> : null}
    {policy.obligations.includes("WATERMARK") ? <p>{cs ? "Výstupy vyžadují ochranné označení." : "Outputs require a watermark."}</p> : null}
  </section>;
}
