"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, CloudDownload, ExternalLink, FileCheck2, RefreshCw, ShieldCheck } from "lucide-react";

import { StratosButton } from "@/components/stratos/button";
import { withAppBasePath } from "@/lib/app-url";
import type { PublicSourceCandidate, PublicSourceDiscoveryResult } from "@/lib/public-sources/discovery";
import type { PublicSourceCollection } from "@/lib/public-sources/catalog";
import { selectPublicSourceCandidates } from "@/lib/public-sources/selection";
import type { ApprovedPublicSourceCollection } from "@/lib/public-sources/approved-collections";

interface PublicSourcesWorkbenchProps {
  collections: PublicSourceCollection[];
  importedByCollection: Record<string, number>;
  importedTotal: number;
  validTotal: number;
  targetTotal: number;
}

type CollectionState = {
  candidates: PublicSourceCandidate[];
  pagesVisited: number;
  warnings: string[];
  query: string;
  discovering: boolean;
  syncing: boolean;
  syncTotal: number;
  completed: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  error: string | null;
};

const emptyState = (): CollectionState => ({
  candidates: [],
  pagesVisited: 0,
  warnings: [],
  query: "",
  discovering: false,
  syncing: false,
  syncTotal: 0,
  completed: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: 0,
  error: null,
});

class PublicSourceSyncResponseError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "PublicSourceSyncResponseError";
  }
}

