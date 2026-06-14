#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from html import unescape
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DOMAIN = "public-digitalization-corpus"
DEFAULT_STRATEGICVIEWER_SEED_FILE = Path(
    "/Users/voldzi/Documents/Development/16 2025/StrategicViewer/apps/api/src/seedPublicDigitalizationCorpus.ts"
)
USER_AGENT = "AKB-Public-PDF-Corpus/1.0 (+https://stratos.zeleznalady.cz/akb)"
PDF_MAGIC = b"%PDF"

DEFAULT_SEED_URLS = [
    "https://digitalnicesko.gov.cz/",
    "https://archi.gov.cz/ikcr",
    "https://archi.gov.cz/nap",
    "https://www.dia.gov.cz/cs/legislativa/",
    "https://www.dia.gov.cz/cs/nase-cinnosti/architektura-digitalnich-sluzeb-statu/",
    "https://www.dia.gov.cz/cs/nase-cinnosti/architektura-digitalnich-sluzeb-statu/architektura-egovernmentu",
    "https://www.dia.gov.cz/cs/nase-cinnosti/architektura-digitalnich-sluzeb-statu/schvalovani-ict-projektu-ze-strany-oha",
    "https://www.dia.gov.cz/cs/nase-cinnosti/na-cem-pracujeme/egovernment-cloud",
    "https://www.dia.gov.cz/cs/nase-cinnosti/na-cem-pracujeme/egovernment-cloud/metodiky-navody-formulare/",
    "https://www.dia.gov.cz/cs/nase-cinnosti/na-cem-pracujeme/pristupnost-internetovych-stranek-a-mobilnich-aplikaci/metodicke-dokumenty",
    "https://www.dia.gov.cz/cs/o-nas/zpravy-o-cinnosti-digitalni-a-informacni-agentury",
    "https://nukib.gov.cz/cs/infoservis/dokumenty-a-publikace/",
    "https://nukib.gov.cz/cs/infoservis/dokumenty-a-publikace/strategie-akcni-plan/",
    "https://nukib.gov.cz/cs/infoservis/dokumenty-a-publikace/legislativa-zkb/",
    "https://nukib.gov.cz/cs/infoservis/dokumenty-a-publikace/podpurne-materialy/",
    "https://www.nku.cz/cz/publikace-a-dokumenty/ostatni-publikace/",
    "https://www.nku.cz/cz/publikace-a-dokumenty/ostatni-publikace/ii--souhrnna-zprava-o-digitalizaci-verejne-spravy-cr-id15327/",
    "https://www.mpo.gov.cz/cz/podnikani/digitalni-ekonomika/",
    "https://www.mpo.gov.cz/cz/podnikani/digitalni-ekonomika/umela-inteligence/",
    "https://digital-strategy.ec.europa.eu/en/library",
]

ALLOWED_HOSTS = {
    "dia.gov.cz",
    "www.dia.gov.cz",
    "archi.gov.cz",
    "nukib.gov.cz",
    "www.nku.cz",
    "nku.cz",
    "mpo.gov.cz",
    "www.mpo.gov.cz",
    "digital-strategy.ec.europa.eu",
    "odok.gov.cz",
    "e-sbirka.gov.cz",
    "www.e-sbirka.cz",
    "data.gov.cz",
}

FOLLOW_NEEDLES = {
    "agenda",
    "ai",
    "akcni",
    "architektura",
    "audit",
    "bezpec",
    "cloud",
    "data",
    "digital",
    "dokument",
    "egovernment",
    "formulare",
    "governance",
    "isvs",
    "koncepce",
    "kyber",
    "legislativa",
    "metodik",
    "nap",
    "npo",
    "oha",
    "pristupnost",
    "publikace",
    "rizeni",
    "strategie",
    "vyhlaska",
    "zakon",
    "zprava",
}

RELEVANCE_TERMS = {
    "ai",
    "architektura",
    "audit",
    "bezpecnost",
    "cloud",
    "data",
    "datove",
    "digital",
    "egovernment",
    "eidas",
    "identity",
    "informacni",
    "isvs",
    "kybernetick",
    "metod",
    "nis2",
    "nukib",
    "oha",
    "pristupnost",
    "registr",
    "rizeni",
    "sluzeb",
    "strategie",
    "verejne",
    "vyhlaska",
    "zakon",
}

LOW_VALUE_TERMS = {
    "banner",
    "favicon",
    "letak",
    "logo",
    "pozvanka",
    "tiskova-zprava",
    "wallpaper",
}

