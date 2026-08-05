import type { ConversationQueryState } from "@/lib/director-copilot/query-state";

import type {
  DirectorCopilotV2Item,
  DirectorCopilotV2Manifest,
} from "./contracts";
import type { DirectorCopilotV2ManifestCatalog } from "./manifest-catalog";
import type { DirectorCopilotV2SourceOutcome } from "./orchestrator";

const MAX_CONTINUATION_IDS = 8;

type EntityFilterKey = keyof ConversationQueryState["entity_filters"];

interface Selection {
  key: EntityFilterKey;
  id: string;
}

export function directorCopilotV2ContinuationQueryState(
  state: ConversationQueryState,
  outcomes: DirectorCopilotV2SourceOutcome[],
  catalog: DirectorCopilotV2ManifestCatalog,
): ConversationQueryState {
  const next = structuredClone(state);
  const selections = new Map<EntityFilterKey, Set<string>>();

  for (const outcome of outcomes) {
    if (outcome.status !== "complete" && outcome.status !== "partial") continue;
    const manifest = catalog.byTool.get(outcome.tool_id);
    if (!manifest) continue;
    for (const item of focusedItems(state, outcome)) {
      const linkedSelections = preferredLinkedSelections(
        selectionsForTypedLinks(item, manifest),
      );
      if (linkedSelections.length === 0) {
        addSelection(selections, selectionForItem(item));
      }
      for (const selection of linkedSelections) {
        addSelection(selections, selection);
      }
    }
  }

  for (const [key, values] of selections) {
    next.entity_filters[key] = [...values].sort().slice(0, MAX_CONTINUATION_IDS);
  }
  return next;
}

function focusedItems(
  state: ConversationQueryState,
  outcome: DirectorCopilotV2SourceOutcome,
): DirectorCopilotV2Item[] {
  if (outcome.candidate_count === 1 && outcome.items.length === 1) {
    return outcome.items;
  }
  if (
    state.operation !== "rank"
    || !state.sort
    || !outcome.authorized_result_complete
    || outcome.candidate_count > outcome.items.length
  ) {
    return [];
  }
  const comparable = outcome.items.flatMap((item) => {
    const fact = item.facts.find((candidate) => candidate.key === state.sort?.metric);
    return typeof fact?.value === "number" ? [{ item, value: fact.value }] : [];
  });
  if (comparable.length !== outcome.items.length) return [];
  const direction = state.sort.direction === "asc" ? 1 : -1;
  return comparable
    .sort((left, right) => (
      (left.value - right.value) * direction
      || left.item.canonical_id.localeCompare(right.item.canonical_id)
    ))
    .slice(0, 1)
    .map(({ item }) => item);
}

function preferredLinkedSelections(selections: Selection[]): Selection[] {
  for (const key of ["project_ids", "need_ids", "idea_ids"] as const) {
    const preferred = selections.filter((selection) => selection.key === key);
    if (preferred.length > 0) return preferred;
  }
  return selections;
}

function selectionForItem(item: DirectorCopilotV2Item): Selection | null {
  const keysByEntityType: Partial<Record<
    DirectorCopilotV2Item["entity_type"],
    EntityFilterKey
  >> = {
    organization_unit: "organization_unit_ids",
    budget_scope: "budget_scope_ids",
    portfolio: "portfolio_ids",
    project: "project_ids",
    need: "need_ids",
    idea: "idea_ids",
  };
  const key = keysByEntityType[item.entity_type];
  if (!key) return null;
  const canonicalPrefixes: Partial<Record<EntityFilterKey, string>> = {
    project_ids: "stratos:project:",
    need_ids: "stratos:need:",
    idea_ids: "stratos:idea:",
  };
  const canonicalPrefix = canonicalPrefixes[key];
  const id = canonicalPrefix && item.canonical_id.startsWith(canonicalPrefix)
    ? item.canonical_id.slice(canonicalPrefix.length)
    : item.entity_id;
  return validId(id) ? { key, id } : null;
}

function selectionsForTypedLinks(
  item: DirectorCopilotV2Item,
  manifest: DirectorCopilotV2Manifest,
): Selection[] {
  return item.links.flatMap((link) => {
    const relationship = manifest.relationships.find((candidate) => (
      candidate.key === link.key
      && candidate.source_entity_type === item.entity_type
      && candidate.target_entity_type === link.target_entity_type
      && candidate.derivation === link.relation_type
      && candidate.location.kind === "link"
      && candidate.location.key === link.key
      && link.target_canonical_id.startsWith(candidate.target_canonical_id_prefix)
    ));
    if (!relationship) return [];
    const key = {
      project: "project_ids",
      need: "need_ids",
      idea: "idea_ids",
    }[relationship.target_entity_type] as EntityFilterKey | undefined;
    if (!key) return [];
    const id = link.target_canonical_id.slice(
      relationship.target_canonical_id_prefix.length,
    );
    return validId(id) ? [{ key, id }] : [];
  });
}

function addSelection(
  selections: Map<EntityFilterKey, Set<string>>,
  selection: Selection | null,
): void {
  if (!selection) return;
  const values = selections.get(selection.key) ?? new Set<string>();
  if (values.size < MAX_CONTINUATION_IDS) values.add(selection.id);
  selections.set(selection.key, values);
}

function validId(value: string): boolean {
  return value.length > 0
    && value.length <= 180
    && /^[A-Za-z0-9._:/-]+$/.test(value);
}
