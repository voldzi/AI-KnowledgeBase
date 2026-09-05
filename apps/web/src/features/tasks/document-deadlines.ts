import type { WorkflowDocument } from "@/lib/types";

export type DocumentDeadline = "expired" | "expires_soon" | "review_overdue" | "review_soon" | "review_missing" | "review_invalid";

export function workflowToday(nowIso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(nowIso));
}

export function documentDeadlines(document: WorkflowDocument, today: string): DocumentDeadline[] {
  if (["archived", "cancelled", "superseded"].includes(document.status)) return [];
  const soon = new Date(`${today}T12:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  const horizon = soon.toISOString().slice(0, 10);
  const result: DocumentDeadline[] = [];
  // A replacement draft must not hide the expiry of the still-published edition.
  const validTo = document.published_version_label ? document.published_valid_to : document.valid_to;
  if (validTo && validTo < today) result.push("expired");
  else if (validTo && validTo <= horizon) result.push("expires_soon");
  if (document.review_date_invalid) result.push("review_invalid");
  else if (!document.review_due_on) result.push("review_missing");
  else if (document.review_due_on < today) result.push("review_overdue");
  else if (document.review_due_on <= horizon) result.push("review_soon");
  return result;
}

export function managesDocument(document: WorkflowDocument): boolean {
  return document.assignment_roles.some((role) => ["owner", "gestor", "steward"].includes(role));
}

export function approvesDocument(document: WorkflowDocument): boolean {
  return document.assignment_roles.some((role) => ["approver", "reviewer"].includes(role));
}

export function urgentDeadline(deadlines: DocumentDeadline[]): boolean {
  return deadlines.some((deadline) => ["expired", "expires_soon", "review_overdue", "review_soon", "review_invalid"].includes(deadline));
}