EXCLUDED_CANDIDATE_TERMS = {
    "afdrukken als pdf",
    "analyza barier vavai",
    "aktuality",
    "auditni kompendium verejne zdravi",
    "covid 19",
    "crm jednotny registracni formular",
    "dr 700",
    "dr 701",
    "dr 702",
    "dr 703",
    "dr 704",
    "dr 705",
    "dr 706",
    "dr 707",
    "dr 708",
    "dnsh",
    "drukuj pdf",
    "financni urad",
    "imprimați in pdf",
    "imprimer en pdf",
    "imprimir como pdf",
    "izdrukat pdf",
    "navod k vyplneni",
    "novinky",
    "op tak",
    "odpovedny zastupce",
    "oznameni o zmene registracnich udaju",
    "partneru",
    "predmet podnikani",
    "priloha op tak",
    "prirucka irsko",
    "prirucka malta",
    "pravidlum pro prijemce",
    "provozovny",
    "program technologie a aplikace pro konkurenceschopnost",
    "prohlaseni odpovedneho zastupce",
    "ris3",
    "seznam partneru",
    "statutarni organ",
    "struktura udaju o provedene atestaci",
    "tisknout jako pdf",
    "vertical domains of specialization",
    "vyjadreni mzp",
    "zivnostenske podnikani",
    "zmenovy list",
    "zvlastni priloha",
    "zakladni jrf",
}

HOST_CAPS = {
    "nukib.gov.cz": 55,
    "www.dia.gov.cz": 50,
    "dia.gov.cz": 50,
    "archi.gov.cz": 35,
    "www.nku.cz": 25,
    "nku.cz": 25,
    "mpo.gov.cz": 25,
    "www.mpo.gov.cz": 25,
    "digital-strategy.ec.europa.eu": 20,
    "odok.gov.cz": 10,
}


@dataclass(frozen=True)
class SeedRecord:
    title: str
    url: str
    source_section: str
    owner: str = ""
    department: str = ""
    domain: str = ""
    category: str = "OST"
    keywords: tuple[str, ...] = ()


@dataclass
class Candidate:
    pdf_url: str
    source_page_url: str
    label: str
    title: str
    origin_title: str
    source_section: str
    source_kind: str
    depth: int
    score: int
    content_type: str = ""
    final_url: str = ""
    size_bytes: int = 0
    sha256: str = ""
    slug: str = ""
    group: str = "reference"
    error: str = ""
    selected: bool = False


@dataclass(frozen=True)
class Options:
    imports_root: Path
    domain: str
    strategicviewer_seed_file: Path | None
    target_count: int
    max_pages: int
    max_depth: int
    timeout_seconds: int
    workers: int
    max_file_mb: int
    download: bool
    clean: bool
    report_path: Path


def main(argv: list[str] | None = None) -> int:
    options = parse_args(argv)
    started = dt.datetime.now(dt.UTC)

    seeds = load_seed_records(options)
    crawl_result = crawl_for_candidates(seeds, options)
    unique_candidates = dedupe_candidates(crawl_result["candidates"])
    candidate_pool = select_candidates(
        unique_candidates,
        min(len(unique_candidates), max(options.target_count * 4, options.target_count + 100)),
        diversity_target=options.target_count,
    )
    validation = validate_and_optionally_download(candidate_pool, options)
    selected = validation["selected"]

    report = {
        "generated_at": started.isoformat().replace("+00:00", "Z"),
        "finished_at": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
        "mode": "download" if options.download else "dry-run",
        "imports_root": str(options.imports_root),
        "domain": options.domain,
        "target_count": options.target_count,
        "seed_count": len(seeds),
        "pages_crawled": crawl_result["pages_crawled"],
        "page_errors": crawl_result["page_errors"][:200],
        "candidate_count": len(crawl_result["candidates"]),
        "unique_candidate_count": len(unique_candidates),
        "candidate_pool_count": len(candidate_pool),
        "selected_count": len(selected),
        "valid_pdf_count": validation["valid_pdf_count"],
        "downloaded_count": validation["downloaded_count"],
        "errors": validation["errors"],
        "blocking_errors": validation["blocking_errors"],
        "host_distribution": distribution_by_host(selected),
        "group_distribution": distribution_by_group(selected),
        "selected": [candidate_to_report(candidate) for candidate in selected],
        "not_selected_sample": [candidate_to_report(candidate) for candidate in unique_candidates if not candidate.selected][:100],
    }
    write_report(report, options.report_path)
    print_summary(report)
    return 1 if report["blocking_errors"] else 0


