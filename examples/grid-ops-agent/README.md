# grid-ops-agent — power-grid equipment O&M agent demo

English | [中文](README.zh.md)

Demo leaf for the power-grid equipment O&M agent line (from ticket 07 on). The first agent is **knowledge QA grid-qa**; the later defect inspection, disposal advisory, report writing, and knowledge update agents follow the same shape (see [decoupling-convention.md](decoupling-convention.md)).

Single home of the business definition: `apps/cli/config/agent-presets/grid-qa/` (persona.md role/policy/citation rules + the skills/grid-qa-retrieval retrieval workflow). This directory holds only demo assembly (headless overlay, SDK compositions) and corpus files; it never copies business text.

## Prerequisites

- Run every command from the repository root (relative `process.cwd()` paths in the overlay depend on this convention; `pnpm` needs `CI=true` to skip the interactive dependency check).
- `DEEPSEEK_API_KEY` present in `$DSH_HOME/.credentials.yaml` (or the environment).
- The RAGFlow stack runs in local Docker (`127.0.0.1:9380`). No exported credentials needed: the grid-qa-retrieval skill injects `RAGFLOW_API_KEY` per command from the server token file `/home/admin/DSH/ragflow/logs/.apitok` (DSH strips variables whose names contain KEY/TOKEN/SECRET/PASSWORD from the model shell environment, so only explicit per-command injection reaches the script).

## 1. Knowledge-base initialization (first run)

```sh
bash examples/grid-ops-agent/grid-qa/setup-knowledge-base.sh
```

Creates two datasets by name convention and ingests `grid-qa/corpus/`: `电网运维-规程库` (provenance tier ①, regulation-clause references) and `电网运维-用户投喂库` (provenance tier ②, file names carry the feeder and date). Idempotent; safe to re-run.

## 2. Preset mount check (no session started)

```sh
node examples/grid-ops-agent/grid-qa/check-preset-mount.mjs
```

Printing `grid-qa: listed healthy and standing mount ensured` means the preset (apps/cli/config/agent-presets/grid-qa/) is discoverable by the roster and mounts completely.

## 3. End-to-end demos

### Scenario 1: retrieval hits a regulation (one-shot headless)

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/grid-qa/grid-qa.headless.patch.yml \
  "35kV架空线路穿越树竹速长区，巡视周期怎么安排？"
```

Expected: conclusion first → cites a clause of the regulation (provenance tier ①) → executable steps.

### Scenario 2: retrieval miss → general knowledge + warning banner (one-shot headless)

Ask about something neither dataset holds (for example the management origin of the two-ticket three-system regime, 两票三制); the answer is expected to open with a standalone line 「以下内容来自模型通用知识，非规程依据」 (the following comes from general model knowledge, not a regulation basis).

### Scenario 3: multi-turn follow-up + dual mode (official Python SDK, JSON-RPC stdio)

```sh
python3 examples/grid-ops-agent/grid-qa/demo_multiturn.py
```

Three turns in one session: regulation hit → a follow-up that carries context (a straw-burning hazard added on the same line section: regulation-tier basis + general-knowledge segments flagged with the warning banner) → 「讲解一下」 ("explain it") switches to a teaching mode (the principle exposition still carries citations). The driver injects the persona and skill directories, from the same source as the preset.

### Scenario 4 (supplementary): user-fed document hit → provenance tier ②

Ask about something only the user-fed library holds (case details); the answer is expected to carry the tag 「用户投喂文档：〈文档名〉（投喂人、日期）」 (user-fed document: 〈name〉 (feeder, date)) and state explicitly that it is not a formal regulation; regulations quoted inside a fed document never masquerade as tier ①.

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/grid-qa/grid-qa.headless.patch.yml \
  "110kV电缆终端发热缺陷那个案例里，缺陷是怎么发现、怎么定性的？"
```

## 4. Model endpoint switching

