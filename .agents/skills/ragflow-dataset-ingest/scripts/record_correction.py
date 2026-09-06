#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Record a human correction into the RAGFlow correction-experience dataset."""

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from common import (
    ApiError,
    ConfigError,
    DataError,
    ScriptError,
    add_runtime_config_arguments,
    configure_stdio_utf8,
    current_timestamp,
    decode_json_response,
    ensure_success,
    extract_error_message,
    format_json,
    request_json,
    resolve_runtime_config,
)

LEDGER_DOCUMENT_NAME = "纠错台账.md"
LEDGER_PLACEHOLDER_CONTENT = (
    "# 纠错台账\n\n"
    "本文件是纠错经验库的虚拟台账，所有人工纠正记录以 chunk 形式追加在本文档下。\n"
)
CORRECTION_DATASET_ID_FILE = "/home/admin/DSH/ragflow/logs/.corrid"
CORRECTION_DATASET_ID_ENV = "RAGFLOW_CORRECTION_DATASET_ID"
CHUNK_MARKER = "【人工纠正】"
MAX_KEYWORDS = 12
MAX_ALNUM_KEYWORDS = 4
KEYWORD_CJK_NGRAM_SIZE = 3


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Append a human correction to the correction ledger document of a RAGFlow dataset."
    )
    parser.add_argument("--question", required=True, help="The user's original question")
    parser.add_argument("--wrong", required=True, help="Key points of the wrong answer the model gave")
    parser.add_argument("--correct", required=True, help="The corrected answer confirmed by the user")
    parser.add_argument("--source", required=True, help="Where the correct answer comes from, e.g. a document name")
    parser.add_argument(
        "--variant",
        action="append",
        default=[],
        dest="variants",
        help="Alternative phrasing of the question; repeatable, each becomes its own chunk",
    )
    parser.add_argument(
        "--dataset-id",
        dest="dataset_id",
        help="Correction dataset ID; defaults to $%s, then the first line of %s"
        % (CORRECTION_DATASET_ID_ENV, CORRECTION_DATASET_ID_FILE),
    )
    parser.add_argument("--json", action="store_true", dest="json_output", help="Print JSON output")
    add_runtime_config_arguments(parser)
    return parser.parse_args(argv)


def _resolve_dataset_id(args: argparse.Namespace) -> str:
    dataset_id = (args.dataset_id or "").strip()
    if dataset_id:
        return dataset_id

    dataset_id = os.environ.get(CORRECTION_DATASET_ID_ENV, "").strip()
    if dataset_id:
        return dataset_id

    id_file = Path(CORRECTION_DATASET_ID_FILE)
    if id_file.is_file():
        first_line = id_file.read_text(encoding="utf-8").strip().splitlines()
        if first_line:
            dataset_id = first_line[0].strip()
            if dataset_id:
                return dataset_id

    raise ConfigError(
        "Correction dataset ID is required: pass --dataset-id, set %s, or create %s first."
        % (CORRECTION_DATASET_ID_ENV, CORRECTION_DATASET_ID_FILE)
    )


def _find_ledger_document(dataset_id: str, *, base_url: str, api_key: str) -> str | None:
    payload = ensure_success(
        request_json(f"{base_url}/api/v1/datasets/{dataset_id}/documents?page=1&page_size=100", api_key)
    )
    data = payload.get("data")
    if not isinstance(data, dict):
        raise DataError("Document list response missing data object.")
    docs = data.get("docs")
    if not isinstance(docs, list):
        raise DataError("Document list response missing data.docs.")
    for doc in docs:
        if isinstance(doc, dict) and doc.get("name") == LEDGER_DOCUMENT_NAME:
            doc_id = doc.get("id")
            if isinstance(doc_id, str) and doc_id:
                return doc_id
    return None


def _create_ledger_document(dataset_id: str, *, base_url: str, api_key: str) -> str:
    """Upload a placeholder file whose basename is the display name (v0.27.0 ignores display_name)."""
    temp_dir = tempfile.mkdtemp(prefix="ragflow-correction-")
    try:
        file_path = Path(temp_dir) / LEDGER_DOCUMENT_NAME
        file_path.write_text(LEDGER_PLACEHOLDER_CONTENT, encoding="utf-8")

        boundary = "----OpenClawBoundary" + uuid.uuid4().hex
        body = bytearray()
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(
            f'Content-Disposition: form-data; name="file"; filename="{LEDGER_DOCUMENT_NAME}"\r\n'.encode()
        )
        body.extend(b"Content-Type: text/markdown\r\n\r\n")
        body.extend(LEDGER_PLACEHOLDER_CONTENT.encode("utf-8"))
        body.extend(b"\r\n")
        body.extend(f"--{boundary}--\r\n".encode())

        url = f"{base_url}/api/v1/datasets/{dataset_id}/documents"
        request_obj = urllib.request.Request(url, data=bytes(body), method="POST")
        request_obj.add_header("Authorization", f"Bearer {api_key}")
        request_obj.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

        try:
            with urllib.request.urlopen(request_obj, timeout=60) as response:
                payload = decode_json_response(response.read())
        except urllib.error.HTTPError as exc:
            message = extract_error_message(exc.read())
            if message:
                raise ApiError(message) from None
            raise ApiError(f"HTTP request failed with status {exc.code}.") from None
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            raise ApiError(f"Upload failed: {reason}") from None

        ensure_success(payload)
        docs = payload.get("data")
        if not isinstance(docs, list) or not docs or not isinstance(docs[0], dict):
            raise DataError("Ledger upload response missing data list.")
        doc_id = docs[0].get("id")
        if not isinstance(doc_id, str) or not doc_id:
            raise DataError("Ledger upload response missing document id.")
        return doc_id
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _ensure_ledger_document(dataset_id: str, *, base_url: str, api_key: str) -> tuple[str, bool]:
    doc_id = _find_ledger_document(dataset_id, base_url=base_url, api_key=api_key)
    if doc_id:
        return doc_id, False
    return _create_ledger_document(dataset_id, base_url=base_url, api_key=api_key), True