def parse_args(argv: list[str] | None) -> Options:
    parser = argparse.ArgumentParser(
        description="Discover official public PDFs and prepare an AKB PDF-first import package."
    )
    parser.add_argument("--imports-root", default="/srv/akl/imports")
    parser.add_argument("--domain", default=DEFAULT_DOMAIN)
    parser.add_argument(
        "--strategicviewer-seed-file",
        default=str(DEFAULT_STRATEGICVIEWER_SEED_FILE) if DEFAULT_STRATEGICVIEWER_SEED_FILE.exists() else "",
        help="Optional StrategicViewer seedPublicDigitalizationCorpus.ts file used as a scope catalog.",
    )
    parser.add_argument("--target-count", type=int, default=150)
    parser.add_argument("--max-pages", type=int, default=900)
    parser.add_argument("--max-depth", type=int, default=2)
    parser.add_argument("--timeout-seconds", type=int, default=18)
    parser.add_argument("--workers", type=int, default=10)
    parser.add_argument("--max-file-mb", type=int, default=80)
    parser.add_argument("--download", action="store_true", help="Write raw PDFs and Markdown metadata.")
    parser.add_argument("--clean", action="store_true", help="Remove the target import domain before writing.")
    parser.add_argument("--report", default="reports/public_pdf_corpus_prepare_report.json")
    args = parser.parse_args(argv)

    report_path = Path(args.report)
    if not report_path.is_absolute():
        report_path = ROOT / report_path
    seed_file = Path(args.strategicviewer_seed_file) if args.strategicviewer_seed_file else None

    return Options(
        imports_root=Path(args.imports_root),
        domain=args.domain,
        strategicviewer_seed_file=seed_file,
        target_count=args.target_count,
        max_pages=args.max_pages,
        max_depth=args.max_depth,
        timeout_seconds=args.timeout_seconds,
        workers=max(1, args.workers),
        max_file_mb=args.max_file_mb,
        download=bool(args.download),
        clean=bool(args.clean),
        report_path=report_path,
    )


def load_seed_records(options: Options) -> list[SeedRecord]:
    records: list[SeedRecord] = []
    if options.strategicviewer_seed_file and options.strategicviewer_seed_file.exists():
        records.extend(load_strategicviewer_records(options.strategicviewer_seed_file))

    for url in DEFAULT_SEED_URLS:
        if not any(record.url == url for record in records):
            records.append(
                SeedRecord(
                    title=title_from_url(url),
                    url=url,
                    source_section="curated",
                    owner="AKB public corpus curation",
                    domain="Digitalizace veřejné správy",
                    keywords=("digitalizace", "egovernment", "veřejná správa"),
                )
            )
    return records


def load_strategicviewer_records(seed_file: Path) -> list[SeedRecord]:
    text = seed_file.read_text(encoding="utf-8")
    marker = "const sections: CorpusSection[] = ["
    if marker not in text:
        return []
    start = text.index(marker)
    end_marker = "\n];\n\nfunction buildCorpusDocuments"
    end = text.index(end_marker, start) + 3
    snippet = text[start:end].replace("const sections: CorpusSection[] =", "const sections =")
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as handle:
        handle.write(snippet)
        handle.write("\nprocess.stdout.write(JSON.stringify(sections));\n")
        temp_path = handle.name
    try:
        output = subprocess.check_output(["node", temp_path], text=True)
    finally:
        Path(temp_path).unlink(missing_ok=True)
    sections = json.loads(output)
    records: list[SeedRecord] = []
    for section in sections:
        section_keywords = tuple(section.get("keywords") or ())
        records.append(
            SeedRecord(
                title=section["domain"],
                url=section["url"],
                source_section=section["idPrefix"],
                owner=section.get("owner", ""),
                department=section.get("department", ""),
                domain=section.get("domain", ""),
                category=section.get("category", "OST"),
                keywords=section_keywords,
            )
        )
        for topic in section.get("topics") or []:
            records.append(
                SeedRecord(
                    title=topic["name"],
                    url=topic.get("url") or section["url"],
                    source_section=section["idPrefix"],
                    owner=topic.get("owner") or section.get("owner", ""),
                    department=topic.get("department") or section.get("department", ""),
                    domain=topic.get("domain") or section.get("domain", ""),
                    category=topic.get("category") or section.get("category", "OST"),
                    keywords=tuple((section.get("keywords") or []) + (topic.get("keywords") or [])),
                )
            )
    return dedupe_seed_records(records)


def dedupe_seed_records(records: list[SeedRecord]) -> list[SeedRecord]:
    seen: set[tuple[str, str]] = set()
    result: list[SeedRecord] = []
    for record in records:
        key = (record.url.rstrip("/"), normalize_key(record.title))
        if key in seen:
            continue
        seen.add(key)
        result.append(record)
    return result


