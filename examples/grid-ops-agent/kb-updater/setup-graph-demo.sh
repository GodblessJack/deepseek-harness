#!/usr/bin/env bash
# 「电网运维-图谱演示库」初始化（14 票）：建库（GraphRAG 配置 + 电网域实体类型）
# → 入 3 篇种子演示语料 → 解析 → 图谱构建 → 校验收敛（graph source_id 含全部文档）。
# graph-increment-demo.sh 的前置。幂等：数据集已存在则复用；重建用 --recreate。
# 依赖：python3、ragflow-dataset-ingest 脚本、服务器端 graphrag 触发脚本。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SKILL="$REPO_ROOT/.agents/skills/ragflow-dataset-ingest/scripts"
GRAPH_SCRIPT="${KB_UPDATER_GRAPH_SCRIPT:-/home/admin/DSH/ragflow/ragflow-run-graphrag.sh}"
CORPUS="$REPO_ROOT/examples/grid-ops-agent/kb-updater/graph-corpus"
NAME="电网运维-图谱演示库"
: "${RAGFLOW_API_URL:?需要 RAGFLOW_API_URL}"
: "${RAGFLOW_API_KEY:?需要 RAGFLOW_API_KEY}"
export RAGFLOW_API_URL RAGFLOW_API_KEY

DS="$(python3 "$SKILL/datasets.py" list --json \
  | python3 -c "import json,sys; print(next((d['id'] for d in json.load(sys.stdin)['datasets'] if d['name']=='$NAME'), ''))")"
if [ "${1:-}" = "--recreate" ] && [ -n "$DS" ]; then
  echo "重建：删除旧库 $DS"
  curl -s -X DELETE -H "Authorization: Bearer $RAGFLOW_API_KEY" -H "Content-Type: application/json" \
    "$RAGFLOW_API_URL/api/v1/datasets" -d "{\"ids\": [\"$DS\"]}" > /dev/null
  DS=""
fi
if [ -z "$DS" ]; then
  DS="$(curl -s -X POST -H "Authorization: Bearer $RAGFLOW_API_KEY" -H "Content-Type: application/json" \
    "$RAGFLOW_API_URL/api/v1/datasets" -d '{
      "name": "电网运维-图谱演示库",
      "description": "14 票图谱增量演示库：入库前快照 → 投喂 → 图谱增量 → 入库后快照（指标② A2-3 剧本素材）。语料为自编演示内容。",
      "chunk_method": "naive",
      "embedding_model": "bge-m3@Ollama",
      "parser_config": {
        "chunk_token_num": 512, "delimiter": "\n",
        "graphrag": {
          "use_graphrag": true, "method": "light",
          "entity_types": ["equipment","material","process_step","role","hazard","department","location","tool","document","concept"],
          "resolution": false, "community": false
        }
      }
    }' | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['code']==0, d.get('message'); print(d['data']['id'])")"
  # 重名时 RAGFlow 会静默加「(1)」后缀并指到新库，后续按名解析就会两库混串——校验失败即停。
  GOT="$(python3 "$SKILL/datasets.py" info "$DS" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['dataset']['name'])")"
  if [ "$GOT" != "$NAME" ]; then
    echo "新建数据集被重命名（$GOT）：已存在同名库，先 --recreate 或改名" >&2
    exit 1
  fi
  echo "新建数据集 $NAME -> $DS"
else
  echo "复用数据集 $NAME -> $DS"
fi

echo "上传种子语料（3 篇，同名跳过）："
for f in "$CORPUS"/seed/*.md; do
  BASE="$(basename "$f")"
  EXISTS="$(python3 "$SKILL/upload.py" list "$DS" --json \
    | python3 -c "import json,sys; print(sum(1 for d in json.load(sys.stdin)['documents'] if d['name']==sys.argv[1]))" "$BASE")"
  if [ "$EXISTS" != "0" ]; then echo "  跳过：$BASE"; continue; fi
  python3 "$SKILL/upload.py" "$DS" "$f" --json > /dev/null
  echo "  已上传：$BASE"
done

DOC_IDS="$(python3 "$SKILL/upload.py" list "$DS" --json \
  | python3 -c "import json,sys; print(' '.join(d['id'] for d in json.load(sys.stdin)['documents']))")"
DOC_N="$(echo $DOC_IDS | wc -w)"
python3 "$SKILL/parse.py" "$DS" $DOC_IDS --json > /dev/null
for i in $(seq 1 60); do
  sleep 5
  if python3 "$SKILL/parse_status.py" "$DS" --json | python3 -c "
import json,sys
d=json.load(sys.stdin)
exit(0 if d['all_terminal'] and d['summary'].get('DONE',0)==len(d['documents']) else 1)" >/dev/null; then
    echo "解析完成（${DOC_N} 篇）"; break
  fi
  [ "$i" = "60" ] && { echo "解析超时" >&2; exit 1; }
done

# 收敛循环：RAGFlow v0.27 的图合并为逐文档读改写，Infinity 写可见性滞后可能漏并
# 个别文档（source_id 缺失）。每次构建后校验 source_id 含全部文档，未收敛则重跑
# （子图有 checkpoint，重跑只补漏，秒级）；最多 5 轮，仍不收敛则报错退出。
graph_source_ids() {
  curl -s -H "Authorization: Bearer $RAGFLOW_API_KEY" \
    "$RAGFLOW_API_URL/api/v1/datasets/$DS/knowledge_graph" \
    | python3 -c "
import json,sys
g=(json.load(sys.stdin)['data'] or {}).get('graph') or {}
print(' '.join(g.get('graph',{}).get('source_id') or []))"
}
for round in 1 2 3 4 5; do
  echo "图谱构建（第 $round 轮）"
  bash "$GRAPH_SCRIPT" "$DS"
  for i in $(seq 1 90); do
    sleep 10
    PROG="$(curl -s -H "Authorization: Bearer $RAGFLOW_API_KEY" "$RAGFLOW_API_URL/api/v1/datasets/$DS/trace_graphrag" \
      | python3 -c "import json,sys; print(json.load(sys.stdin)['data'].get('progress') or 0)")"
    [ "$PROG" = "1.0" ] && break
    [ "$i" = "90" ] && { echo "图谱构建超时" >&2; exit 1; }
  done
  MISSING=0
  for id in $DOC_IDS; do
    case " $(graph_source_ids) " in *" $id "*) ;; *) MISSING=1; echo "  漏并文档：$id";; esac
  done
  if [ "$MISSING" = "0" ]; then
    echo "图谱收敛：source_id 含全部 ${DOC_N} 篇文档"
    python3 "$REPO_ROOT/apps/cli/config/agent-presets/kb-updater/skills/kb-updater-feed/scripts/graph_snapshot.py" "$DS"
    exit 0
  fi
done
echo "图谱 ${round} 轮未收敛，放弃（有文档抽取为空或漏并）" >&2
exit 1
