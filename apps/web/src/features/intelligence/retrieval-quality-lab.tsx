"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  Gauge,
  Play,
  SearchX,
  ShieldCheck
} from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import {
  StratosButton,
  StratosDataTable,
  StratosSelect,
  type StratosDataTableColumn
} from "@/components/stratos";
import { withAppBasePath } from "@/lib/app-url";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";
import type {
  DocumentReadinessIssue,
  DocumentReadinessReport,
  EvaluationCaseResult,
  EvaluationDatasetSummary,
  EvaluationQualityGateCheck,
  EvaluationQualityOverview,
  EvaluationRunSummary,
  EvaluationSliceSummary
} from "@/lib/types";

interface RetrievalQualityLabProps {
  initialOverview: EvaluationQualityOverview;
  readiness: DocumentReadinessReport;
  serviceAvailable: boolean;
}

const copy = {
  cs: {
    metrics: "Metriky kvality vyhledávání",
    gate: "Quality gate",
    gatePassed: "Splněno",
    gateFailed: "Nesplněno",
    gateMissing: "Bez baseline",
    gateDetail: "produkční regresní brána",
    recall: "Recall",
    recallDetail: "nalezené očekávané zdroje",
    falseZeros: "Falešná nula",
    falseZerosDetail: "odpověditelné dotazy bez výsledku",
    latency: "Retrieval p95",
    latencyDetail: "95. percentil odezvy",
    baseline: "Evaluační baseline",
    dataset: "Dataset",
    run: "Spustit měření",
    running: "Měřím kvalitu",
    bootstrap: "Vytvořit baseline korpusu",
    bootstrapping: "Připravuji baseline",
    noDataset: "Nejdřív vytvořte baseline korpusu.",
    serviceUnavailable: "Evaluation Service není dostupná.",
    operationFailed: "Operaci se nepodařilo dokončit.",
    maturity: "Vyspělost datasetu",
    draft: "draft",
    silver: "silver",
    gold: "gold",
    cases: "dotazů",
    private: "soukromý",
    shared: "sdílený",
    checks: "Regresní brána",
    check: "Kontrola",
    actual: "Naměřeno",
    threshold: "Limit",
    result: "Výsledek",
    notEvaluated: "neměřeno",
    passed: "splněno",
    failed: "nesplněno",
    history: "Historie měření",
    runId: "Běh",
    status: "Stav",
    score: "Skóre",
    ndcg: "nDCG",
    finished: "Dokončeno",
    regression: "Regrese",
    noRegression: "bez regrese",
    noRuns: "Zatím nebylo spuštěno žádné měření.",
    diagnostics: "Diagnostika selhání",
    case: "Testovací dotaz",
    category: "Kategorie",
    failureStage: "Místo selhání",
    retrieved: "Nálezů",
    noFailures: "Poslední běh nemá selhané případy.",
    slices: "Kvalita podle role",
    role: "Role",
    corpus: "Připravenost korpusu",
    ready: "Připraveno",
    review: "K revizi",
    blocked: "Blokováno",
    corpusScore: "Skóre korpusu",
    issues: "Nejčastější problémy",
    issue: "Dokument",
    recommendation: "Doporučená oprava",
    noIssues: "Korpus nemá evidované problémy připravenosti.",
    generated: "Aktualizováno",
    selectPlaceholder: "Vyberte dataset"
  },
  en: {
    metrics: "Retrieval quality metrics",
    gate: "Quality gate",
    gatePassed: "Passed",
    gateFailed: "Failed",
    gateMissing: "No baseline",
    gateDetail: "production regression gate",
    recall: "Recall",
    recallDetail: "expected sources retrieved",
    falseZeros: "False zero",
    falseZerosDetail: "answerable queries without results",
    latency: "Retrieval p95",
    latencyDetail: "95th response percentile",
    baseline: "Evaluation baseline",
    dataset: "Dataset",
    run: "Run evaluation",
    running: "Evaluating",
    bootstrap: "Create corpus baseline",
    bootstrapping: "Building baseline",
    noDataset: "Create a corpus baseline first.",
    serviceUnavailable: "Evaluation Service is unavailable.",
    operationFailed: "The operation could not be completed.",
    maturity: "Dataset maturity",
    draft: "draft",
    silver: "silver",
    gold: "gold",
    cases: "queries",
    private: "private",
    shared: "shared",
    checks: "Regression gate",
    check: "Check",
    actual: "Actual",
    threshold: "Threshold",
    result: "Result",
    notEvaluated: "not evaluated",
    passed: "passed",
    failed: "failed",
    history: "Run history",
    runId: "Run",
    status: "Status",
    score: "Score",
    ndcg: "nDCG",
    finished: "Finished",
    regression: "Regression",
    noRegression: "no regression",
    noRuns: "No evaluation has been run yet.",
    diagnostics: "Failure diagnostics",
    case: "Test query",
    category: "Category",
    failureStage: "Failure stage",
    retrieved: "Retrieved",
    noFailures: "The latest run has no failed cases.",
    slices: "Quality by role",
    role: "Role",
    corpus: "Corpus readiness",
    ready: "Ready",
    review: "Review",
    blocked: "Blocked",
    corpusScore: "Corpus score",
    issues: "Most frequent issues",
    issue: "Document",
    recommendation: "Recommended fix",
    noIssues: "The corpus has no recorded readiness issues.",
    generated: "Updated",
    selectPlaceholder: "Select dataset"
  }
};