def crawl_for_candidates(seeds: list[SeedRecord], options: Options) -> dict[str, Any]:
    queue: list[tuple[str, int, SeedRecord]] = [(record.url, 0, record) for record in seeds if is_allowed_url(record.url)]
    seen_pages: set[str] = set()
    candidates: list[Candidate] = []
    page_errors: list[dict[str, str]] = []
    pages_crawled = 0

    while queue and pages_crawled < options.max_pages:
        batch = []
        next_queue: list[tuple[str, int, SeedRecord]] = []
        while queue and len(batch) < options.workers and pages_crawled + len(batch) < options.max_pages:
            url, depth, seed = queue.pop(0)
            key = canonical_url_key(url)
            if key in seen_pages or not is_allowed_url(url):
                continue
            seen_pages.add(key)
            batch.append((url, depth, seed))
        if not batch:
            queue = next_queue + queue
            continue

        with concurrent.futures.ThreadPoolExecutor(max_workers=len(batch)) as executor:
            futures = [executor.submit(extract_page_candidates, url, depth, seed, options) for url, depth, seed in batch]
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                pages_crawled += 1
                candidates.extend(result["candidates"])
                page_errors.extend(result["errors"])
                for item in result["follow_pages"]:
                    if item[1] <= options.max_depth and canonical_url_key(item[0]) not in seen_pages:
                        next_queue.append(item)
        queue.extend(next_queue)

    return {"candidates": candidates, "pages_crawled": pages_crawled, "page_errors": page_errors}


def extract_page_candidates(url: str, depth: int, seed: SeedRecord, options: Options) -> dict[str, Any]:
    result: dict[str, Any] = {"candidates": [], "follow_pages": [], "errors": []}
    response = fetch(url, options.timeout_seconds, max_bytes=1_500_000)
    if response["error"]:
        result["errors"].append({"url": url, "error": response["error"]})
        return result

    final_url = response["final_url"]
    content_type = response["content_type"].lower()
    data = response["data"]
    if is_pdf_response(final_url, content_type, data):
        result["candidates"].append(candidate_from_link(final_url, url, seed.title, seed, "direct", depth))
        return result

    if "html" not in content_type and b"<html" not in data[:1000].lower():
        return result

    html = data.decode("utf-8", errors="replace")
    page_title = extract_page_title(html) or seed.title
    if is_archi_page(final_url):
        result["candidates"].append(candidate_from_link(add_query(final_url, {"do": "export_pdf"}), final_url, page_title, seed, "archi-export", depth))

    for href, label in extract_links(html):
        absolute_url = urllib.parse.urljoin(final_url, href)
        absolute_url = urllib.parse.urldefrag(absolute_url)[0]
        if not is_allowed_url(absolute_url):
            continue
        if looks_like_pdf_link(absolute_url, label):
            link_label = page_title if is_generic_pdf_label(label) else label
            result["candidates"].append(candidate_from_link(absolute_url, final_url, link_label, seed, "link", depth))
        elif depth < options.max_depth and looks_like_follow_link(absolute_url, label):
            result["follow_pages"].append((absolute_url, depth + 1, seed))
    return result


