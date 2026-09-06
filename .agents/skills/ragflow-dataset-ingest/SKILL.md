---
name: ragflow-dataset-ingest
description: "Use for RAGFlow dataset tasks: create, list, inspect, update, or delete datasets; upload, list, update, or delete documents; start or stop parsing; check parse status; retrieve chunks with `search.py`; and list configured models."
metadata:
  openclaw:
    requires:
      env:
        - RAGFLOW_API_URL
        - RAGFLOW_API_KEY
      bins:
        - python3
    primaryEnv: RAGFLOW_API_KEY
---

# RAGFlow Dataset And Retrieval

Use only the bundled scripts in `scripts/`.
Prefer `--json` so returned fields can be relayed exactly.
Follow `reference.md` for all user-facing output.

## Use This Skill When

- the user wants to create, list, inspect, update, or delete RAGFlow datasets
- the user wants to upload, list, update, or delete documents in a dataset
- the user wants to start parsing, stop parsing, or check parse progress
- the user wants to retrieve chunks from one or more datasets
- the user wants to list configured RAGFlow models

## Core Workflow

1. Resolve the target dataset or document IDs first.
2. Run the matching script from `scripts/`.
3. Use `--json` unless a script only needs a simple text response.
4. Return API fields exactly; do not guess missing details.

Common commands:

```bash
python3 scripts/datasets.py list --json
python3 scripts/datasets.py info DATASET_ID --json
python3 scripts/datasets.py create "Example Dataset" --description "Quarterly reports" --json
python3 scripts/update_dataset.py DATASET_ID --name "Updated Dataset" --json
python3 scripts/upload.py DATASET_ID /path/to/file.pdf --json
python3 scripts/upload.py list DATASET_ID --json
python3 scripts/update_document.py DATASET_ID DOC_ID --name "Updated Document" --json
python3 scripts/parse.py DATASET_ID DOC_ID1 [DOC_ID2 ...] --json
python3 scripts/stop_parse_documents.py DATASET_ID DOC_ID1 [DOC_ID2 ...] --json
python3 scripts/parse_status.py DATASET_ID --json
python3 scripts/search.py "query" --json
python3 scripts/search.py "query" DATASET_ID --json
python3 scripts/search.py --dataset-ids DATASET_ID1,DATASET_ID2 --doc-ids DOC_ID1,DOC_ID2 "query" --json
python3 scripts/search.py --retrieval-test --kb-id DATASET_ID "query" --json
python3 scripts/list_models.py --json
```

## Guardrails

- For any delete action, list the exact items first and require explicit user confirmation before executing.
- Delete only by explicit dataset IDs or document IDs. If the user gives names or fuzzy descriptions, resolve IDs first.
- Upload does not start parsing. Start parsing only when the user asks for it.
- `parse.py` returns immediately after the start request; use `parse_status.py` for progress.
- For progress requests, use `parse_status.py` on the most specific scope available:
  - dataset specified: inspect that dataset
  - document IDs specified: pass `--doc-ids`
  - no dataset specified: list datasets first, then aggregate status across datasets
- If a parse status result includes `progress_msg`, surface it directly. For `FAIL`, treat it as the primary error detail.
- Use `--retrieval-test` only for single-dataset debugging or when the user explicitly asks for that endpoint.

## Output Rules

- Follow `reference.md`.
- Use tables for 3+ items when possible.
- Preserve `api_error`, `error`, `message`, and related fields exactly as returned.
- Never fabricate progress percentages or inferred causes.

## DSH Canvas Integration (added by DSH deployment)

**Preferred (product tool):** the DSH web profile ships the `kg_graph` tool
(`@deepseek-ai/dsh-host-kg`). It pulls every dataset's graph via
`RAGFLOW_API_URL` / `RAGFLOW_API_KEY` credentials and writes one hub artifact
(center hub → library nodes → per-library entity graphs, force-graph rendering,
offline) straight to the canvas. Just call the tool — no script, no file plumbing:

- `kg_graph {}` — every library in one hub view
- `kg_graph {"library": "名称"}` — one library only

Trigger phrases: 「打开/看看知识图谱」「展示图谱关系」「全局知识大图」.

**Fallback (headless server, no web session):** generate the same kind of HTML by
hand and write it to the canvas yourself:

1. `python3 scripts/graph_canvas.py DATASET_ID --title "名称" --out /tmp/graph.html`
   (needs the same `RAGFLOW_API_URL` / `RAGFLOW_API_KEY` env; graph must be built
   first via `ragflow-run-graphrag.sh` on the server)
2. Read the file content, then call the `canvas` tool: `op=write`, `kind=html`,
   `title="名称 · 知识图谱"`, `content=<file content>`. The canvas panel renders
   it in a sandboxed iframe with scripts enabled (drag / zoom / hover).


## Correction Loop (added by DSH deployment)

纠错共享学习闭环，涉及纠错经验库（dataset id 存于服务器
`/home/admin/DSH/ragflow/logs/.corrid`，脚本自动读取，也可用 `--dataset-id` 或
环境变量 `RAGFLOW_CORRECTION_DATASET_ID` 覆盖）：

- **用户纠正时记录**：用户说「你答错了 / 不对，应该是 X」时，先把要记录的内容
  复述给用户确认（问题、错误答案、正确答案、出处），然后调用：
  ```bash
  python3 scripts/record_correction.py --question "原问题" --wrong "错误答案要点" \
    --correct "正确答案" --source "出处文档" [--variant "问法变体"]... --json
  ```
  记录以 chunk 形式追加在纠错库的「纠错台账」虚拟文档下，立即可检索，无需解析。
- **检索时跨库召回**：回答业务问题时，`search.py` 默认同时传纠错库与业务库：
  ```bash
  python3 scripts/search.py "问题" --dataset-ids $(cat /home/admin/DSH/ragflow/logs/.corrid),$(cat /home/admin/DSH/ragflow/logs/.mbid) --json
  ```
- **命中纠错条目时优先采用**：结果中 content 以【人工纠正】开头的条目是用户亲自
  确认过的答案，优先于普通业务库召回采用，并在回答中告知用户该结论来自人工纠正
  记录（含出处与纠正时间）。


## Multi-Route Retrieval (added by DSH deployment)

For high-stakes questions (operating parameters, safety procedures), prefer
`multi_search.py` over single `search.py`: it fans the question into three
genuinely different retrieval routes (original/vector-heavy, keyword-stripped/
BM25-heavy, wide-recall), then clusters results by evidence fingerprint
(document + content prefix) and votes:

```bash
python3 scripts/multi_search.py "问题" DATASET_ID --use-kg
python3 scripts/multi_search.py "问题" --dataset-ids CORRECTION_KB,BUSINESS_KB
```

- Clusters with `votes>=2` (`verified: true`, shown as ✅) are cross-route
  corroborated — trust these first and cite them.
- Single-route clusters (⚠️) may be noise or rare content; use with caution and
  say so to the user.
- Combine with the correction KB: passing both dataset ids makes corrections
  and source text compete in the same vote.