export function RetrievalQualityLab({
  initialOverview,
  readiness,
  serviceAvailable
}: RetrievalQualityLabProps) {
  const { language } = useLanguage();
  const t = copy[language];
  const router = useRouter();
  const [selectedDatasetId, setSelectedDatasetId] = useState(
    initialOverview.latest_run?.dataset_id ?? initialOverview.datasets[0]?.dataset_id ?? ""
  );
  const [operation, setOperation] = useState<"idle" | "run" | "bootstrap">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedDatasetId && initialOverview.datasets[0]) {
      setSelectedDatasetId(initialOverview.datasets[0].dataset_id);
    }
  }, [initialOverview.datasets, selectedDatasetId]);

  const selectedDataset = initialOverview.datasets.find(
    (dataset) => dataset.dataset_id === selectedDatasetId
  );
  const latest = initialOverview.latest_run;
  const gate = latest?.quality_gate ?? null;
  const failedCases = useMemo(
    () => latest?.cases.filter((item) => item.status !== "passed").slice(0, 20) ?? [],
    [latest]
  );

  async function createBaseline() {
    setOperation("bootstrap");
    setError("");
    try {
      const response = await fetch(withAppBasePath("/api/intelligence/quality/datasets/bootstrap"), {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const payload = (await response.json()) as { dataset_id?: string; error?: { message?: string } };
      if (!response.ok || !payload.dataset_id) throw new Error(payload.error?.message || t.operationFailed);
      setSelectedDatasetId(payload.dataset_id);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.operationFailed);
    } finally {
      setOperation("idle");
    }
  }

  async function runEvaluation() {
    if (!selectedDatasetId) {
      setError(t.noDataset);
      return;
    }
    setOperation("run");
    setError("");
    try {
      const response = await fetch(withAppBasePath("/api/intelligence/quality/runs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset_id: selectedDatasetId })
      });
      const payload = (await response.json()) as { run_id?: string; error?: { message?: string } };
      if (!response.ok || !payload.run_id) throw new Error(payload.error?.message || t.operationFailed);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.operationFailed);
    } finally {
      setOperation("idle");
    }
  }

  const runColumns: Array<StratosDataTableColumn<EvaluationRunSummary>> = [
    {
      id: "run",
      label: t.runId,
      width: "minmax(220px, 1.2fr)",
      render: (run) => (
        <span className="cell-title">
          <strong>{run.dataset_name}</strong>
          <span>{run.run_id}</span>
        </span>
      )
    },
    {
      id: "status",
      label: t.status,
      width: 130,
      render: (run) => qualityStatus(run.quality_gate?.status, t)
    },
    {
      id: "score",
      label: t.score,
      width: 100,
      render: (run) => formatPercent(run.summary.average_score)
    },
    {
      id: "recall",
      label: t.recall,
      width: 100,
      render: (run) => formatPercent(run.summary.retrieval_recall)
    },
    {
      id: "ndcg",
      label: t.ndcg,
      width: 100,
      render: (run) => formatPercent(run.summary.retrieval_ndcg)
    },
    {
      id: "regression",
      label: t.regression,
      width: 150,
      render: (run) =>
        run.comparison?.regressions.length ? (
          <StatusBadge value="critical" label={`${run.comparison.regressions.length}x`} />
        ) : (
          <span className="muted">{t.noRegression}</span>
        )
    },
    {
      id: "finished",
      label: t.finished,
      width: 170,
      render: (run) => formatDateTime(run.finished_at, language)
    }
  ];

  const checkColumns: Array<StratosDataTableColumn<EvaluationQualityGateCheck>> = [
    { id: "check", label: t.check, width: "minmax(230px, 1fr)", render: (item) => gateLabel(item.key, language) },
    { id: "actual", label: t.actual, width: 140, render: (item) => gateValue(item.key, item.actual) },
    { id: "threshold", label: t.threshold, width: 150, render: (item) => `${item.operator} ${gateValue(item.key, item.threshold)}` },
    { id: "result", label: t.result, width: 140, render: (item) => item.eligible ? qualityStatus(item.passed ? "passed" : "failed", t) : <span className="muted">{t.notEvaluated}</span> }
  ];

  const failureColumns: Array<StratosDataTableColumn<EvaluationCaseResult>> = [
    { id: "case", label: t.case, width: "minmax(190px, 1fr)", render: (item) => <span className="cell-title"><strong>{item.case_id}</strong><span>{item.role}</span></span> },
    { id: "category", label: t.category, width: 170, render: (item) => item.query_category.replaceAll("_", " ") },
    { id: "stage", label: t.failureStage, width: 190, render: (item) => <StatusBadge value={item.failure_stage === "authorization" ? "critical" : "warning"} label={item.failure_stage.replaceAll("_", " ")} /> },
    { id: "recall", label: t.recall, width: 100, render: (item) => formatPercent(item.retrieval_metrics.recall) },
    { id: "retrieved", label: t.retrieved, width: 100, render: (item) => formatNumber(item.retrieval_metrics.retrieved_count, language) }
  ];

  const sliceColumns: Array<StratosDataTableColumn<EvaluationSliceSummary>> = [
    { id: "role", label: t.role, width: "minmax(180px, 1fr)", render: (item) => item.key.replaceAll("_", " ") },
    { id: "cases", label: t.cases, width: 100, render: (item) => formatNumber(item.total_cases, language) },
    { id: "score", label: t.score, width: 100, render: (item) => formatPercent(item.average_score) },
    { id: "recall", label: t.recall, width: 100, render: (item) => formatPercent(item.retrieval_recall) },
    { id: "ndcg", label: t.ndcg, width: 100, render: (item) => formatPercent(item.retrieval_ndcg) },
    { id: "latency", label: t.latency, width: 130, render: (item) => `${Math.round(item.retrieval_latency_p95_ms)} ms` }
  ];

  const issueColumns: Array<StratosDataTableColumn<DocumentReadinessIssue>> = [
    { id: "issue", label: t.issue, width: "minmax(240px, 1fr)", render: (item) => <span className="cell-title"><strong>{item.title}</strong><span>{item.code}</span></span> },
    { id: "severity", label: t.status, width: 120, render: (item) => <StatusBadge value={item.severity} /> },
    { id: "recommendation", label: t.recommendation, width: "minmax(280px, 1.4fr)", render: (item) => item.recommendation }
  ];

  return (
    <div className="stack retrieval-quality-lab">
      <section className="grid grid--metrics" aria-label={t.metrics}>
        <MetricCard
          detail={t.gateDetail}
          icon={gate?.status === "passed" ? CheckCircle2 : ShieldCheck}
          label={t.gate}
          tone={gate?.status === "passed" ? "success" : gate?.status === "failed" ? "danger" : "attention"}
          value={gate?.status === "passed" ? t.gatePassed : gate?.status === "failed" ? t.gateFailed : t.gateMissing}
        />
        <MetricCard detail={t.recallDetail} icon={Gauge} label={t.recall} tone={(latest?.summary.retrieval_recall ?? 0) >= initialOverview.thresholds.retrieval_recall_min ? "success" : "attention"} value={latest ? formatPercent(latest.summary.retrieval_recall) : "-"} />
        <MetricCard detail={t.falseZerosDetail} icon={SearchX} label={t.falseZeros} tone={(latest?.summary.false_zero_result_rate ?? 0) <= initialOverview.thresholds.false_zero_result_rate_max ? "success" : "danger"} value={latest ? formatPercent(latest.summary.false_zero_result_rate) : "-"} />
        <MetricCard detail={t.latencyDetail} icon={Clock3} label={t.latency} tone={(latest?.summary.retrieval_latency_p95_ms ?? 0) <= initialOverview.thresholds.retrieval_latency_p95_ms_max ? "success" : "attention"} value={latest ? `${Math.round(latest.summary.retrieval_latency_p95_ms)} ms` : "-"} />
      </section>

      <section className="panel">
        <div className="panel__header retrieval-quality-lab__header">
          <div><h2>{t.baseline}</h2><span className="muted">{t.generated}: {formatDateTime(initialOverview.generated_at, language)}</span></div>
          {!serviceAvailable ? <StatusBadge value="offline" label={t.serviceUnavailable} /> : null}
        </div>
        <div className="panel__body retrieval-quality-lab__controls">
          <StratosSelect id="quality-dataset" label={t.dataset} value={selectedDatasetId} placeholder={t.selectPlaceholder} onChange={(event) => setSelectedDatasetId(event.target.value)}>
            {initialOverview.datasets.map((dataset) => <option key={dataset.dataset_id} value={dataset.dataset_id}>{dataset.name}</option>)}
          </StratosSelect>
          <div className="retrieval-quality-lab__actions">
            <StratosButton type="button" onClick={() => void createBaseline()} disabled={!serviceAvailable || operation !== "idle"}>
              <DatabaseZap size={16} aria-hidden="true" />
              {operation === "bootstrap" ? t.bootstrapping : t.bootstrap}
            </StratosButton>
            <StratosButton tone="primary" type="button" onClick={() => void runEvaluation()} disabled={!serviceAvailable || !selectedDatasetId || operation !== "idle"}>
              <Play size={16} aria-hidden="true" />
              {operation === "run" ? t.running : t.run}
            </StratosButton>
          </div>
          {selectedDataset ? <DatasetMaturity dataset={selectedDataset} language={language} labels={t} /> : <span className="muted">{t.noDataset}</span>}
          {error ? <p className="retrieval-quality-lab__error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
        </div>
      </section>

      <section className="grid grid--two retrieval-quality-lab__split">
        <div className="panel">
          <div className="panel__header"><h2>{t.checks}</h2>{gate ? qualityStatus(gate.status, t) : null}</div>
          <StratosDataTable rows={gate?.checks ?? []} columns={checkColumns} getRowId={(item) => item.key} emptyLabel={t.gateMissing} aria-label={t.checks} />
        </div>
        <div className="panel">
          <div className="panel__header"><h2>{t.slices}</h2></div>
          <StratosDataTable rows={latest?.summary.role_slices ?? []} columns={sliceColumns} getRowId={(item) => item.key} emptyLabel={t.noRuns} aria-label={t.slices} />
        </div>
      </section>

      <section className="panel">
        <div className="panel__header"><h2>{t.history}</h2></div>
        <StratosDataTable rows={initialOverview.recent_runs} columns={runColumns} getRowId={(run) => run.run_id} emptyLabel={t.noRuns} aria-label={t.history} />
      </section>

      <section className="panel">
        <div className="panel__header"><h2>{t.diagnostics}</h2></div>
        <StratosDataTable rows={failedCases} columns={failureColumns} getRowId={(item) => item.case_id} emptyLabel={t.noFailures} aria-label={t.diagnostics} />
      </section>

      <section className="retrieval-quality-lab__corpus" aria-label={t.corpus}>
        <div className="retrieval-quality-lab__section-title"><div><h2>{t.corpus}</h2><span>{t.generated}: {formatDateTime(readiness.generated_at, language)}</span></div><StatusBadge value={readiness.blocked_documents > 0 ? "critical" : readiness.review_documents > 0 ? "warning" : "valid"} label={`${Math.round(readiness.readiness_score * 100)} %`} /></div>
        <div className="retrieval-quality-lab__corpus-metrics">
          <CorpusMetric label={t.ready} value={readiness.ready_documents} tone="success" />
          <CorpusMetric label={t.review} value={readiness.review_documents} tone="attention" />
          <CorpusMetric label={t.blocked} value={readiness.blocked_documents} tone="danger" />
          <CorpusMetric label={t.corpusScore} value={`${Math.round(readiness.readiness_score * 100)} %`} tone="neutral" />
        </div>
        <div className="retrieval-quality-lab__issues">
          <h3>{t.issues}</h3>
          <StratosDataTable rows={readiness.issues} columns={issueColumns} getRowId={(item) => `${item.document_id}:${item.code}`} emptyLabel={t.noIssues} aria-label={t.issues} />
        </div>
      </section>
    </div>
  );
}