def fetch(url: str, timeout_seconds: int, max_bytes: int | None = None) -> dict[str, Any]:
    try:
        request = urllib.request.Request(
            safe_url(url),
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/pdf,*/*",
            },
        )
        context = ssl.create_default_context()
        with urllib.request.urlopen(request, timeout=timeout_seconds, context=context) as response:
            data = response.read(max_bytes) if max_bytes else response.read()
            return {
                "status": response.status,
                "content_type": response.headers.get("content-type", ""),
                "content_length": response.headers.get("content-length", ""),
                "final_url": response.geturl(),
                "data": data,
                "error": "",
            }
    except Exception as exc:  # noqa: BLE001 - report network variability, do not fail crawl.
        return {"status": 0, "content_type": "", "content_length": "", "final_url": url, "data": b"", "error": str(exc)}


def safe_url(url: str) -> str:
    parts = urllib.parse.urlsplit(url.strip())
    path = urllib.parse.quote(urllib.parse.unquote(parts.path), safe="/:@")
    query = urllib.parse.quote(urllib.parse.unquote(parts.query), safe="=&?:/@,+%")
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))


def extract_links(html: str) -> list[tuple[str, str]]:
    links: list[tuple[str, str]] = []
    pattern = re.compile(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.IGNORECASE | re.DOTALL)
    for match in pattern.finditer(html):
        href = unescape(match.group(1)).strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        label = re.sub(r"<[^>]+>", " ", match.group(2))
        label = " ".join(unescape(label).split())
        links.append((href, label))
    return links


def extract_page_title(html: str) -> str:
    for pattern in (
        r"<h1\b[^>]*>(.*?)</h1>",
        r"<meta\b[^>]*property=[\"']og:title[\"'][^>]*content=[\"']([^\"']+)[\"']",
        r"<title\b[^>]*>(.*?)</title>",
    ):
        match = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        if match:
            value = re.sub(r"<[^>]+>", " ", match.group(1))
            return clean_title(unescape(value))
    return ""


def is_generic_pdf_label(label: str) -> bool:
    return normalize_key(label) in {"stahnout pdf", "ulozit do pdf", "pdf", "download pdf", "print as pdf"}


def candidate_from_link(pdf_url: str, source_page_url: str, label: str, seed: SeedRecord, source_kind: str, depth: int) -> Candidate:
    title = title_from_candidate(label=label, pdf_url=pdf_url, origin_title=seed.title)
    group = group_for(seed=seed, title=title, url=pdf_url)
    candidate = Candidate(
        pdf_url=safe_url(pdf_url),
        source_page_url=source_page_url,
        label=label,
        title=title,
        origin_title=seed.title,
        source_section=seed.source_section,
        source_kind=source_kind,
        depth=depth,
        score=0,
        group=group,
    )
    candidate.score = score_candidate(candidate)
    return candidate


def dedupe_candidates(candidates: list[Candidate]) -> list[Candidate]:
    best: dict[str, Candidate] = {}
    for candidate in candidates:
        if should_exclude_candidate(candidate):
            continue
        key = semantic_candidate_key(candidate.pdf_url)
        current = best.get(key)
        if current is None or candidate.score > current.score:
            best[key] = candidate
    return sorted(best.values(), key=lambda item: (-item.score, item.group, item.title, item.pdf_url))


def select_candidates(candidates: list[Candidate], target_count: int, *, diversity_target: int | None = None) -> list[Candidate]:
    selected: list[Candidate] = []
    selected_keys: set[str] = set()
    host_counts: dict[str, int] = {}
    group_counts: dict[str, int] = {}
    cap_target = diversity_target or target_count
    for candidate in candidates:
        key = canonical_url_key(candidate.pdf_url)
        host = urllib.parse.urlparse(candidate.pdf_url).netloc.lower()
        group = candidate.group
        host_cap = max(HOST_CAPS.get(host, 25), cap_target // 4)
        group_cap = max(18, cap_target // 3)
        if host_counts.get(host, 0) >= host_cap:
            continue
        if group_counts.get(group, 0) >= group_cap:
            continue
        selected.append(candidate)
        selected_keys.add(key)
        host_counts[host] = host_counts.get(host, 0) + 1
        group_counts[group] = group_counts.get(group, 0) + 1
        if len(selected) >= target_count:
            return selected

    for candidate in candidates:
        key = canonical_url_key(candidate.pdf_url)
        if key in selected_keys:
            continue
        selected.append(candidate)
        selected_keys.add(key)
        if len(selected) >= target_count:
            break
    return selected


def validate_and_optionally_download(candidates: list[Candidate], options: Options) -> dict[str, Any]:
    errors: list[dict[str, str]] = []
    blocking_errors: list[dict[str, str]] = []
    selected: list[Candidate] = []
    valid_pdf_count = 0
    downloaded_count = 0

    if options.download:
        prepare_output_dirs(options)

    batch_size = max(options.workers * 2, 4)
    for start in range(0, len(candidates), batch_size):
        if len(selected) >= options.target_count:
            break
        batch = candidates[start : start + batch_size]
        with concurrent.futures.ThreadPoolExecutor(max_workers=options.workers) as executor:
            futures = [executor.submit(fetch_candidate_pdf, candidate, options) for candidate in batch]
            batch_results = [future.result() for future in futures]
        for candidate, data, ok, error in batch_results:
            if len(selected) >= options.target_count:
                break
            if ok:
                valid_pdf_count += 1
                candidate.selected = True
                selected.append(candidate)
                if options.download:
                    write_candidate(candidate, data or b"", options)
                    downloaded_count += 1
            else:
                candidate.error = error
                errors.append({"url": candidate.pdf_url, "title": candidate.title, "error": error})
    if len(selected) < options.target_count:
        blocking_errors.append(
            {
                "code": "INSUFFICIENT_VALID_PDFS",
                "message": f"Only {len(selected)} valid PDFs found for target {options.target_count}.",
            }
        )
    return {
        "selected": selected,
        "valid_pdf_count": valid_pdf_count,
        "downloaded_count": downloaded_count,
        "errors": errors,
        "blocking_errors": blocking_errors,
    }


def prepare_output_dirs(options: Options) -> None:
    domain_root = options.imports_root / options.domain
    if options.clean and domain_root.exists():
        shutil.rmtree(domain_root)
    (domain_root / "raw").mkdir(parents=True, exist_ok=True)
    (domain_root / "source").mkdir(parents=True, exist_ok=True)


def fetch_candidate_pdf(candidate: Candidate, options: Options) -> tuple[Candidate, bytes | None, bool, str]:
    response = fetch(candidate.pdf_url, options.timeout_seconds, max_bytes=None)
    if response["error"]:
        return candidate, None, False, response["error"]
    data = response["data"]
    content_type = response["content_type"]
    final_url = response["final_url"]
    if len(data) > options.max_file_mb * 1024 * 1024:
        return candidate, None, False, f"File exceeds --max-file-mb ({len(data)} bytes)."
    if not is_pdf_response(final_url, content_type.lower(), data):
        return candidate, None, False, f"Response is not a PDF: content_type={content_type!r}, final_url={final_url!r}."

    candidate.final_url = final_url
    candidate.content_type = content_type
    candidate.size_bytes = len(data)
    candidate.sha256 = hashlib.sha256(data).hexdigest()
    candidate.slug = unique_slug(candidate, data[:2048])
    return candidate, data, True, ""


def write_candidate(candidate: Candidate, data: bytes, options: Options) -> None:
    raw_path = options.imports_root / options.domain / "raw" / f"{candidate.slug}.pdf"
    source_dir = options.imports_root / options.domain / "source" / candidate.group
    source_dir.mkdir(parents=True, exist_ok=True)
    source_path = source_dir / f"{candidate.slug}.md"
    raw_path.write_bytes(data)
    source_path.write_text(markdown_for(candidate), encoding="utf-8")


def markdown_for(candidate: Candidate) -> str:
    source_type = source_type_for(candidate)
    summary = summary_for(candidate)
    return "\n".join(
        [
            f"# {candidate.title}",
            "",
            f"- Typ zdroje: {source_type}",
            "- Klasifikace: public",
            "- Jazyk: cs",
            f"- Kanonická URL: {candidate.source_page_url}",
            f"- Zdroj PDF: {candidate.final_url or candidate.pdf_url}",
            f"- SHA-256 PDF: {candidate.sha256}",
            f"- Shrnutí pro AKB: {summary}",
            "",
            "## Importní metadata",
            "",
            f"- Původní katalogová položka: {candidate.origin_title}",
            f"- Sekce katalogu: {candidate.source_section}",
            f"- Skupina: {candidate.group}",
            f"- Způsob nalezení: {candidate.source_kind}",
            f"- Velikost PDF: {candidate.size_bytes} B",
            f"- Staženo: {dt.datetime.now(dt.UTC).isoformat().replace('+00:00', 'Z')}",
            "",
            "## Poznámka",
            "",
            "Tento Markdown soubor slouží pouze jako metadata a provenance pro PDF-first import do AKB. "
            "Primárním uživatelským zdrojem dokumentu je uvedené PDF.",
            "",
        ]
    )


def write_report(report: dict[str, Any], report_path: Path) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    markdown_path = report_path.with_suffix(".md")
    lines = [
        "# Public PDF Corpus Prepare Report",
        "",
        f"- Generated: {report['generated_at']}",
        f"- Mode: {report['mode']}",
        f"- Domain: {report['domain']}",
        f"- Target count: {report['target_count']}",
        f"- Seeds: {report['seed_count']}",
        f"- Pages crawled: {report['pages_crawled']}",
        f"- Unique candidates: {report['unique_candidate_count']}",
        f"- Selected: {report['selected_count']}",
        f"- Valid PDFs: {report['valid_pdf_count']}",
        f"- Downloaded: {report['downloaded_count']}",
        f"- Errors: {len(report['errors'])}",
        "",
        "## Host Distribution",
        "",
    ]
    for host, count in sorted(report["host_distribution"].items()):
        lines.append(f"- {host}: {count}")
    lines.extend(["", "## Group Distribution", ""])
    for group, count in sorted(report["group_distribution"].items()):
        lines.append(f"- {group}: {count}")
    lines.extend(["", "## Selected PDFs", ""])
    for item in report["selected"]:
        status = "ERROR" if item.get("error") else "OK"
        lines.append(f"- [{status}] {item['title']} ({item['group']})")
        lines.append(f"  - PDF: {item['pdf_url']}")
        lines.append(f"  - Source: {item['source_page_url']}")
    if report["errors"]:
        lines.extend(["", "## Errors", ""])
        for error in report["errors"][:100]:
            lines.append(f"- {error['title']}: {error['error']} ({error['url']})")
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def print_summary(report: dict[str, Any]) -> None:
    print(
        json.dumps(
            {
                "mode": report["mode"],
                "domain": report["domain"],
                "seeds": report["seed_count"],
                "pages_crawled": report["pages_crawled"],
                "unique_candidates": report["unique_candidate_count"],
                "selected": report["selected_count"],
                "valid_pdfs": report["valid_pdf_count"],
                "downloaded": report["downloaded_count"],
                "errors": len(report["errors"]),
                "report": str(Path(report["imports_root"]).parent / "repo" / "reports" / Path("public_pdf_corpus_prepare_report.json").name)
                if str(report["imports_root"]).startswith("/srv/")
                else "",
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def candidate_to_report(candidate: Candidate) -> dict[str, Any]:
    return {
        "title": candidate.title,
        "pdf_url": candidate.final_url or candidate.pdf_url,
        "source_page_url": candidate.source_page_url,
        "label": candidate.label,
        "origin_title": candidate.origin_title,
        "source_section": candidate.source_section,
        "source_kind": candidate.source_kind,
        "depth": candidate.depth,
        "score": candidate.score,
        "group": candidate.group,
        "content_type": candidate.content_type,
        "size_bytes": candidate.size_bytes,
        "sha256": f"sha256:{candidate.sha256}" if candidate.sha256 else "",
        "slug": candidate.slug,
        "error": candidate.error,
    }


def distribution_by_host(candidates: list[Candidate]) -> dict[str, int]:
    result: dict[str, int] = {}
    for candidate in candidates:
        host = urllib.parse.urlparse(candidate.pdf_url).netloc.lower()
        result[host] = result.get(host, 0) + 1
    return result


def distribution_by_group(candidates: list[Candidate]) -> dict[str, int]:
    result: dict[str, int] = {}
    for candidate in candidates:
        result[candidate.group] = result.get(candidate.group, 0) + 1
    return result


def is_pdf_response(final_url: str, content_type: str, data: bytes) -> bool:
    return data.startswith(PDF_MAGIC) or "application/pdf" in content_type or final_url.lower().split("?", 1)[0].endswith(".pdf")


def looks_like_pdf_link(url: str, label: str) -> bool:
    lowered_url = url.lower()
    lowered_label = normalize_key(label)
    return (
        ".pdf" in lowered_url
        or "export_pdf" in lowered_url
        or "/pdf/" in lowered_url
        or "download/attachment" in lowered_url
        or "stahnout pdf" in lowered_label
        or "ulozit do pdf" in lowered_label
        or lowered_label.endswith("pdf")
    )


def looks_like_follow_link(url: str, label: str) -> bool:
    if not is_allowed_url(url):
        return False
    parsed = urllib.parse.urlparse(url)
    searchable = normalize_key(f"{parsed.path} {parsed.query} {label}")
    if any(term in searchable for term in LOW_VALUE_TERMS):
        return False
    return any(term in searchable for term in FOLLOW_NEEDLES)


def is_allowed_url(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False
    host = parsed.netloc.lower()
    return host in ALLOWED_HOSTS or any(host.endswith(f".{allowed}") for allowed in ALLOWED_HOSTS)


def is_archi_page(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    return parsed.netloc.lower() == "archi.gov.cz" and "do=export_pdf" not in parsed.query and parsed.path not in {"", "/"}


def add_query(url: str, query_items: dict[str, str]) -> str:
    parts = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parts.query, keep_blank_values=True))
    query.update(query_items)
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(query), parts.fragment))


def canonical_url_key(url: str) -> str:
    parsed = urllib.parse.urlsplit(safe_url(url))
    path = parsed.path.rstrip("/") or "/"
    query = parsed.query
    return urllib.parse.urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, query, ""))


def semantic_candidate_key(url: str) -> str:
    parsed = urllib.parse.urlsplit(safe_url(url))
    host = parsed.netloc.lower()
    if host == "digital-strategy.ec.europa.eu":
        match = re.search(r"/[a-z]{2}/node/(\d+)/printable/pdf", parsed.path)
        if match:
            return f"{host}:node:{match.group(1)}"
    return canonical_url_key(url)


def should_exclude_candidate(candidate: Candidate) -> bool:
    parsed = urllib.parse.urlparse(candidate.pdf_url)
    searchable = normalize_key(f"{candidate.title} {candidate.label} {candidate.pdf_url}")
    searchable_slug = slugify(f"{candidate.title} {candidate.label} {candidate.pdf_url}").replace("-", " ")
    combined = f"{searchable} {searchable_slug}"
    if any(term in combined for term in EXCLUDED_CANDIDATE_TERMS):
        return True
    if "/download/publikace/formulare/" in parsed.path:
        return True
    if "/download/publikace/vyzkum/" in parsed.path:
        return True
    if "/assets/dokumenty/28675/62240/" in parsed.path:
        return True
    if parsed.netloc.lower() == "digital-strategy.ec.europa.eu" and "/en/" not in parsed.path:
        return True
    return False


def score_candidate(candidate: Candidate) -> int:
    parsed = urllib.parse.urlparse(candidate.pdf_url)
    host = parsed.netloc.lower()
    searchable = normalize_key(f"{candidate.title} {candidate.label} {candidate.origin_title} {candidate.pdf_url}")
    score = 30
    if candidate.source_kind == "direct":
        score += 25
    elif candidate.source_kind == "archi-export":
        score += 20
    elif candidate.depth == 0:
        score += 18
    elif candidate.depth == 1:
        score += 12
    else:
        score += 5
    score += {
        "www.dia.gov.cz": 18,
        "dia.gov.cz": 18,
        "archi.gov.cz": 18,
        "nukib.gov.cz": 18,
        "www.nku.cz": 16,
        "nku.cz": 16,
        "mpo.gov.cz": 14,
        "www.mpo.gov.cz": 14,
        "digital-strategy.ec.europa.eu": 12,
        "odok.gov.cz": 10,
    }.get(host, 4)
    score += sum(4 for term in RELEVANCE_TERMS if term in searchable)
    if candidate.source_section in {"law", "arch", "cyber", "dc", "audit"}:
        score += 8
    if any(term in searchable for term in LOW_VALUE_TERMS):
        score -= 40
    if "stahnout pdf" == normalize_key(candidate.label) or "ulozit do pdf" == normalize_key(candidate.label):
        score -= 2
    return score


def group_for(*, seed: SeedRecord, title: str, url: str) -> str:
    searchable = normalize_key(f"{seed.source_section} {seed.domain} {seed.category} {title} {url}")
    if "kyber" in searchable or "nukib" in searchable or "nis2" in searchable:
        return "security"
    if "zakon" in searchable or "vyhlaska" in searchable or "legislativa" in searchable:
        return "legislation"
    if "architektur" in searchable or "oha" in searchable or "isvs" in searchable or "cloud" in searchable:
        return "architecture"
    if "audit" in searchable or "nku" in searchable or "benchmark" in searchable or "desi" in searchable:
        return "audit"
    if "ai" in searchable or "data" in searchable:
        return "data-ai"
    if "digital" in searchable or "egovernment" in searchable:
        return "digital-government"
    return "reference"


def source_type_for(candidate: Candidate) -> str:
    searchable = normalize_key(f"{candidate.group} {candidate.title}")
    if "legislation" in searchable or "zakon" in searchable or "vyhlaska" in searchable:
        return "právní předpis"
    if "strategie" in searchable or "koncepce" in searchable or "politika" in searchable:
        return "strategie"
    if "metod" in searchable or "navod" in searchable or "prirucka" in searchable:
        return "metodika"
    if "audit" in searchable or "zprava" in searchable or "benchmark" in searchable:
        return "zpráva"
    return "veřejný PDF dokument"


def summary_for(candidate: Candidate) -> str:
    return (
        f"Veřejný PDF zdroj pro AKB v oblasti {candidate.group}; "
        f"položka byla dohledána z katalogového kontextu {candidate.origin_title}."
    )


def title_from_candidate(*, label: str, pdf_url: str, origin_title: str) -> str:
    if label and not is_generic_pdf_label(label):
        return clean_title(label)
    filename = Path(urllib.parse.unquote(urllib.parse.urlparse(pdf_url).path)).name
    filename_title = clean_title(re.sub(r"\.pdf$", "", filename, flags=re.IGNORECASE).replace("_", " ").replace("-", " "))
    if filename_title and len(filename_title) > 5:
        return filename_title
    return clean_title(origin_title)


def title_from_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    name = urllib.parse.unquote(Path(parsed.path.rstrip("/") or parsed.netloc).name)
    return clean_title(name.replace("-", " ").replace("_", " ")) or parsed.netloc


def clean_title(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip(" -–—:\t\r\n")
    return cleaned[:260] or "Veřejný PDF dokument"


def unique_slug(candidate: Candidate, prefix_bytes: bytes) -> str:
    digest = hashlib.sha256((candidate.pdf_url + candidate.sha256).encode("utf-8") + prefix_bytes).hexdigest()[:10]
    base = slugify(candidate.title)[:90]
    return f"{base}-{digest}"


def slugify(value: str) -> str:
    normalized = normalize_key(value)
    result = []
    previous_dash = False
    for char in normalized:
        if char.isalnum():
            result.append(char)
            previous_dash = False
        elif not previous_dash:
            result.append("-")
            previous_dash = True
    return "".join(result).strip("-") or "document"


def normalize_key(value: str) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
        .strip()
    )
    return " ".join(ascii_value.split())


if __name__ == "__main__":
    raise SystemExit(main())
