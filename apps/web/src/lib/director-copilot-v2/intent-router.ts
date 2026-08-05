import { resolveConversationQuery } from "@/lib/director-copilot/query-state";

import type { DirectorCopilotIntent } from "./shared";

const CONTRACT_SIGNAL = /(smlouv|contract|dodavatel|supplier|rizik|risk)/i;
const DOCUMENT_SIGNAL = /(dokument|priloh|smernic|metodik|citac|soubor|pdf)/i;
const ACCESS_SIGNAL = /(pristup|opravnen|access|permission)/i;
const ACCESS_MUTATION_SIGNAL = /(pozad|zadat|pridel|pridej|nastav|zmen|odebr|zrus|schval|vytvor)/i;
const ACCESS_OVERVIEW_SIGNAL = /(mam|mas|mame|mohu|muz|vidim|dostup|over|zkontrol|k jakym|jaky mam)/i;
const PROJECTFLOW_SIGNAL = /project\s*flow|projectflow/i;
const PROJECT_DATA_SIGNAL = /(stav|prehled|seznam|evid|kolik|ktere|jake|projekt|milnik|harmonogram|termin|zpozd)/i;

/** Classifies only bounded live-data intents; it never grants access. */
export function classifyDirectorCopilotV2Intent(
  message: string,
  context: Record<string, unknown> = {},
): DirectorCopilotIntent | null {
  const normalized = normalizeForIntent(message);
  const resolved = resolveConversationQuery({ message, context });
  if (!resolved.recognized) return null;
  const explicitProjectFlow = PROJECTFLOW_SIGNAL.test(normalized);
  const documentQuestion = DOCUMENT_SIGNAL.test(normalized);
  const accessQuestion = ACCESS_SIGNAL.test(normalized);
  const accessMutation = accessQuestion && ACCESS_MUTATION_SIGNAL.test(normalized);
  const accessOverview = accessQuestion && ACCESS_OVERVIEW_SIGNAL.test(normalized);
  if (
    explicitProjectFlow && accessOverview && !accessMutation
    && !PROJECT_DATA_SIGNAL.test(normalized.replace(PROJECTFLOW_SIGNAL, ""))
  ) return "project_access_overview";
  if (accessMutation || (documentQuestion && !explicitProjectFlow)) return null;
  const sourceSet = new Set(resolved.state.sources);
  if (sourceSet.has("archflow")) return "archflow_demand_overview";
  if (sourceSet.has("budget") && sourceSet.has("projectflow")) {
    return CONTRACT_SIGNAL.test(normalized) || resolved.state.document_evidence_requested
      ? "portfolio_risk_correlation"
      : "portfolio_performance_overview";
  }
  if (sourceSet.has("budget")) return "budget_portfolio_status";
  if (sourceSet.has("projectflow")) return "project_portfolio_status";
  return null;
}

function normalizeForIntent(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}
