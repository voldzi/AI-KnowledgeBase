"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Send } from "lucide-react";
import { StratosButton, StratosButtonLink } from "@/components/stratos";
import { StatusBadge } from "@/components/status-badge";
import { withAppBasePath } from "@/lib/app-url";
import { documentReviewError } from "@/lib/documents/review-errors";
import { documentStatusLabel, formatDateTime } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";
import type { AuthorizationHint, Document, DocumentAssignment, DocumentVersion, RegistryWorkflowTask } from "@/lib/types";

export function DocumentReviewPanel({ document, version, assignments, tasks, authorization, unavailable = false }: {
  document: Document;
  version: DocumentVersion | undefined;
  assignments: DocumentAssignment[];
  tasks: RegistryWorkflowTask[];
  authorization: AuthorizationHint;
  unavailable?: boolean;
}) {
  const { language } = useLanguage();
  const cs = language === "cs";
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const approver = ["approver", "reviewer"].flatMap((role) => assignments
    .filter((item) => item.active && item.role === role)
    .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.assignment_id.localeCompare(right.assignment_id)))[0];
  const pending = tasks.find((task) => task.kind === "review" && task.document_version_id === version?.document_version_id
    && ["open", "waiting", "blocked"].includes(task.status) && task.metadata.review_snapshot);
  const eligible = Boolean(version && ["draft", "review", "approved"].includes(version.status)
    && !["archived", "cancelled", "superseded"].includes(document.status));
  const prepared = Boolean(approver && ["user", "group"].includes(approver.subject_type)
    && version?.source_file_uri && version.file_hash && version.valid_from);

  async function submit() {
    if (!version || busy || !authorization.can_update || unavailable) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(withAppBasePath(`/api/documents/${encodeURIComponent(document.document_id)}/versions/${encodeURIComponent(version.document_version_id)}/submit-review`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: comment.trim() || null }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
        throw new Error(documentReviewError(body?.error?.code, response.status, language));
      }
      setComment("");
      setFeedback({ error: false, text: cs ? "Verze byla předána přiřazenému schvalovateli." : "The version was submitted to the assigned approver." });
      router.refresh();
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : documentReviewError(undefined, 503, language) });
    } finally { setBusy(false); }
  }

  return <section className="document-review-panel stack" aria-label={cs ? "Předání verze ke schválení" : "Submit version for approval"}>
    <div className="document-review-panel__heading"><h2>{cs ? "Schválení verze" : "Version approval"}</h2><StatusBadge value={version?.status ?? "draft"} label={documentStatusLabel(version?.status ?? "draft", language)} /></div>
    <dl className="detail-kv-grid">
      <div className="detail-kv"><dt>{cs ? "Verze k rozhodnutí" : "Version for decision"}</dt><dd>{version?.version_label ?? (cs ? "Verze chybí" : "No version")}</dd></div>
      <div className="detail-kv"><dt>{cs ? "Schvalovatel" : "Approver"}</dt><dd>{approver?.display_label || (approver ? (cs ? "Přiřazený schvalovatel" : "Assigned approver") : (cs ? "Není přiřazen" : "Not assigned"))}</dd></div>
      {pending ? <div className="detail-kv"><dt>{cs ? "Termín rozhodnutí" : "Decision due"}</dt><dd>{formatDateTime(pending.due_at, language)}</dd></div> : null}
    </dl>
    {unavailable ? <p className="notice notice--danger" role="alert">{cs ? "Stav schvalování nyní nelze ověřit. Předání není dostupné." : "Review state could not be verified. Submission is unavailable."}</p>
      : pending ? <div className="task-actions"><StatusBadge value="warning" label={cs ? "Čeká na rozhodnutí" : "Awaiting decision"} />{pending.assigned_to_me ? <StratosButtonLink href={`/tasks?view=approvals&task=${encodeURIComponent(pending.task_id)}`}><ClipboardCheck size={16} aria-hidden="true" />{cs ? "Otevřít k rozhodnutí" : "Open decision"}</StratosButtonLink> : null}</div>
        : version?.status === "approved" ? <p className="notice">{cs ? "Verze je schválena, ale ještě není zveřejněna." : "This version is approved but not yet published."}</p> : null}
    {eligible && authorization.can_update && !unavailable ? <>
      {!prepared ? <p className="notice notice--warning">{!approver ? (cs ? "Nejprve přiřaďte schvalovatele v odpovědnostech dokumentu." : "Assign an approver in document responsibilities first.") : (cs ? "Před předáním musí být připraven originál, datum účinnosti a schvalovatel typu osoba nebo skupina." : "Submission requires an original, an effective date and a person or group approver.")}</p> : null}
      <label className="field" htmlFor="document-review-comment"><span>{cs ? "Poznámka pro schvalovatele" : "Note to approver"}</span><textarea id="document-review-comment" maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} disabled={busy} /></label>
      <div className="task-actions"><StratosButton type="button" tone={pending || version?.status === "approved" ? "default" : "primary"} disabled={!prepared || busy} onClick={() => void submit()}><Send size={16} aria-hidden="true" />{busy ? (cs ? "Předávám" : "Submitting") : pending || version?.status === "approved" ? (cs ? "Znovu předat ke schválení" : "Resubmit for approval") : (cs ? "Předat ke schválení" : "Submit for approval")}</StratosButton></div>
    </> : null}
    {feedback ? <div className={`notice ${feedback.error ? "notice--danger" : ""}`} role={feedback.error ? "alert" : "status"}>{feedback.text}</div> : null}
  </section>;
}
