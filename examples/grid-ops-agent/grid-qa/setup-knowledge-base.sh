#!/usr/bin/env bash
# grid-qa 知识库初始化：在 RAGFlow 中按名称约定建两个数据集并入库演示语料。
#   电网运维-规程库      出处层①：预置规程条文类参考（corpus/regulations/）
#   电网运维-用户投喂库  出处层②：用户投喂文档（corpus/user-fed/，文件名自带投喂人/日期）
# 幂等：数据集已存在则复用；文档按同名跳过（全量重灌需先在 RAGFlow 删库）。
# 依赖：python3、ragflow-dataset-ingest 技能脚本、RAGFLOW_API_URL / RAGFLOW_API_KEY。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SKILL="$REPO_ROOT/.agents/skills/ragflow-dataset-ingest/scripts"
CORPUS="$REPO_ROOT/examples/grid-ops-agent/grid-qa/corpus"
REG_NAME="电网运维-规程库"
FED_NAME="电网运维-用户投喂库"
: "${RAGFLOW_API_URL:?需要 RAGFLOW_API_URL}"
: "${RAGFLOW_API_KEY:?需要 RAGFLOW_API_KEY}"
export RAGFLOW_API_URL RAGFLOW_API_KEY

# 数据集按名称解析；两层出处的判定依据就是数据集/文档命名，不引入额外元数据。
# 本函数在命令替换中调用，信息输出一律走 stderr，stdout 只留数据集 ID。
ensure_dataset() {
  local id
  id="$(python3 "$SKILL/datasets.py" list --json \
    | python3 -c "import json,sys; print(next((d['id'] for d in json.load(sys.stdin)['datasets'] if d['name']=='$1'), ''))")"
  if [ -z "$id" ]; then
    id="$(python3 "$SKILL/datasets.py" create "$1" --description "$2" --json \
      | python3 -c "import json,sys; print(json.load(sys.stdin)['dataset']['id'])")"
    echo "新建数据集 $1 -> $id" >&2
  else
    echo "复用数据集 $1 -> $id" >&2
  fi
  echo "$id"
}

upload_all() {
  local dataset_id="$1" dir="$2" new_docs=0
  while IFS= read -r -d '' file; do
    local name existing
    name="$(basename "$file")"
    existing="$(python3 "$SKILL/upload.py" list "$dataset_id" --json \
      | python3 -c "import json,sys; target=sys.argv[1]; print(sum(1 for d in json.load(sys.stdin)['documents'] if d['name']==target))" "$name")"
    if [ "$existing" != "0" ]; then
      echo "  跳过（已存在）：$name"
      continue
    fi
    python3 "$SKILL/upload.py" "$dataset_id" "$file" --json > /dev/null
    echo "  已上传：$name"
    new_docs=$((new_docs + 1))
  done < <(find "$dir" -maxdepth 1 -name '*.md' -print0 | sort -z)
  if [ "$new_docs" -gt 0 ]; then
    # upload 只传不解析；对库内全部文档触发解析（重复触发幂等）。
    python3 "$SKILL/parse.py" "$dataset_id" $(python3 "$SKILL/upload.py" list "$dataset_id" --json \
      | python3 -c "import json,sys; print(' '.join(d['id'] for d in json.load(sys.stdin)['documents']))") --json > /dev/null
    echo "  已触发解析（新增 $new_docs 个文档）"
  fi
}

wait_parsed() {
  local dataset_id="$1" round=0
  while [ "$round" -lt 60 ]; do
    round=$((round + 1))
    if python3 "$SKILL/parse_status.py" "$dataset_id" --json \
      | python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if d['all_terminal'] and d['summary'].get('DONE',0)==len(d['documents']) else 1)"; then
      echo "  解析完成（$(python3 "$SKILL/parse_status.py" "$dataset_id" --json | python3 -c "import json,sys; print(len(json.load(sys.stdin)['documents']))") 个文档）"
      return 0
    fi
    echo "  解析中（第 $round 次轮询）：$(python3 "$SKILL/parse_status.py" "$dataset_id" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['summary'])")"
    sleep 10
  done
  echo "  解析超时，请用 parse_status.py 复查" >&2
  return 1
}

REG_ID="$(ensure_dataset "$REG_NAME" "预置规程条文类参考；出处层①（正式规程）")"
FED_ID="$(ensure_dataset "$FED_NAME" "用户投喂文档；出处层②（标文档名+投喂人/日期，非规程）")"

echo "规程库入库："
upload_all "$REG_ID" "$CORPUS/regulations"
wait_parsed "$REG_ID"

echo "投喂库入库："
upload_all "$FED_ID" "$CORPUS/user-fed"
wait_parsed "$FED_ID"

echo "检索自检（应为规程库命中）："
python3 "$SKILL/search.py" "树竹速长区 巡视周期" --dataset-ids "$REG_ID,$FED_ID" --top-k 3 --json \
  | python3 -c "import json,sys; [print(f\"  {c['document_name']} | {c['content'][:60]}\") for c in json.load(sys.stdin)['chunks'][:3]]"
echo "完成：规程库=$REG_ID 投喂库=$FED_ID"
