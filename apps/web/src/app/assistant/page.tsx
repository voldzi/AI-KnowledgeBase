import { EmployeeAssistant } from "@/features/assistant/employee-assistant";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { redirectEmployeeChatOnly } from "@/lib/auth/server-route-guard";
import type { AssistantSuggestion } from "@/lib/types";

export const dynamic = "force-dynamic";

const FALLBACK_SUGGESTIONS: AssistantSuggestion[] = [
  { label: "Nový přístup", prompt: "Jak požádám o nový přístup?", domain: "Service Desk", audience: "employee" },
  { label: "Nahlásit incident", prompt: "Jak nahlásím incident?", domain: "IT podpora", audience: "employee" },
  { label: "Kdo schvaluje výjimku", prompt: "Kdo schvaluje výjimku ze směrnice?", domain: "Dokumentace", audience: "employee" },
  { label: "Architektura platformy", prompt: "Jaká je architektura AKB platformy?", domain: "Dokumentace", audience: "employee" }
];

export default async function AssistantPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/assistant");
  redirectEmployeeChatOnly(context);
  let suggestions = FALLBACK_SUGGESTIONS;

  try {
    suggestions = (await clients.rag.assistantSuggestions(context)).suggestions;
  } catch {
    suggestions = FALLBACK_SUGGESTIONS;
  }

  return <EmployeeAssistant suggestions={suggestions} />;
}
