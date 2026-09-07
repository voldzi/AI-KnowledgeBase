"use client";

import { useState } from "react";
import { StratosButton, StratosSelect } from "@/components/stratos";
import { useLanguage } from "@/lib/i18n";
import { DOCUMENT_PROFILE_CATALOG, type DocumentProfileDefinition } from "@/lib/documents/document-profile";
import type { DirectoryUser } from "@/lib/types";

interface Props {
  profile: DocumentProfileDefinition;
  directoryUsers: DirectoryUser[];
  disabled?: boolean;
  includeAuthorship?: boolean;
  authorshipDisabled?: boolean;
}

/** Input labels and domain fields come from the Registry's versioned catalog. */
export function DocumentProfileFields({ profile, directoryUsers, disabled = false, includeAuthorship = true, authorshipDisabled = false }: Props) {
  const { language } = useLanguage();
  const [authors, setAuthors] = useState([{ key: 0, kind: "person" }]);
  const [mode, setMode] = useState(profile.lifecycle.modes.includes("until_superseded") ? "until_superseded" : profile.lifecycle.modes[0]);
  const [executionStatus, setExecutionStatus] = useState("");
  const contractRecord = profile.family === "contract" && ["draft", "terminated"].includes(executionStatus);
  const contractEffective = profile.family === "contract" && ["signed", "effective"].includes(executionStatus);
  const availableModes = profile.lifecycle.modes.filter((value) => contractRecord ? value === "record" : contractEffective ? value !== "record" : true);
  const effectiveMode = availableModes.includes(mode) ? mode : availableModes[0];
  const users = directoryUsers.filter((user) => user.enabled !== false);
  const userOptions = users.map((user) => <option key={user.subject_id} value={user.subject_id}>{user.display_name || user.username || user.subject_id}</option>);
  const choose = language === "cs" ? "Vyberte…" : "Choose…";
  const lifecycleLabels = Object.fromEntries(DOCUMENT_PROFILE_CATALOG.lifecycleFields.map((field) => [field.name, field.label[language]]));

  return <fieldset disabled={disabled} className="form-grid document-profile-fields">
    <legend>{language === "cs" ? "Původ a platnost dokumentu" : "Document origin and validity"}</legend>
    {includeAuthorship ? <fieldset disabled={authorshipDisabled} className="form-grid document-profile-fields">
      <StratosSelect id="profile-owner" name="profile.owner" label={language === "cs" ? "Vlastník dokumentu" : "Document owner"} required defaultValue="">
        <option value="" disabled>{choose}</option>{userOptions}
      </StratosSelect>
      <p className="field__hint">{language === "cs" ? "Vlastník odpovídá za dokument. Autor označuje člověka nebo instituci, kteří obsah vytvořili; nahrávající uživatel se eviduje zvlášť." : "The owner is accountable for the document. Authorship identifies its creator or issuer; the uploader is recorded separately."}</p>
      {authors.map((author, index) => <div className="form-grid form-grid--two" key={author.key}>
        <StratosSelect id={`profile-author-kind-${author.key}`} name="profile.author.kind" label={language === "cs" ? "Autor nebo vydavatel" : "Author or issuer"} value={author.kind} onChange={(event) => setAuthors((current) => current.map((item) => item.key === author.key ? { ...item, kind: event.target.value } : item))}>
          <option value="person">{language === "cs" ? "Osoba" : "Person"}</option>
          <option value="organization">{language === "cs" ? "Organizace" : "Organization"}</option>
          <option value="external_authority">{language === "cs" ? "Vydávající instituce" : "Issuing authority"}</option>
        </StratosSelect>
        {author.kind === "person" ? <StratosSelect id={`profile-author-${author.key}`} name="profile.author.id" label={language === "cs" ? "Jméno autora" : "Author name"} required defaultValue="">
          <option value="" disabled>{choose}</option>{userOptions}
        </StratosSelect> : <label className="field" htmlFor={`profile-author-${author.key}`}>
          <span>{language === "cs" ? "Identifikátor organizace nebo instituce" : "Organization or authority identifier"}</span>
          <input id={`profile-author-${author.key}`} name="profile.author.id" required maxLength={160} pattern="\S+" />
        </label>}
        <label className="field" htmlFor={`profile-author-evidence-${author.key}`}>
          <span>{language === "cs" ? "Odkaz na doklad autorství nebo vydání" : "Authorship or publication evidence"}</span>
          <input id={`profile-author-evidence-${author.key}`} name="profile.author.evidence" required maxLength={160} pattern="\S+" />
        </label>
        {index > 0 ? <StratosButton type="button" onClick={() => setAuthors((current) => current.filter((item) => item.key !== author.key))}>{language === "cs" ? "Odebrat autora" : "Remove author"}</StratosButton> : null}
      </div>)}
      <StratosButton type="button" onClick={() => setAuthors((current) => [...current, { key: Math.max(...current.map((item) => item.key)) + 1, kind: "person" }])}>{language === "cs" ? "Přidat autora" : "Add author"}</StratosButton>
    </fieldset> : null}

    <div className="form-grid form-grid--two">
      <StratosSelect id="profile-validity-mode" name="profile.lifecycle.mode" label={lifecycleLabels.mode} value={effectiveMode} onChange={(event) => setMode(event.target.value)} required>
        {DOCUMENT_PROFILE_CATALOG.lifecycleFields[0].options?.filter((option) => availableModes.includes(option.value)).map((option) => <option key={option.value} value={option.value}>{option.label[language]}</option>)}
      </StratosSelect>
      {(effectiveMode === "record" ? ["recordedOn"] : effectiveMode === "fixed_interval" ? ["effectiveFrom", "effectiveTo"] : ["effectiveFrom"]).map((name) => <label className="field" htmlFor={`profile-${name}`} key={name}>
        <span>{lifecycleLabels[name]}</span><input id={`profile-${name}`} type="date" name={`profile.lifecycle.${name}`} required />
      </label>)}
      <label className="field" htmlFor="profile-reviewAt"><span>{lifecycleLabels.reviewAt}</span><input id="profile-reviewAt" type="date" name="profile.lifecycle.reviewAt" required={profile.lifecycle.reviewAtRequired} /></label>
      <StratosSelect id="profile-review-rule" name="profile.lifecycle.reviewRuleId" label={lifecycleLabels.reviewRuleId} required defaultValue={profile.lifecycle.reviewRuleIds[0]}>
        {DOCUMENT_PROFILE_CATALOG.rules.review.filter((rule) => profile.lifecycle.reviewRuleIds.includes(rule.id)).map((rule) => <option key={rule.id} value={rule.id}>{rule.label[language]}</option>)}
      </StratosSelect>
      <StratosSelect id="profile-retention-rule" name="profile.lifecycle.retentionRuleId" label={lifecycleLabels.retentionRuleId} required defaultValue={profile.lifecycle.retentionRuleIds[0]}>
        {DOCUMENT_PROFILE_CATALOG.rules.retention.filter((rule) => profile.lifecycle.retentionRuleIds.includes(rule.id)).map((rule) => <option key={rule.id} value={rule.id}>{rule.label[language]}</option>)}
      </StratosSelect>
    </div>
    <p className="field__hint">{language === "cs" ? "Účinnost musí vycházet z dokumentu. Datum nahrání ji nenahrazuje; pravidlo uchování se řídí schváleným spisovým plánem." : "Effectivity must come from the document. Upload time does not establish it; retention follows the approved records schedule."}</p>
    <div className="form-grid form-grid--two">
      {profile.domainFields.map((field) => field.options ? <StratosSelect key={field.name} id={`profile-domain-${field.name}`} name={`profile.domain.${field.name}`} label={field.label[language]} required={!field.nullable}
        {...(field.name === "executionStatus" ? { value: executionStatus, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setExecutionStatus(event.target.value) } : { defaultValue: "" })}>
        <option value="" disabled={!field.nullable}>{choose}</option>
        {field.options.map((option) => <option key={option.value} value={option.value}>{option.label[language]}</option>)}
      </StratosSelect> : <label className="field" htmlFor={`profile-domain-${field.name}`} key={field.name}>
        <span>{field.label[language]}</span>
        {field.type === "reference_list" ? <textarea id={`profile-domain-${field.name}`} name={`profile.domain.${field.name}`} required={!field.nullable} rows={3} /> :
          <input id={`profile-domain-${field.name}`} name={`profile.domain.${field.name}`} type={field.type === "date" ? "date" : field.type === "https_url" ? "url" : "text"}
            required={!field.nullable || (field.name === "executionEvidenceReference" && !!executionStatus && executionStatus !== "draft")} />}
      </label>)}
    </div>
  </fieldset>;
}