async function synchronizeCandidate(
  collection: PublicSourceCollection,
  candidate: PublicSourceCandidate,
  approval: ApprovedPublicSourceCollection,
): Promise<"created" | "updated" | "unchanged"> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(withAppBasePath("/api/public-sources/sync"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          collection_id: collection.id,
          collection_revision: approval.revision,
          source_url: candidate.sourceUrl,
          canonical_url: candidate.canonicalUrl,
          title: candidate.title,
          version_label: candidate.versionLabel,
          effective_from: candidate.effectiveFrom,
          effective_to: candidate.effectiveTo,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new PublicSourceSyncResponseError(errorMessage(body), response.status, body.error?.code);
      return body.action as "created" | "updated" | "unchanged";
    } catch (error) {
      if (attempt === 2 || !isRetryableCandidateError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Jedna položka se nepodařila synchronizovat.");
}

function isRetryableCandidateError(error: unknown): boolean {
  if (error instanceof PublicSourceSyncResponseError) {
    return error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError
    || error instanceof SyntaxError
    || (error instanceof Error && /failed to fetch/i.test(error.message));
}

export function PublicSourcesWorkbench({
  collections,
  importedByCollection,
  importedTotal,
  validTotal,
  targetTotal,
}: PublicSourcesWorkbenchProps) {
  const [states, setStates] = useState<Record<string, CollectionState>>({});
  const cancelRef = useRef<Record<string, boolean>>({});
  const [approvals, setApprovals] = useState<ApprovedPublicSourceCollection[]>([]);
  const [approvalStatus, setApprovalStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [approvalRefresh, setApprovalRefresh] = useState(0);
  const anySyncing = Object.values(states).some((state) => state.syncing);
  useEffect(() => {
    const controller = new AbortController();
    setApprovalStatus("loading");
    setApprovals([]);
    setSelectedCollection("");
    setApprovalError(null);
    void (async () => {
      try {
        const response = await fetch(withAppBasePath("/api/public-sources/collections"), {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(errorMessage(body));
        if (!Array.isArray(body.collections)) throw new Error("Seznam schválených kolekcí nemá očekávaný tvar.");
        if (controller.signal.aborted) return;
        setApprovals(body.collections);
        setApprovalStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setApprovalStatus("unavailable");
        setApprovalError(error instanceof Error ? error.message : "Schválené kolekce nejsou nyní dostupné.");
      }
    })();
    return () => controller.abort();
  }, [approvalRefresh]);
  const availableTarget = useMemo(
    () => collections.reduce((sum, item) => sum + item.targetDocuments, 0),
    [collections],
  );
  const createdThisSession = useMemo(
    () => Object.values(states).reduce((sum, state) => sum + state.created, 0),
    [states],
  );

  const update = (id: string, recipe: (current: CollectionState) => CollectionState) => {
    setStates((current) => ({ ...current, [id]: recipe(current[id] ?? emptyState()) }));
  };

  async function discover(collection: PublicSourceCollection) {
    update(collection.id, (current) => ({ ...current, discovering: true, error: null }));
    try {
      const response = await fetch(withAppBasePath("/api/public-sources/discover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ collection_id: collection.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessage(body));
      const result = body as PublicSourceDiscoveryResult;
      update(collection.id, (current) => ({
        ...current,
        candidates: result.candidates,
        pagesVisited: result.pagesVisited,
        warnings: result.warnings,
        discovering: false,
        error: null,
      }));
    } catch (error) {
      update(collection.id, (current) => ({
        ...current,
        discovering: false,
        error: error instanceof Error ? error.message : "Oficiální katalog se nepodařilo načíst.",
      }));
    }
  }

  async function synchronize(collection: PublicSourceCollection) {
    const approval = approvals.find((item) => item.collectionId === collection.id);
    if (approvalStatus !== "ready" || selectedCollection !== collection.id || !approval) return;
    const currentState = states[collection.id] ?? emptyState();
    const candidates = selectPublicSourceCandidates(
      currentState.candidates,
      currentState.query,
    );
    if (candidates.length === 0) return;
    cancelRef.current[collection.id] = false;
    update(collection.id, (current) => ({
      ...current,
      syncing: true,
      syncTotal: candidates.length,
      completed: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      error: null,
    }));

    let cursor = 0;
    const worker = async () => {
      while (cursor < candidates.length && !cancelRef.current[collection.id]) {
        const candidate = candidates[cursor];
        cursor += 1;
        try {
          const action = await synchronizeCandidate(collection, candidate, approval);
          update(collection.id, (current) => ({
            ...current,
            completed: current.completed + 1,
            [action]: current[action] + 1,
          }));
        } catch (error) {
          if (error instanceof PublicSourceSyncResponseError && (
            error.code?.startsWith("PUBLIC_SOURCE_APPROVAL_") || error.code === "PUBLIC_SOURCE_ROOT_METADATA_CONFLICT" || error.code === "DOCUMENT_TLP_REQUIRED"
          )) {
            cancelRef.current[collection.id] = true;
            setApprovals([]);
            setSelectedCollection("");
            setApprovalStatus("unavailable");
            setApprovalError("Schválení příjmu je nutné znovu ověřit. Obnovte seznam kolekcí.");
          }
          update(collection.id, (current) => ({
            ...current,
            completed: current.completed + 1,
            failed: current.failed + 1,
            error: error instanceof Error ? error.message : "Jedna položka se nepodařila synchronizovat.",
          }));
        }
      }
    };
    const workerCount = collection.id === "czech-law" ? 1 : 2;
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    update(collection.id, (current) => ({ ...current, syncing: false }));
  }

  return (
    <div className="public-sources">
      <section className="public-sources__metrics" aria-label="Souhrn veřejných zdrojů">
        <Metric label="Cílový katalog" value={targetTotal} detail="oficiálních dokumentů" />
        <Metric label="Ve zdrojových katalozích" value={availableTarget} detail="příjem vyžaduje schválenou politiku" />
        <Metric label="Uloženo v AKB" value={importedTotal + createdThisSession} detail={`${validTotal + createdThisSession} platných verzí`} />
        <Metric label="Režim přístupu" value="ORG" detail="veřejný původ, přístup uživatelům STRATOS" />
      </section>

      <section className="public-sources__approval" aria-label="Schválení příjmu veřejných zdrojů">
        <label htmlFor="public-source-approved-collection"><strong>Schválená kolekce</strong></label>
        <select id="public-source-approved-collection" value={selectedCollection}
          disabled={approvalStatus !== "ready" || anySyncing || approvals.length === 0}
          onChange={(event) => setSelectedCollection(event.target.value)}>
          <option value="">{approvalStatus === "loading" ? "Ověřuji schválené kolekce…" : "Vyberte kolekci pro příjem"}</option>
          {approvals.map((item) => <option key={item.collectionId} value={item.collectionId}>{item.displayName}</option>)}
        </select>
        <StratosButton type="button" disabled={anySyncing || approvalStatus === "loading"} onClick={() => setApprovalRefresh((value) => value + 1)}>
          <RefreshCw aria-hidden="true" /> Obnovit schválení
        </StratosButton>
        <p role="status" aria-live="polite">{approvalStatus === "unavailable" ? approvalError
          : approvalStatus === "loading" ? "Načítám aktuální schválení ze STRATOS."
            : approvals.length === 0 ? "Pro příjem zatím není schválena žádná kolekce. Schválení nastavuje správce ve STRATOS."
              : "Před každým příjmem znovu ověříme pravidla, původ a odpovědnost konkrétního dokumentu."}</p>
        {approvals.filter((item) => item.collectionId === selectedCollection).map((item) => <p key={item.collectionId}>
          Vydavatel: <strong>{item.authorityDisplayName}</strong> · Vlastník: <strong>{item.ownerDisplayName}</strong> · Gestor: <strong>{item.gestorDisplayName}</strong> · {item.reviewRuleLabel} · {item.tlp}
        </p>)}
      </section>

      <section className="public-sources__principles">
        <div><ShieldCheck aria-hidden="true" /><span><strong>Schválená politika s TLP:CLEAR</strong> je podmínkou příjmu kolekce. Veřejná adresa ji nenahrazuje.</span></div>
        <div><FileCheck2 aria-hidden="true" /><span><strong>Hash a neměnné verze</strong> odliší aktualizaci, archiv a duplicitní stažení.</span></div>
        <div><CloudDownload aria-hidden="true" /><span><strong>Originál zůstává v AKB</strong>; citace uvádí autoritu, verzi a kanonický zdroj.</span></div>
      </section>

      <div className="public-sources__grid">
        {collections.filter((collection) => !selectedCollection || collection.id === selectedCollection).map((collection) => {
          const state = states[collection.id] ?? emptyState();
          const selectedCandidates = selectPublicSourceCandidates(state.candidates, state.query);
          const progress = state.syncTotal > 0
            ? Math.round((state.completed / state.syncTotal) * 100)
            : 0;
          return (
            <article className="public-source-card" key={collection.id}>
              <header className="public-source-card__header">
                <div>
                  <span className="public-source-card__authority">{collection.authority}</span>
                  <h2>{collection.name}</h2>
                  <p>{collection.description}</p>
                </div>
                <span className="public-source-card__status">Zdrojový katalog</span>
              </header>

              <div className="public-source-card__numbers">
                <span><strong>{(importedByCollection[collection.id] ?? 0) + state.created}</strong> v AKB</span>
                <span><strong>{collection.targetDocuments}</strong> cíl</span>
                <span><strong>{state.candidates.length || "—"}</strong> nalezeno</span>
              </div>

              <p className="public-source-card__license">{collection.licenseNote}</p>

              {state.candidates.length > 0 ? (
                <div className="public-source-card__selection">
                  <label htmlFor={`public-source-filter-${collection.id}`}>
                    Vybrat podle názvu nebo čísla
                  </label>
                  <input
                    id={`public-source-filter-${collection.id}`}
                    type="search"
                    value={state.query}
                    placeholder="Např. 134/2016, 172/2016"
                    disabled={state.syncing}
                    onChange={(event) => update(collection.id, (current) => ({
                      ...current,
                      query: event.target.value,
                    }))}
                  />
                  <small>
                    {state.query.trim()
                      ? `${selectedCandidates.length} z ${state.candidates.length} znění odpovídá výběru`
                      : `Vybrána celá kolekce: ${state.candidates.length} znění`}
                  </small>
                  <div className="public-source-card__preview">
                    {selectedCandidates.slice(0, 4).map((candidate) => (
                      <span key={candidate.sourceUrl}>
                        {candidate.title}
                        {candidate.effectiveFrom
                          ? ` · účinné ${candidate.effectiveFrom}${candidate.effectiveTo ? ` až ${candidate.effectiveTo}` : " dosud"}`
                          : ""}
                      </span>
                    ))}
                    {selectedCandidates.length > 4 ? <small>+ {selectedCandidates.length - 4} dalších dokumentů</small> : null}
                    {selectedCandidates.length === 0 ? <small>Výběru neodpovídá žádné znění.</small> : null}
                  </div>
                </div>
              ) : null}

              {state.syncing || state.completed > 0 ? (
                <div className="public-source-card__progress">
                  <div><span style={{ width: `${progress}%` }} /></div>
                  <p>{state.completed} / {state.syncTotal} · nové {state.created} · změněné {state.updated} · beze změny {state.unchanged} · chyby {state.failed}</p>
                </div>
              ) : null}

              {state.error ? <p className="public-source-card__error"><CircleAlert aria-hidden="true" />{state.error}</p> : null}
              {state.warnings.length > 0 ? <p className="public-source-card__warning">{state.warnings[0]}</p> : null}

              <footer className="public-source-card__actions">
                <a href={collection.homepage} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" /> Oficiální web
                </a>
                <StratosButton type="button" onClick={() => void discover(collection)} disabled={state.syncing || state.discovering}>
                  <RefreshCw aria-hidden="true" /> {state.discovering ? "Načítám…" : "Načíst katalog"}
                </StratosButton>
                <StratosButton
                  type="button"
                  tone="primary"
                  onClick={() => void synchronize(collection)}
                  disabled={state.syncing || state.discovering || selectedCandidates.length === 0 || approvalStatus !== "ready"
                    || selectedCollection !== collection.id || !approvals.some((item) => item.collectionId === collection.id)}
                >
                  <CheckCircle2 aria-hidden="true" /> {state.syncing
                    ? "Synchronizuji…"
                    : state.query.trim()
                      ? `Synchronizovat výběr (${selectedCandidates.length})`
                      : "Synchronizovat kolekci"}
                </StratosButton>
                {state.syncing ? (
                  <StratosButton type="button" onClick={() => { cancelRef.current[collection.id] = true; }}>
                    Zastavit po aktuální položce
                  </StratosButton>
                ) : null}
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function errorMessage(value: unknown): string {
  if (!value || typeof value !== "object") return "Požadavek se nepodařilo dokončit.";
  const error = (value as { error?: unknown }).error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "Požadavek se nepodařilo dokončit.";
}
