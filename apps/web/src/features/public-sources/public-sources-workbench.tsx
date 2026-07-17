"use client";

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, CloudDownload, ExternalLink, FileCheck2, RefreshCw, ShieldCheck } from "lucide-react";

import { StratosButton } from "@/components/stratos/button";
import { withAppBasePath } from "@/lib/app-url";
import type { PublicSourceCandidate, PublicSourceDiscoveryResult } from "@/lib/public-sources/discovery";
import type { PublicSourceCollection } from "@/lib/public-sources/catalog";

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
  discovering: boolean;
  syncing: boolean;
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
  discovering: false,
  syncing: false,
  completed: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: 0,
  error: null,
});

export function PublicSourcesWorkbench({
  collections,
  importedByCollection,
  importedTotal,
  validTotal,
  targetTotal,
}: PublicSourcesWorkbenchProps) {
  const [states, setStates] = useState<Record<string, CollectionState>>({});
  const cancelRef = useRef<Record<string, boolean>>({});
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
    const candidates = states[collection.id]?.candidates ?? [];
    if (candidates.length === 0) return;
    cancelRef.current[collection.id] = false;
    update(collection.id, (current) => ({
      ...current,
      syncing: true,
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
          const response = await fetch(withAppBasePath("/api/public-sources/sync"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              collection_id: collection.id,
              source_url: candidate.sourceUrl,
              canonical_url: candidate.canonicalUrl,
              title: candidate.title,
            }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(errorMessage(body));
          const action = body.action as "created" | "updated" | "unchanged";
          update(collection.id, (current) => ({
            ...current,
            completed: current.completed + 1,
            [action]: current[action] + 1,
          }));
        } catch (error) {
          update(collection.id, (current) => ({
            ...current,
            completed: current.completed + 1,
            failed: current.failed + 1,
            error: error instanceof Error ? error.message : "Jedna položka se nepodařila synchronizovat.",
          }));
        }
      }
    };
    await Promise.all([worker(), worker()]);
    update(collection.id, (current) => ({ ...current, syncing: false }));
  }

  return (
    <div className="public-sources">
      <section className="public-sources__metrics" aria-label="Souhrn veřejných zdrojů">
        <Metric label="Cílový katalog" value={targetTotal} detail="oficiálních dokumentů" />
        <Metric label="Dostupné bez API registrace" value={availableTarget} detail="automatizovatelných nyní" />
        <Metric label="Uloženo v AKB" value={importedTotal + createdThisSession} detail={`${validTotal + createdThisSession} platných verzí`} />
        <Metric label="Režim přístupu" value="ORG" detail="veřejný původ, přístup uživatelům STRATOS" />
      </section>

      <section className="public-sources__principles">
        <div><ShieldCheck aria-hidden="true" /><span><strong>Jedno schválení kolekce</strong> nahrazuje ruční schvalování každého veřejného originálu.</span></div>
        <div><FileCheck2 aria-hidden="true" /><span><strong>Hash a neměnné verze</strong> odliší aktualizaci, archiv a duplicitní stažení.</span></div>
        <div><CloudDownload aria-hidden="true" /><span><strong>Originál zůstává v AKB</strong>; citace uvádí autoritu, verzi a kanonický zdroj.</span></div>
      </section>

      <div className="public-sources__grid">
        {collections.map((collection) => {
          const state = states[collection.id] ?? emptyState();
          const progress = state.candidates.length > 0
            ? Math.round((state.completed / state.candidates.length) * 100)
            : 0;
          return (
            <article className="public-source-card" key={collection.id}>
              <header className="public-source-card__header">
                <div>
                  <span className="public-source-card__authority">{collection.authority}</span>
                  <h2>{collection.name}</h2>
                  <p>{collection.description}</p>
                </div>
                <span className="public-source-card__status is-ready">Připraveno</span>
              </header>

              <div className="public-source-card__numbers">
                <span><strong>{(importedByCollection[collection.id] ?? 0) + state.created}</strong> v AKB</span>
                <span><strong>{collection.targetDocuments}</strong> cíl</span>
                <span><strong>{state.candidates.length || "—"}</strong> nalezeno</span>
              </div>

              <p className="public-source-card__license">{collection.licenseNote}</p>

              {state.candidates.length > 0 ? (
                <div className="public-source-card__preview">
                  {state.candidates.slice(0, 4).map((candidate) => (
                    <span key={candidate.sourceUrl}>{candidate.title}</span>
                  ))}
                  {state.candidates.length > 4 ? <small>+ {state.candidates.length - 4} dalších dokumentů</small> : null}
                </div>
              ) : null}

              {state.syncing || state.completed > 0 ? (
                <div className="public-source-card__progress">
                  <div><span style={{ width: `${progress}%` }} /></div>
                  <p>{state.completed} / {state.candidates.length} · nové {state.created} · změněné {state.updated} · beze změny {state.unchanged} · chyby {state.failed}</p>
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
                  disabled={state.syncing || state.discovering || state.candidates.length === 0}
                >
                  <CheckCircle2 aria-hidden="true" /> {state.syncing ? "Synchronizuji…" : "Synchronizovat kolekci"}
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
