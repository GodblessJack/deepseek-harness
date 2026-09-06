#!/usr/bin/env bash
# 图谱增量演示（票 05 A2-3 剧本素材，14 票）：入库前快照 → 投喂 → 图谱增量 →
# 入库后快照 → 对比。在自己的演示数据集「电网运维-图谱演示库」上完整跑一遍
# 「现场新文档 API 增量入库 → 图谱前后快照对比」，产出 /tmp/ku-graph-{before,
# after}.json 与 /tmp/ku-graph-diff.{json,md}。
# 依赖：python3、ragflow-dataset-ingest 脚本、服务器端 graphrag 触发脚本。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SKILL="$REPO_ROOT/.agents/skills/ragflow-dataset-ingest/scripts"
FEED_SKILL="$REPO_ROOT/apps/cli/config/agent-presets/kb-updater/skills/kb-updater-feed/scripts"
GRAPH_SCRIPT="${KB_UPDATER_GRAPH_SCRIPT:-/home/admin/DSH/ragflow/ragflow-run-graphrag.sh}"
GRAPH_DATASET_NAME="${GRAPH_DATASET_NAME:-电网运维-图谱演示库}"
DOC="$REPO_ROOT/examples/grid-ops-agent/kb-updater/graph-corpus/increment/隔离开关触头发热带电检测经验（演示语料）.md"
: "${RAGFLOW_API_URL:?需要 RAGFLOW_API_URL}"
: "${RAGFLOW_API_KEY:?需要 RAGFLOW_API_KEY}"
export RAGFLOW_API_URL RAGFLOW_API_KEY

DS="$(python3 "$SKILL/datasets.py" list --json \
  | python3 -c "import json,sys; print(next((d['id'] for d in json.load(sys.stdin)['datasets'] if d['name']=='$GRAPH_DATASET_NAME'), ''))")"
if [ -z "$DS" ]; then echo "找不到数据集 $GRAPH_DATASET_NAME（先跑建库：见 README「图谱演示库初始化」）" >&2; exit 1; fi
echo "数据集 $GRAPH_DATASET_NAME = $DS"

echo "1/6 入库前快照"
python3 "$FEED_SKILL/graph_snapshot.py" "$DS" --server --out /tmp/ku-graph-before.json

echo "2/6 投喂增量文档（API 上传+解析；同名已存在则复用）"
DOC_NAME="$(basename "$DOC")"
DOC_ID="$(python3 "$SKILL/upload.py" list "$DS" --json \
  | python3 -c "import json,sys; print(next((d['id'] for d in json.load(sys.stdin)['documents'] if d['name']==sys.argv[1]), ''))" "$DOC_NAME")"
if [ -n "$DOC_ID" ]; then
  echo "  复用已上传文档 $DOC_NAME -> $DOC_ID"
else
  DOC_ID="$(python3 "$SKILL/upload.py" "$DS" "$DOC" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['document_ids'][0])")"
  echo "  doc_id=$DOC_ID"
fi
python3 "$SKILL/parse.py" "$DS" "$DOC_ID" --json > /dev/null
for i in $(seq 1 30); do
  sleep 5
  if python3 "$SKILL/parse_status.py" "$DS" --doc-ids "$DOC_ID" --json | python3 -c "
import json,sys
d=json.load(sys.stdin)['documents'][0]
ok = d['run'] in ('DONE','FAIL','CANCEL')
print(f\"  解析：{d['run']} chunks={d['chunk_count']}\")
exit(0 if ok else 1)" >/dev/null; then break; fi
done
CHUNKS="$(python3 "$SKILL/parse_status.py" "$DS" --doc-ids "$DOC_ID" --json | python3 -c "import json,sys; d=json.load(sys.stdin)['documents'][0]; print(d['chunk_count'] if d['run']=='DONE' else -1)")"
if [ "$CHUNKS" -le 0 ]; then echo "  投喂文档解析失败/空内容（chunks=$CHUNKS），中止" >&2; exit 1; fi
echo "  解析完成 chunks=$CHUNKS"

echo "3/6 触发图谱增量"
# 注意：v0.27.0 增量构建后 knowledge_graph API 仍返回旧 graph 行（计数不变），
# 真实图谱（含新文档实体）经服务端 get_graph 读取——快照/对比一律加 --server。
# trace_graphrag 返回的是最近一次任务；先记旧任务 id，等「新任务 id 且 progress 1.0」
PREV_TASK="$(curl -s -H "Authorization: Bearer $RAGFLOW_API_KEY" "$RAGFLOW_API_URL/api/v1/datasets/$DS/trace_graphrag" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data'].get('id') or '')")"
bash "$GRAPH_SCRIPT" "$DS"

echo "4/6 等待图谱构建完成"
for i in $(seq 1 120); do
  sleep 10
  READ="$(curl -s -H "Authorization: Bearer $RAGFLOW_API_KEY" "$RAGFLOW_API_URL/api/v1/datasets/$DS/trace_graphrag" \
    | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print(f\"{d.get('id') or ''} {(d.get('progress') or 0)}\")")"
  TASK_ID="${READ%% *}"; PROG="${READ##* }"
  echo "  task=${TASK_ID:0:8} progress=$PROG（第 $i 次轮询）"
  if [ "$TASK_ID" != "$PREV_TASK" ] && [ "$PROG" = "1.0" ]; then break; fi
done
if [ "$TASK_ID" = "$PREV_TASK" ] || [ "$PROG" != "1.0" ]; then echo "  图谱构建超时" >&2; exit 1; fi

echo "5/6 入库后快照"
python3 "$FEED_SKILL/graph_snapshot.py" "$DS" --server --out /tmp/ku-graph-after.json

echo "6/6 前后对比"
python3 "$FEED_SKILL/graph_snapshot.py" --diff /tmp/ku-graph-before.json /tmp/ku-graph-after.json --json --out /tmp/ku-graph-diff.json
python3 "$FEED_SKILL/graph_snapshot.py" --diff /tmp/ku-graph-before.json /tmp/ku-graph-after.json --out /tmp/ku-graph-diff.md
echo "完成：/tmp/ku-graph-{before,after,diff}.{json,md}"
