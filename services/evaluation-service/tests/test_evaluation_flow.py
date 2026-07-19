from __future__ import annotations

from datetime import timedelta
from pathlib import Path

from app.schemas import EvaluationRun, QualityGateResult
from app.store import RunStore
from tests.conftest import make_client


def test_list_datasets_includes_seed_dataset() -> None:
    with make_client() as client:
        response = client.get("/api/v1/evaluations/datasets")

    assert response.status_code == 200
    assert any(dataset["dataset_id"] == "sample_rag_eval" for dataset in response.json())


def test_run_sample_dataset_and_fetch_reports() -> None:
    with make_client() as client:
        run_response = client.post("/api/v1/evaluations/runs", json={"dataset_id": "sample_rag_eval"})

        assert run_response.status_code == 200
        run = run_response.json()
        assert run["run_id"].startswith("eval_run_")
        assert run["status"] == "completed"
        assert run["summary"]["total_cases"] == 2
        assert run["summary"]["passed_cases"] == 2
        assert run["summary"]["retrieval_recall"] == 1
        assert run["summary"]["citation_correctness"] == 1

        get_response = client.get(f"/api/v1/evaluations/runs/{run['run_id']}")
        assert get_response.status_code == 200
        assert get_response.json()["run_id"] == run["run_id"]

        csv_response = client.get(f"/api/v1/evaluations/runs/{run['run_id']}/report?format=csv")
        assert csv_response.status_code == 200
        assert "text/csv" in csv_response.headers["content-type"]
        assert "case_answer_001" in csv_response.text

        html_response = client.get(f"/api/v1/evaluations/runs/{run['run_id']}/report?format=html")
        assert html_response.status_code == 200
        assert "text/html" in html_response.headers["content-type"]
        assert "Sample RAG Evaluation" in html_response.text


def test_create_dataset_and_run_inline_subset(tmp_path) -> None:  # type: ignore[no-untyped-def]
    env = {
        "AKL_EVAL_DATASETS_DIR": str(tmp_path / "datasets"),
        "AKL_EVAL_REPORTS_DIR": str(tmp_path / "reports"),
    }
    payload = {
        "dataset_id": "custom_eval",
        "name": "Custom Eval",
        "description": "test dataset",
        "tags": ["test"],
        "cases": [
            {
                "case_id": "case_custom_001",
                "subject_id": "user_123",
                "query": "Kdo schvaluje vyjimku ze smernice?",
                "expected_answer_terms": ["gestor dokumentu"],
                "expected_citations": [{"chunk_id": "chunk_789"}],
                "expected_relevant_chunk_ids": ["chunk_789"],
                "expected_no_answer": False,
            }
        ],
    }

    with make_client(env) as client:
        create_response = client.post("/api/v1/evaluations/datasets", json=payload)
        assert create_response.status_code == 201
        assert create_response.json()["dataset_id"] == "custom_eval"

        run_response = client.post(
            "/api/v1/evaluations/runs",
            json={"dataset_id": "custom_eval", "case_ids": ["case_custom_001"]},
        )

    assert run_response.status_code == 200
    assert run_response.json()["summary"]["passed_cases"] == 1


def test_missing_dataset_returns_error_payload() -> None:
    with make_client() as client:
        response = client.post("/api/v1/evaluations/runs", json={"dataset_id": "missing"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DATASET_NOT_FOUND"


def test_missing_case_returns_error_payload() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/evaluations/runs",
            json={"dataset_id": "sample_rag_eval", "case_ids": ["does_not_exist"]},
        )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "CASE_NOT_FOUND"


def test_retrieval_only_dataset_produces_quality_gate_and_history(tmp_path) -> None:  # type: ignore[no-untyped-def]
    env = {
        "AKL_EVAL_DATASETS_DIR": str(tmp_path / "datasets"),
        "AKL_EVAL_SEED_DATASETS_DIR": str(Path(__file__).parents[1] / "datasets"),
        "AKL_EVAL_REPORTS_DIR": str(tmp_path / "reports"),
    }
    dataset_payload = {
        "name": "Corpus title baseline",
        "description": "retrieval-only quality baseline",
        "tags": ["corpus-baseline", "silver"],
        "visibility": "private",
        "cases": [
            {
                "case_id": "title_001",
                "subject_id": "user_123",
                "query": "Kdo schvaluje vyjimku ze smernice?",
                "answer_mode": "retrieve_only",
                "expected_relevant_document_ids": ["doc_123"],
                "role": "analyst",
                "query_category": "exact_title",
                "judgment_status": "silver",
            }
        ],
    }

    with make_client(env) as client:
        dataset_response = client.post("/api/v1/evaluations/datasets", json=dataset_payload)
        assert dataset_response.status_code == 201
        dataset_id = dataset_response.json()["dataset_id"]

        first_run_response = client.post(
            "/api/v1/evaluations/runs",
            json={"dataset_id": dataset_id},
        )
        first_run = EvaluationRun.model_validate(first_run_response.json())
        invalid_summary = first_run.summary.model_copy(update={"error_cases": 1})
        RunStore(env["AKL_EVAL_REPORTS_DIR"]).save_run(
            first_run.model_copy(
                update={
                    "run_id": "eval_run_invalid_baseline",
                    "status": "completed_with_errors",
                    "finished_at": first_run.finished_at + timedelta(microseconds=1),
                    "summary": invalid_summary,
                    "quality_gate": QualityGateResult(
                        status="not_evaluated",
                        checks=[],
                        eligible_cases=0,
                        excluded_draft_cases=0,
                    ),
                }
            )
        )
        second_run_response = client.post(
            "/api/v1/evaluations/runs",
            json={"dataset_id": dataset_id},
        )
        history_response = client.get(
            f"/api/v1/evaluations/runs?dataset_id={dataset_id}&limit=10"
        )
        overview_response = client.get(
            f"/api/v1/evaluations/quality/overview?dataset_id={dataset_id}"
        )

    assert first_run_response.status_code == 200
    first_run_payload = first_run_response.json()
    assert first_run_payload["summary"]["retrieval_only_cases"] == 1
    assert first_run_payload["summary"]["retrieval_recall"] == 1
    assert first_run_payload["summary"]["retrieval_ndcg"] == 1
    assert first_run_payload["summary"]["false_zero_result_rate"] == 0
    assert first_run_payload["quality_gate"]["status"] == "passed"
    assert second_run_response.json()["comparison"]["baseline_run_id"] == first_run_payload["run_id"]
    assert len(history_response.json()) == 3
    assert overview_response.json()["latest_run"]["run_id"] == second_run_response.json()["run_id"]
