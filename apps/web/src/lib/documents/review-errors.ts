const messages: Record<string, [string, string]> = {
  review_assignee_required: ["Chybí přiřazený schvalovatel nebo nejste osobou určenou ke schválení.", "An assigned approver is required, and only that approver may decide."],
  review_human_required: ["Schválení musí provést přihlášený uživatel.", "An authenticated person must perform the review."],
  review_self_approval_forbidden: ["O předané verzi musí rozhodnout jiný oprávněný schvalovatel.", "Another authorized approver must decide the submitted version."],
  review_source_incomplete: ["Nejprve doplňte originální soubor a datum účinnosti verze.", "Add the original file and the version effective date first."],
  review_scan_incomplete: ["Bezpečnostní kontrola zdroje není úspěšně dokončena.", "The source security scan has not completed successfully."],
  review_source_changed: ["Verze, její údaje nebo schvalovatel se změnili. Gestor musí dokument znovu předat ke schválení.", "The source, its details or approver changed. Submit a new review."],
  review_task_not_active: ["Tento úkol již byl vyřízen. Obnovte přehled úkolů.", "This task has already been completed. Refresh the task list."],
  review_version_required: ["Úkol nemá určenou verzi. Gestor musí předat konkrétní verzi ke schválení.", "The task has no version. Submit a specific version for review."],
  review_version_not_eligible: ["Ke schválení lze předat pouze nejnovější nezveřejněnou verzi.", "Only the latest unpublished version can be submitted for review."],
  review_action_required: ["Použijte schválení konkrétní verze a následně její zveřejnění.", "Use the version review decision, then publish the approved version."],
  review_assignment_immutable: ["Schvalovatele nelze změnit současně s rozhodnutím.", "The approver cannot be changed as part of a decision."],
  publish_requires_approval: ["Tato verze ještě není schválená ke zveřejnění.", "This version has not yet been approved for publication."],
};

export function documentReviewError(code: string | undefined, status: number, language: "cs" | "en"): string {
  const known = messages[code?.toLowerCase() ?? ""];
  if (known) return known[language === "cs" ? 0 : 1];
  if (status === 401) return language === "cs" ? "Přihlášení vypršelo. Přihlaste se znovu." : "Your session expired. Sign in again.";
  if (status === 403) return language === "cs" ? "Pro tuto akci nemáte aktuální oprávnění." : "You do not currently have permission for this action.";
  if (status >= 500) return language === "cs" ? "Služba není dostupná. Rozhodnutí nebylo potvrzeno; obnovte přehled před opakováním." : "The service is unavailable. The decision was not confirmed; refresh before retrying.";
  return language === "cs" ? "Akci se nepodařilo dokončit. Obnovte dokument a zkontrolujte jeho stav." : "The action could not be completed. Refresh and check the document status.";
}
