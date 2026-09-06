#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Multi-route retrieval with source clustering to reduce hallucination.

Runs three genuinely different retrieval parameter sets against the same
datasets (no extra LLM calls), clusters the returned chunks by source
fingerprint (document_id + content prefix), and votes: a chunk found by two
or more routes is marked verified and ranked first.

Routes:
  1 verbatim  question as-is, vector weight 0.7 (semantic-leaning), top_k 5, threshold 0.2
  2 keywords  stopword-stripped question, vector weight 0.2 (term/BM25-leaning), top_k 5, threshold 0.15
  3 wide      question as-is, top_k 10, threshold 0.1
"""

import argparse
import json
import re
from typing import Any

from common import (
    ConfigError,
    DataError,
    ScriptError,
    add_runtime_config_arguments,
    configure_stdio_utf8,
    current_timestamp,
    ensure_success,
    format_json,
    request_json,
    resolve_runtime_config,
)

FINGERPRINT_LENGTH = 80
PREVIEW_LIMIT = 240
DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 30

# Route definitions: (route id, name, vector weight, top_k, threshold).
# Route 2 additionally swaps the question for its keywordized form.
ROUTE_VERBATIM = 1
ROUTE_KEYWORDS = 2
ROUTE_WIDE = 3

STOPWORDS = ("什么", "怎么", "如何", "哪些", "应该", "需要", "的", "了", "是", "呢", "吗")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run three retrieval routes against RAGFlow datasets and vote on chunks by source."
    )
    parser.add_argument("query", help="Search query text")
    parser.add_argument("dataset_id", nargs="?", help="Dataset ID (first of the targeted datasets)")
    parser.add_argument("--dataset-ids", help="Comma-separated dataset IDs")
    parser.add_argument("--use-kg", action="store_true", help="Enable knowledge graph retrieval on every route")
    parser.add_argument("--json", action="store_true", dest="json_output", help="Print JSON output")
    add_runtime_config_arguments(parser)
    return parser.parse_args(argv)


def _parse_ids(raw_value: str, *, label: str) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for item in raw_value.split(","):
        value = item.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        values.append(value)

    if not values:
        raise ConfigError(f"{label} must include at least one ID.")
    return values


def _resolve_dataset_ids(args: argparse.Namespace) -> list[str]:
    if args.dataset_ids:
        return _parse_ids(args.dataset_ids, label="--dataset-ids")
    if args.dataset_id:
        dataset_id = args.dataset_id.strip()
        if not dataset_id:
            raise ConfigError("dataset_id must not be empty.")
        return [dataset_id]
    raise ConfigError("A dataset ID is required: pass dataset_id or --dataset-ids.")


def keywordize(question: str) -> str:
    """Drop common function words from a Chinese question and join what remains."""
    text = question
    for word in STOPWORDS:
        text = text.replace(word, " ")
    terms = [term for term in re.split(r"\s+", text) if term]
    return " ".join(terms) or question.strip()


def _normalize_content(chunk: dict[str, Any]) -> str:
    for key in ("content_with_weight", "content", "answer", "chunk"):
        value = chunk.get(key)
        if isinstance(value, str):
            return value
        if isinstance(value, list):
            return " ".join(str(item) for item in value)
    return ""


def _normalize_chunk(chunk: dict[str, Any]) -> dict[str, Any]:
    return {
        "document_name": chunk.get("document_keyword") or chunk.get("docnm_kwd") or chunk.get("document_name"),
        "document_id": chunk.get("document_id") or chunk.get("doc_id"),
        "dataset_id": chunk.get("dataset_id") or chunk.get("kb_id"),
        "chunk_id": chunk.get("chunk_id") or chunk.get("id"),
        "similarity": chunk.get("similarity"),
        "content": _normalize_content(chunk),
    }


def _extract_chunks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("data")
    if data is None:
        return []
    if isinstance(data, dict):
        chunks = data.get("chunks")
        if chunks is None:
            return []
        if not isinstance(chunks, list):
            raise DataError("Retrieval response data.chunks must be a list.")
        return [_normalize_chunk(chunk) for chunk in chunks if isinstance(chunk, dict)]
    if isinstance(data, list):
        return [_normalize_chunk(chunk) for chunk in data if isinstance(chunk, dict)]
    raise DataError("Retrieval response data must be an object or array.")


def _fingerprint(chunk: dict[str, Any]) -> str:
    compact = " ".join((chunk.get("content") or "").split())
    document_id = chunk.get("document_id") or ""
    return f"{document_id}|{compact[:FINGERPRINT_LENGTH]}"


def _run_route(
    base_url: str,
    api_key: str,
    *,
    question: str,
    dataset_ids: list[str],
    vector_weight: float | None,
    top_k: int,
    threshold: float,
    use_kg: bool,
) -> list[dict[str, Any]]:
    body: dict[str, Any] = {
        "question": question,
        "dataset_ids": dataset_ids,
        "top_k": top_k,
        "similarity_threshold": threshold,
        "page": DEFAULT_PAGE,
        "size": max(DEFAULT_PAGE_SIZE, top_k),
    }
    if vector_weight is not None:
        body["vector_similarity_weight"] = vector_weight
    if use_kg:
        body["use_kg"] = True

    payload = ensure_success(
        request_json(
            f"{base_url}/api/v1/retrieval",
            api_key,
            method="POST",
            body=json.dumps(body).encode("utf-8"),
            content_type="application/json",
        )
    )
    return _extract_chunks(payload)


def _cluster_chunks(route_chunks: dict[int, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    clusters: dict[str, dict[str, Any]] = {}

    for route_id in sorted(route_chunks):
        for rank, chunk in enumerate(route_chunks[route_id]):
            similarity = chunk.get("similarity")
            similarity_value = similarity if isinstance(similarity, (int, float)) else 0.0

            cluster = clusters.get(_fingerprint(chunk))
            if cluster is None:
                cluster = {
                    "verified": False,
                    "votes": 0,
                    "routes": [],
                    "document_name": chunk.get("document_name"),
                    "document_id": chunk.get("document_id"),
                    "similarity": similarity,
                    "content": chunk.get("content") or "",
                    "_route_ids": set(),
                    "_best_rank": rank,
                }
                clusters[_fingerprint(chunk)] = cluster

            cluster["_route_ids"].add(route_id)
            if isinstance(similarity, (int, float)) and not isinstance(cluster["similarity"], (int, float)):
                cluster["similarity"] = similarity
            elif isinstance(similarity, (int, float)) and similarity > cluster["similarity"]:
                cluster["similarity"] = similarity
            cluster["_best_rank"] = min(cluster["_best_rank"], rank)

    result = []
    for cluster in clusters.values():
        route_ids = sorted(cluster.pop("_route_ids"))
        cluster.pop("_best_rank")
        cluster["routes"] = route_ids
        cluster["votes"] = len(route_ids)
        cluster["verified"] = cluster["votes"] >= 2
        result.append(cluster)

    result.sort(
        key=lambda item: (
            not item["verified"],
            -item["votes"],
            -(item["similarity"] if isinstance(item["similarity"], (int, float)) else 0.0),
        )
    )
    return result


def multi_search(args: argparse.Namespace, *, base_url: str, api_key: str) -> dict[str, Any]:
    dataset_ids = _resolve_dataset_ids(args)
    question = args.query.strip()
    if not question:
        raise ConfigError("query must not be empty.")
    keyword_question = keywordize(question)

    route_specs = [
        (ROUTE_VERBATIM, "verbatim", question, 0.7, 5, 0.2),
        (ROUTE_KEYWORDS, "keywords", keyword_question, 0.2, 5, 0.15),
        (ROUTE_WIDE, "wide", question, None, 10, 0.1),
    ]

    route_chunks: dict[int, list[dict[str, Any]]] = {}
    routes_report: list[dict[str, Any]] = []
    for route_id, name, route_question, vector_weight, top_k, threshold in route_specs:
        chunks = _run_route(
            base_url,
            api_key,
            question=route_question,
            dataset_ids=dataset_ids,
            vector_weight=vector_weight,
            top_k=top_k,
            threshold=threshold,
            use_kg=args.use_kg,
        )
        route_chunks[route_id] = chunks
        routes_report.append(
            {
                "route": route_id,
                "name": name,
                "question": route_question,
                "vector_similarity_weight": vector_weight,
                "top_k": top_k,
                "similarity_threshold": threshold,
                "recall": len(chunks),
            }
        )

    clusters = _cluster_chunks(route_chunks)
    verified_count = sum(1 for cluster in clusters if cluster["verified"])

    return {
        "checked_at": current_timestamp(),
        "query": question,
        "keyword_query": keyword_question,
        "dataset_ids": dataset_ids,
        "use_kg": args.use_kg,
        "routes": routes_report,
        "stats": {
            "route_recall": {str(route["route"]): route["recall"] for route in routes_report},
            "verified_clusters": verified_count,
            "total_clusters": len(clusters),
        },
        "clusters": clusters,
    }


def _format_similarity(value: Any) -> str:
    if isinstance(value, (int, float)):
        return f"{value:.2%}"
    return "unknown"


def _format_preview(content: str) -> str:
    compact = " ".join(content.split())
    if not compact:
        return "unknown"
    if len(compact) <= PREVIEW_LIMIT:
        return compact
    return f"{compact[: PREVIEW_LIMIT - 3]}..."


def _format_text(payload: dict[str, Any]) -> str:
    stats = payload["stats"]
    recall = stats["route_recall"]
    lines = [
        f"Checked at: {payload['checked_at']}",
        f"Query: {payload['query']}",
        f"Keyword query: {payload['keyword_query']}",
        f"Dataset IDs: {', '.join(payload['dataset_ids'])}",
        f"Use KG: {'true' if payload['use_kg'] else 'false'}",
        "",
        "Route recall: "
        + " | ".join(f"route{route['route']}({route['name']})={route['recall']}" for route in payload["routes"]),
        f"Clusters: {stats['total_clusters']} total, {stats['verified_clusters']} verified (votes >= 2)",
    ]

    if not payload["clusters"]:
        lines.append("No clusters found.")
        return "\n".join(lines)

    for index, cluster in enumerate(payload["clusters"], start=1):
        mark = "✅" if cluster["verified"] else "⚠️"
        routes = ",".join(str(route) for route in cluster["routes"])
        lines.extend(
            [
                "",
                f"{mark} [{index}] votes={cluster['votes']} routes=[{routes}] "
                f"similarity={_format_similarity(cluster['similarity'])}",
                f"  source: {cluster.get('document_name') or 'unknown'} "
                f"(document_id: {cluster.get('document_id') or 'unknown'})",
                f"  content: {_format_preview(cluster.get('content') or '')}",
            ]
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    configure_stdio_utf8()
    args = _parse_args(argv)

    try:
        base_url, api_key = resolve_runtime_config(args)
        payload = multi_search(args, base_url=base_url, api_key=api_key)
        print(format_json(payload) if args.json_output else _format_text(payload))
        return 0
    except ScriptError as exc:
        if args.json_output:
            print(format_json({"checked_at": current_timestamp(), "error": str(exc)}))
        else:
            print(f"Error: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
