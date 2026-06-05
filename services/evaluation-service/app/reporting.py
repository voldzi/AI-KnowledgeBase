from __future__ import annotations

import csv
import html
import io
import json

from app.schemas import EvaluationCaseResult, EvaluationRun


def render_json(run: EvaluationRun) -> str:
    return json.dumps(run.model_dump(mode="json"), indent=2, ensure_ascii=False)


def render_csv(run: EvaluationRun) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "run_id",
            "dataset_id",
            "case_id",
            "status",
            "overall_score",
            "retrieval_precision",
            "retrieval_recall",
            "citation_precision",
            "citation_recall",
            "answer_correctness",
            "faithfulness",
            "no_answer_correctness",
            "latency_ms",
            "confidence",
            "warnings",
        ]
    )
    for case in run.cases:
        writer.writerow(
            [
                run.run_id,
                run.dataset_id,
                case.case_id,
                case.status,
                case.overall_score,
                case.retrieval_metrics.precision,
                case.retrieval_metrics.recall,
                case.citation_metrics.precision,
                case.citation_metrics.recall,
                case.answer_metrics.answer_correctness,
                case.answer_metrics.faithfulness,
                case.answer_metrics.no_answer_correctness,
                case.latency_ms,
                case.confidence or "",
                "|".join(case.warnings),
            ]
        )
    return output.getvalue()


def render_html(run: EvaluationRun) -> str:
    rows = "\n".join(_case_row(case) for case in run.cases)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{html.escape(run.dataset_name)} evaluation report</title>
  <style>
    body {{ font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #17202a; }}
    table {{ border-collapse: collapse; width: 100%; margin-top: 16px; }}
    th, td {{ border: 1px solid #d7dde5; padding: 8px; text-align: left; vertical-align: top; }}
    th {{ background: #f3f6fa; }}
    .passed {{ color: #0f766e; font-weight: 700; }}
    .failed, .error {{ color: #b42318; font-weight: 700; }}
    .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 20px 0; }}
    .metric {{ border: 1px solid #d7dde5; padding: 12px; border-radius: 6px; }}
    .label {{ color: #526070; font-size: 12px; text-transform: uppercase; }}
    .value {{ font-size: 24px; font-weight: 700; }}
  </style>
</head>
<body>
  <h1>{html.escape(run.dataset_name)} evaluation report</h1>
  <p>Run {html.escape(run.run_id)} completed with status {html.escape(run.status)}.</p>
  <section class="summary">
    {_metric("Cases", str(run.summary.total_cases))}
    {_metric("Passed", str(run.summary.passed_cases))}
    {_metric("Average score", f"{run.summary.average_score:.3f}")}
    {_metric("Retrieval recall", f"{run.summary.retrieval_recall:.3f}")}
    {_metric("Citation correctness", f"{run.summary.citation_correctness:.3f}")}
    {_metric("Faithfulness", f"{run.summary.faithfulness:.3f}")}
  </section>
  <table>
    <thead>
      <tr>
        <th>Case</th>
        <th>Status</th>
        <th>Score</th>
        <th>Retrieval P/R</th>
        <th>Citation P/R</th>
        <th>Answer</th>
        <th>Warnings</th>
      </tr>
    </thead>
    <tbody>
      {rows}
    </tbody>
  </table>
</body>
</html>
"""


def _metric(label: str, value: str) -> str:
    return (
        f'<div class="metric"><div class="label">{html.escape(label)}</div>'
        f'<div class="value">{html.escape(value)}</div></div>'
    )


def _case_row(case: EvaluationCaseResult) -> str:
    status = html.escape(case.status)
    warnings = ", ".join(case.warnings)
    return f"""<tr>
  <td>{html.escape(case.case_id)}</td>
  <td class="{status}">{status}</td>
  <td>{case.overall_score:.3f}</td>
  <td>{case.retrieval_metrics.precision:.3f} / {case.retrieval_metrics.recall:.3f}</td>
  <td>{case.citation_metrics.precision:.3f} / {case.citation_metrics.recall:.3f}</td>
  <td>{html.escape(case.answer_excerpt)}</td>
  <td>{html.escape(warnings)}</td>
</tr>"""