function DatasetMaturity({ dataset, language, labels }: { dataset: EvaluationDatasetSummary; language: "cs" | "en"; labels: Record<string, string> }) {
  return (
    <div className="retrieval-quality-lab__maturity" aria-label={labels.maturity}>
      <span><strong>{dataset.name}</strong><small>{formatNumber(dataset.case_count, language)} {labels.cases} · {dataset.visibility === "private" ? labels.private : labels.shared}</small></span>
      <span className="tag-list"><span className="tag">{labels.draft}: {dataset.draft_cases}</span><span className="tag">{labels.silver}: {dataset.silver_cases}</span><span className="tag">{labels.gold}: {dataset.gold_cases}</span></span>
    </div>
  );
}

function CorpusMetric({ label, value, tone }: { label: string; value: number | string; tone: "success" | "attention" | "danger" | "neutral" }) {
  return <div className={`retrieval-quality-lab__corpus-metric is-${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function qualityStatus(status: "passed" | "failed" | "not_evaluated" | undefined, labels: Record<string, string>) {
  if (status === "passed") return <StatusBadge value="valid" label={labels.passed} />;
  if (status === "failed") return <StatusBadge value="critical" label={labels.failed} />;
  return <StatusBadge value="draft" label={labels.notEvaluated} />;
}

function gateLabel(key: string, language: "cs" | "en"): string {
  const labels: Record<string, [string, string]> = {
    retrieval_recall: ["Recall relevantních zdrojů", "Relevant source recall"],
    retrieval_ndcg: ["Pořadí výsledků nDCG", "Result ranking nDCG"],
    false_zero_result_rate: ["Falešné nulové výsledky", "False zero results"],
    authorization_leak_rate: ["Únik přes oprávnění", "Authorization leakage"],
    citation_traceability: ["Dohledatelnost citací", "Citation traceability"],
    retrieval_latency_p95_ms: ["Retrieval latence p95", "Retrieval latency p95"]
  };
  return labels[key]?.[language === "cs" ? 0 : 1] ?? key.replaceAll("_", " ");
}

function gateValue(key: string, value: number): string {
  return key.endsWith("_ms") ? `${Math.round(value)} ms` : formatPercent(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10} %`;
}