def _extract_keywords(*texts: str) -> list[str]:
    """Cheap keyword extraction: whole latin/digit tokens first, then CJK 3-grams, capped."""
    combined = " ".join(texts)
    keywords: list[str] = []
    seen: set[str] = set()

    alnum_tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9./%_-]+", combined)
    for token in alnum_tokens:
        if len(keywords) >= MAX_ALNUM_KEYWORDS:
            break
        if token not in seen:
            seen.add(token)
            keywords.append(token)

    for run in re.findall(r"[一-鿿]+", combined):
        for start in range(0, max(len(run) - KEYWORD_CJK_NGRAM_SIZE + 1, 0)):
            gram = run[start : start + KEYWORD_CJK_NGRAM_SIZE]
            if len(keywords) >= MAX_KEYWORDS:
                break
            if gram not in seen:
                seen.add(gram)
                keywords.append(gram)
        if len(keywords) >= MAX_KEYWORDS:
            break

    return keywords


def _build_chunk_content(question_label: str, question_text: str, args: argparse.Namespace, recorded_at: str) -> str:
    return (
        f"{CHUNK_MARKER}{question_label}：{question_text}\n"
        f"错误答案：{args.wrong}\n"
        f"正确答案：{args.correct}\n"
        f"出处：{args.source}\n"
        f"纠正时间：{recorded_at}"
    )


def _add_chunk(
    dataset_id: str,
    document_id: str,
    content: str,
    keywords: list[str],
    *,
    base_url: str,
    api_key: str,
) -> dict[str, Any]:
    body = {"content": content, "important_keywords": keywords}
    payload = ensure_success(
        request_json(
            f"{base_url}/api/v1/datasets/{dataset_id}/documents/{document_id}/chunks",
            api_key,
            method="POST",
            body=json.dumps(body).encode("utf-8"),
            content_type="application/json",
        )
    )
    chunk = payload.get("data")
    if not isinstance(chunk, dict):
        raise DataError("Add chunk response missing data object.")
    inner = chunk.get("chunk")
    if isinstance(inner, dict):
        chunk = inner
    return {
        "chunk_id": chunk.get("id"),
        "kind": "main" if content.startswith(f"{CHUNK_MARKER}问题：") else "variant",
        "content": content,
        "important_keywords": keywords,
    }


def record_correction(args: argparse.Namespace, *, base_url: str, api_key: str) -> dict[str, Any]:
    question = args.question.strip()
    wrong = args.wrong.strip()
    correct = args.correct.strip()
    source = args.source.strip()
    if not question or not wrong or not correct or not source:
        raise ConfigError("--question, --wrong, --correct and --source must all be non-empty.")

    variants = [variant.strip() for variant in args.variants if variant.strip()]

    dataset_id = _resolve_dataset_id(args)
    document_id, ledger_created = _ensure_ledger_document(dataset_id, base_url=base_url, api_key=api_key)

    recorded_at = current_timestamp()
    entries: list[tuple[str, str]] = [("问题", question)]
    entries.extend(("问题（变体）", variant) for variant in variants)

    chunks: list[dict[str, Any]] = []
    for label, text in entries:
        content = _build_chunk_content(label, text, args, recorded_at)
        keywords = _extract_keywords(text, correct)
        chunks.append(_add_chunk(dataset_id, document_id, content, keywords, base_url=base_url, api_key=api_key))

    return {
        "recorded_at": recorded_at,
        "dataset_id": dataset_id,
        "document_id": document_id,
        "ledger_document": LEDGER_DOCUMENT_NAME,
        "ledger_created": ledger_created,
        "question": question,
        "wrong": wrong,
        "correct": correct,
        "source": source,
        "variants": variants,
        "chunk_count": len(chunks),
        "chunks": chunks,
    }


def _format_text(payload: dict[str, Any]) -> str:
    lines = [
        f"Correction recorded at: {payload['recorded_at']}",
        f"Dataset: {payload['dataset_id']}",
        f"Ledger document: {payload['ledger_document']} ({payload['document_id']})"
        + (" [created]" if payload["ledger_created"] else " [reused]"),
        f"Chunks added: {payload['chunk_count']}",
        "",
        f"question: {payload['question']}",
        f"wrong: {payload['wrong']}",
        f"correct: {payload['correct']}",
        f"source: {payload['source']}",
    ]
    for variant in payload["variants"]:
        lines.append(f"variant: {variant}")
    for index, chunk in enumerate(payload["chunks"], start=1):
        lines.extend(
            [
                "",
                f"[{index}] {chunk['kind']} chunk_id: {chunk.get('chunk_id') or 'unknown'}",
                f"  keywords: {', '.join(chunk['important_keywords'])}",
            ]
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    configure_stdio_utf8()
    args = _parse_args(argv)

    try:
        base_url, api_key = resolve_runtime_config(args)
        payload = record_correction(args, base_url=base_url, api_key=api_key)
        print(format_json(payload) if args.json_output else _format_text(payload))
        return 0
    except ScriptError as exc:
        if args.json_output:
            print(format_json({"recorded_at": current_timestamp(), "error": str(exc)}))
        else:
            print(f"Error: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
