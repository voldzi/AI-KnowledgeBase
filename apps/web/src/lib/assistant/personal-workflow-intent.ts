import type { WorkflowDocumentListOptions } from "@/lib/types";

export interface PersonalWorkflowIntent {
  view: "mine" | "approvals" | "documents";
  deadline?: WorkflowDocumentListOptions["deadline"];
}

export function personalWorkflowIntent(message: string): PersonalWorkflowIntent | null {
  const text = message.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // This tool reads the current user's AKB queue, not procedures, other people or live domain tasks.
  if (/\b(projectflow|archflow|budget|projekt\w*|rozpoc\w*|zakaz\w*|dovolen\w*|project\w*)\b/.test(text)
    || /\b(schval|schvalit|publikuj|zverejni|smaz|odstran|prirad|approve|publish|delete|assign)\b/.test(text)
    || /\b(vsech|ostatnich|kolegu|kolegy|jineho|tymu|tym|everyone|team|colleague\w*)\b/.test(text)
    || /\b(vcera|loni|minul\w*|histor\w*|yesterday|last|20\d{2})\b/.test(text)
    || /\b(podle|obsah\w*|stanov\w*|porovnej|shrn\w*|obliben\w*|schvalen(?:e|y|a|ych|ou|emu|eho)|vyresen\w*|zrusen\w*|nejdulezitejsi|priorit\w*|podrob\w*|detail\w*|according|contain\w*|summari\w*|compare|favorite\w*|approved|resolved|cancelled|priorit\w*)\b/.test(text)
    || /\b(do konce|tento tyden|tento mesic|pristi\w*|zitra|tomorrow|this week|this month|next week)\b/.test(text)
    || /\b(jak|how)\b.*\b(schvalovat|schvaluj\w*|postup\w*|nastavit|vytvorit|create|approval process)\b/.test(text)) {
    return null;
  }
  const personal = /\b(moje|moji|mojim|mych|mym|me|muj|mam|mne|mi|spravuji|my|mine|i have|for me)\b/.test(text);
  if (!personal) return null;
  if (/\b(ke schvaleni|k posouzeni|na schvaleni|cek\w*.*schvaleni|pending approvals?|approvals? pending)\b/.test(text)) {
    return { view: "approvals" };
  }
  if (/\b(ukol\w*|moje prace|tasks?|work queue|inbox)\b/.test(text)) {
    if (/\b(termin\w*|lhut\w*|zpozden\w*|overdue|deadlines?)\b/.test(text)) return null;
    return { view: "mine" };
  }
  if (/\b(dokument\w*|smernic\w*|predpis\w*|documents?|directives?)\b/.test(text)
    && /\b(moje|moji|mojim|mych|mym|me|muj|my|mine|spravuji|gestor\w*)\b/.test(text)) {
    if (/\b(po platnosti|expirovan\w*|expired)\b/.test(text)) return { view: "documents", deadline: "expired" };
    if (/\b(reviz\w*|review\w*)\b/.test(text)) return { view: "documents", deadline: "review" };
    if (/\b(pozornost|termin\w*|attention|deadlines?)\b/.test(text)) return { view: "documents", deadline: "attention" };
    // Do not silently turn a specific content, expiry or approval query into an unfiltered inventory.
    if (/\b(obsah\w*|podle|co rika|konci|platnost\w*|expire\w*|contain\w*)\b/.test(text)) return null;
    return { view: "documents" };
  }
  return null;
}