Development placeholders use the DeepSeek API; switch to a local vLLM endpoint by following [model-endpoint-switch.md](model-endpoint-switch.md).

## Directory

- `grid-qa/grid-qa.headless.patch.yml` — headless demo overlay (persona reads persona.md; web search off)
- `grid-qa/sdk-grid-qa.cordis.yml` — SDK multi-turn demo composition (JSON-RPC stdio)
- `grid-qa/demo_multiturn.py` — multi-turn demo driver
- `grid-qa/check-preset-mount.mjs` — preset mount check
- `grid-qa/setup-knowledge-base.sh` — knowledge-base initialization
- `grid-qa/corpus/{regulations,user-fed}/` — demo corpus (sources and licensing in corpus/SOURCES.md)

## 5. Defect inspection agent defect-inspector (ticket 08)

Single home of the business definition: `apps/cli/config/agent-presets/defect-inspector/` (persona.md: the identify-and-grade-only boundary, three-tier grading semantics, and the clarifying-interaction contract; skills/defect-inspection retrieval workflow). Visual input is not wired up during development, so demo input is always a textual defect description (the visual input path is documented in that persona's 「输入与视觉输入路径」 (input and visual input path) section).

### Preset mount check (no session started)

```sh
node examples/grid-ops-agent/defect-inspector/check-preset-mount.mjs
```

Printing `defect-inspector: listed healthy and standing mount ensured` means the mount is complete (the script derives the preset id from its own directory name).

### Scenario 5: successful identification — type + location + grade (one-shot headless)

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/defect-inspector/defect-inspector.headless.patch.yml \
  "110kV电缆户外终端C相尾管发热，红外测温相间最大温差17.3℃，C相较另外两相明显发红，环境温度正常，请判定缺陷。"
```

Expected: output organized as 「缺陷类型 / 部位 / 定级 / 定级依据」 (defect type / location / severity grade / grading basis), with the basis labeled by layer (regulation clause / user-fed document / general grading semantics); no disposal plan and no numeric confidence.

### Scenario 6: uncertain → clarifying interaction → manual review (official Python SDK, JSON-RPC stdio)

```sh
python3 examples/grid-ops-agent/defect-inspector/demo_multiturn.py
```

Three representative requests in one session: R1 repeats the scenario 5 input (successful identification); R2 says only 「绝缘子好像有点问题」 ("the insulator seems to have a problem") (explains why it cannot judge + asks back for shape/location/background across multiple turns); R3 exhausts what the user can supply (no binoculars/drone/records, cannot approach) → partial judgment + manual-review recommendation + an account of the missing evidence.

### Files

- `defect-inspector/defect-inspector.headless.patch.yml` — headless demo overlay (persona reads persona.md; web search off)
- `defect-inspector/sdk-defect-inspector.cordis.yml` — SDK multi-turn demo composition (JSON-RPC stdio)
- `defect-inspector/demo_multiturn.py` — clarifying-interaction multi-turn demo driver
- `defect-inspector/check-preset-mount.mjs` — preset mount check

## 6. Disposal advisory agent fault-advisor (ticket 08)

Single home of the business definition: `apps/cli/config/agent-presets/fault-advisor/` (persona.md: layered advisory structure, no-fabrication rules, fixed positioning statement; skills/fault-advising retrieval workflow). Input is a defect description in text (downstream output of the inspection agent or a direct verbal account).

### Preset mount check (no session started)

```sh
node examples/grid-ops-agent/fault-advisor/check-preset-mount.mjs
```

### Scenario 7: successful advisory — layered structure + positioning statement (one-shot headless)

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/fault-advisor/fault-advisor.headless.patch.yml \
  "1号主变110kV侧套管渗油，油位计比上月下降明显，套管根部法兰附近有油迹并沿本体下流，请给处置建议。"
```

Expected: severity skeleton → stepwise core disposal actions (with regulation basis; steps not hit by retrieval are explicitly flagged with the 「模型通用知识」 (general model knowledge) warning) → severe grades automatically append a correlated-equipment sweep → work-ticket/operation-ticket safety notes; no fabricated spare parts, shifts, or durations; a fixed closing line 「辅助决策参考，严格执行以规程和工作票流程为准」 (advisory reference only; strict execution follows the regulations and the work-ticket process).

### Scenario 8: severe grade triggers correlated sweep + no fabrication (official Python SDK, JSON-RPC stdio)

```sh
python3 examples/grid-ops-agent/fault-advisor/demo_multiturn.py
```

Three representative requests in one session: R1 cable-termination overheating (downstream inspection input; the severity skeleton is adopted without re-grading, layered advice + positioning statement); R2 GIS SF6 connection-valve leak (severe grade → automatically appends the same-model familial-defect correlated sweep); R3 asks 「还能撑几天 / 明天班组有没有人」 ("how many more days can it hold / is the crew available tomorrow") (customer-side data is unknown; no fabricated numbers, an on-site confirmation path is given instead).

### Files

- `fault-advisor/fault-advisor.headless.patch.yml` — headless demo overlay (persona reads persona.md; web search off)
- `fault-advisor/sdk-fault-advisor.cordis.yml` — SDK multi-turn demo composition (JSON-RPC stdio)
- `fault-advisor/demo_multiturn.py` — layered-advisory multi-turn demo driver
- `fault-advisor/check-preset-mount.mjs` — preset mount check

## 7. Report writing agent report-writer (ticket 14)

Single home of the business definition: `apps/cli/config/agent-presets/report-writer/` (persona.md: dual input modes / report-structure placeholder / PDF delivery contract + skills/report-writer-toolbox history-query and offline PDF scripts). **Historical results land in a store** at `report-writer/data/` (defects/disposals JSONL, all `source: demo` demo data; in production the inspection and advisory agents write via `history.py append-*`, contract in data/README.md).

### Preset mount check (no session started)

```sh
node examples/grid-ops-agent/report-writer/check-preset-mount.mjs
```

### Scenario 9: expand bullet points into a report (one-shot headless, with statistics section and PDF output)

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/report-writer/report-writer.headless.patch.yml \
  "把下面要点扩写成《110kV城东变2026年8月设备运维周报（第4周）》：①本周完成1次全站红外测温特巡；②发现35kV城南线电缆终端接线端子过热（严重缺陷）已转处置流程；③1号主变套管法兰渗漏油消缺完成复验；④下周计划GIS室SF6漏检专项排查启动。"
```

Expected: writes the report in a generic O&M report structure (customer reference samples not yet available, so the missing sample slot is noted at the end); statistics-section numbers come from the history-store script output; produces a downloadable `/tmp/rw-*.pdf`.

### Scenario 10: statistical report + PDF + per-equipment/time ad-hoc statistics (official Python SDK, 3 representative requests)

```sh
python3 examples/grid-ops-agent/report-writer/demo_report.py
```

R1 expands bullet points into a monthly report → R2 adds a statistics section from the history store (identification counts / type distribution / grade distribution / month-over-month) and exports a PDF → R3 compares two substations by equipment for June–August. The PDF is generated offline locally (system python3 reportlab + a local CJK font, `report-writer-toolbox/scripts/md2pdf.py`, with `REPORT_PDF_FONT` selecting the font file), usable on an isolated intranet.

### Files

- `report-writer/report-writer.headless.patch.yml` — headless demo overlay
- `report-writer/sdk-report-writer.cordis.yml` — SDK demo composition (JSON-RPC stdio)
- `report-writer/demo_report.py` — 3-request demo driver (expansion / statistics + PDF / ad-hoc statistics)
- `report-writer/check-preset-mount.mjs` — preset mount check
- `report-writer/data/{defects,disposals}.jsonl` — history-store demo data (demo-tagged)

## 8. Knowledge update agent kb-updater (ticket 14)

Single home of the business definition: `apps/cli/config/agent-presets/kb-updater/` (persona.md: mandatory attribution / QA rejection / partial-success feedback / no-review-no-takedown contract + skills/kb-updater-feed feeding workflow and graph snapshot scripts). Feeding target = the RAGFlow dataset 「电网运维-用户投喂库」 (created in ticket 07, provenance tier ②); ingested document names carry 「（投喂人：姓名·日期）」 (feeder: name·date) so knowledge QA can tag them as tier ②.

### Preset mount check (no session started)

```sh
node examples/grid-ops-agent/kb-updater/check-preset-mount.mjs
```

### Scenario 11: feed without a name → asks back (one-shot headless)

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/kb-updater/kb-updater.headless.patch.yml \
  "把 examples/grid-ops-agent/kb-updater/feed-docs/配电网架空线路防雷要点（投喂演示-半成功场景）.md 投喂进知识库"
```

Expected: asks back for name/employee id and performs no feeding action (the system has no login; self-reported attribution is mandatory).

### Scenario 12: full feeding behavior (official Python SDK, 4 representative requests)

```sh
python3 examples/grid-ops-agent/kb-updater/demo_feed.py
```

Session A (normal configuration), three requests: no name → asks back → Engineer Wang feeds a switchgear partial-discharge PDF (QA → attribution rename → graph increment → retrieval self-check) → a blank corrupt PDF is rejected by QA (reason fed back, un-ingested document deleted); session B (graph target deliberately misconfigured via `KB_UPDATER_GRAPH_DATASET`), one request: Engineer Li feeds a lightning-protection md → document ingestion succeeds, graph update fails → states explicitly 「文档已入库，图谱更新失败（原因）」 (document ingested; graph update failed (reason)), no rollback.

### Graph increment demo (metric ② A2-3 script material)

```sh
bash examples/grid-ops-agent/kb-updater/setup-graph-demo.sh       # 建「电网运维-图谱演示库」+ 基线图谱（收敛校验）
bash examples/grid-ops-agent/kb-updater/graph-increment-demo.sh   # 入库前快照 → 投喂 → 图谱增量 → 入库后快照 → 对比
```

Produces `/tmp/ku-graph-{before,after}.json` and `/tmp/ku-graph-diff.{json,md}` (measured 137→166 entities / 158→211 relations; all new entities come from the fed document). **Snapshots must use the `--server` channel** (built into the script): after a v0.27.0 incremental build the `knowledge_graph` API returns the old graph row; the real graph is read via server-side `get_graph`.

### Files

- `kb-updater/kb-updater.headless.patch.yml` — headless demo overlay
- `kb-updater/sdk-kb-updater.cordis.yml` — SDK demo composition (bash timeout 10 minutes to accommodate graph building)
- `kb-updater/demo_feed.py` — 4-request full-feeding-behavior demo driver (two sessions)
- `kb-updater/check-preset-mount.mjs` — preset mount check
- `kb-updater/setup-graph-demo.sh` / `graph-increment-demo.sh` — graph demo library setup and increment snapshot comparison
- `kb-updater/graph-corpus/` — graph demo corpus (self-authored, see its SOURCES.md)
- `kb-updater/feed-docs/` — feeding demo documents (switchgear partial-discharge PDF / blank rejection PDF / lightning-protection md)

## 9. Unified entry (O&M assistant) grid-assistant (ticket 15)

The entry **is not an agent** (not counted in the 5-agent roster, see [metric5-demo-record.md](metric5-demo-record.md)): the user does not pick an agent and just speaks; the entry recognizes the task type and routes — simple tasks (ask knowledge / request a report) are delegated to the matching capability face to answer, and the photo full chain (identify → grade → advise) is chained through native DSH subagent delegation. Single home of the business definition: `apps/cli/config/agent-presets/grid-assistant/` (persona.md = routing table / image disambiguation / routing fallback / full-chain uncertain abort; contains no capability-face business text — capability-face personas are referenced through the delegation entries). Mechanism: five `dsh-tool-subagent` entries in the preset (spawn provider); each entry's `persona` config overrides the child agent's persona with the corresponding capability face's persona.md, and `toolFilter` pins the child agent's tool surface to that face's entry set — the delegated child agent is that capability face; simple tasks go through delegation too (one uniform mechanism).

### Preset mount check (no session started)

```sh
node examples/grid-ops-agent/grid-assistant/check-preset-mount.mjs
```

### Scenario 13: simple-task routing (one-shot headless, ① ask knowledge / ② request a report)

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/grid-assistant/grid-assistant.headless.patch.yml \
  "35kV架空线路穿越树竹速长区，巡视周期怎么安排？"
```

Expected: first line 〔已转知识问答〕 (routed to knowledge QA) + knowledge-QA behavior (cites a DL/T 741-2010 clause). Requesting a report works the same way (〔已转报表生成〕 (routed to report writing): written report + historical statistics + PDF path).

### Scenarios 14-16: image disambiguation and fallback (one-shot headless)

③ An image/description with no ingestion intent defaults to defect inspection (when identification is uncertain, 〔需澄清〕 (needs clarification) relays the inspection face's follow-up question); ④ a spoken ingestion intent (「存进知识库」 "save this into the knowledge base") goes to feeding (relays the attribution name question); ⑤ ambiguous input gets a 〔需澄清〕 (needs clarification) question 「识别还是入库」 (identify or ingest); ⑥ a routing miss (miscellaneous question) is answered as knowledge QA by default, never refused. Same command as scenario 13 with a different user message (representative messages are in the entry table of [metric5-demo-record.md](metric5-demo-record.md)).

### Scenario 17: photo full chain in one pass (one-shot headless)

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/grid-assistant/grid-assistant.headless.patch.yml \
  "现场发现缺陷：110kV电缆户外终端C相尾管发热，红外测温相间最大温差17.3℃，C相较另外两相明显发红，环境温度正常。请走识别定级，然后接着给处置建议。"
```

Expected: 〔已转缺陷识别 → 处置建议〕 (routed to defect inspection → disposal advisory) — identification (type/location/grade/three-tier basis) chains automatically into the disposal advisory (adopts the grade without re-grading, layered advice, fixed positioning statement), fully relayed in one answer.

### Scenario 18: full-chain uncertain abort + image disambiguation loop (official Python SDK, JSON-RPC stdio)

```sh
python3 examples/grid-ops-agent/grid-assistant/demo_entry_multiturn.py
```

Session A, two turns: a vague defect description → the inspection's uncertain-clarification relay (the chain stops at the inspection layer, no advisory) → the user cannot supply more → delegate again → partial judgment + manual-review close (still no advisory). Session B, two turns: the ambiguous-input question → 「存进知识库」 (save into the knowledge base) → routed to feeding (the name question is relayed; the feeding internals are ticket-14 evidence and are not re-executed).

### Metric ⑤ demo record

Presentable demo record for the five agents + the entry (A5-1 list and definitions / A5-2 three representative requests per agent): [metric5-demo-record.md](metric5-demo-record.md).

### Files

- `grid-assistant/grid-assistant.headless.patch.yml` — entry headless demo overlay (entry persona reads persona.md; five capability-face personas referenced via delegation entries; web search and generic delegation off)
- `grid-assistant/sdk-grid-assistant.cordis.yml` — SDK demo composition (JSON-RPC stdio; subagent service + spawn provider + five delegation entries)
- `grid-assistant/demo_entry_multiturn.py` — multi-turn demo driver (full-chain uncertain abort + image disambiguation loop, two sessions)
- `grid-assistant/check-preset-mount.mjs` — preset mount check
