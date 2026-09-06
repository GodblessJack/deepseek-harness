# grid-ops-agent — 电网设备运维智能体演示

[English](README.md) | 中文

电网设备运维智能体线的演示叶（ticket 07 起）。第一个智能体是**知识问答 grid-qa**；后续缺陷识别、处置建议、报表生成、知识更新智能体沿用同一形态（见 [decoupling-convention.md](decoupling-convention.md)）。

业务定义唯一位置：`apps/cli/config/agent-presets/grid-qa/`（persona.md 角色/策略/出处规则 + skills/grid-qa-retrieval 检索流程）。本目录只放演示装配（headless overlay、SDK 组合）与语料，不复制业务文本。

## 前置条件

- 仓库根目录执行所有命令（overlay 中的 `process.cwd()` 相对路径依赖此约定；`pnpm` 需 `CI=true` 以跳过交互式依赖检查）。
- `DEEPSEEK_API_KEY` 已在 `$DSH_HOME/.credentials.yaml`（或环境）。
- RAGFlow 栈在本机 Docker（`127.0.0.1:9380`）。凭据不用导出：grid-qa-retrieval 技能按命令从服务器 token 文件 `/home/admin/DSH/ragflow/logs/.apitok` 注入 `RAGFLOW_API_KEY`（DSH 会把名称含 KEY/TOKEN/SECRET/PASSWORD 的变量从模型 shell 环境剥离，显式逐命令注入才可达脚本）。

## 一、知识库初始化（首次）

```sh
bash examples/grid-ops-agent/grid-qa/setup-knowledge-base.sh
```

按名称约定建两个数据集并入库 `grid-qa/corpus/`：`电网运维-规程库`（出处层①，条文类参考）与 `电网运维-用户投喂库`（出处层②，文件名自带投喂人/日期）。幂等，可重复执行。

## 二、preset 装载校验（不发起会话）

```sh
node examples/grid-ops-agent/grid-qa/check-preset-mount.mjs
```

输出 `grid-qa: listed healthy and standing mount ensured` 即 preset（apps/cli/config/agent-presets/grid-qa/）可被 roster 发现并完整装载。

## 三、端到端演示

### 情形 1：检索命中规程（headless 一次性）

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/grid-qa/grid-qa.headless.patch.yml \
  "35kV架空线路穿越树竹速长区，巡视周期怎么安排？"
```

预期：结论先行 → 引用《…规程》条款（出处层①）→ 可执行步骤。

### 情形 2：检索不中 → 通用知识 + 警示（headless 一次性）

问一个两库都没有的内容（例：两票三制的管理起源），预期回答开头单独一行出现「以下内容来自模型通用知识，非规程依据」。

### 情形 3：多轮追问 + 双模式（官方 Python SDK，JSON-RPC stdio）

```sh
python3 examples/grid-ops-agent/grid-qa/demo_multiturn.py
```

一个会话连问三轮：命中规程 → 上下文延续追问（同一区段叠加秸秆焚烧隐患：规程层依据 + 通用知识分段警示标注）→「讲解一下」切讲解导向（原理展开仍带出处）。persona 与技能目录由驱动注入，与 preset 同源。

### 情形 4（补充）：用户投喂文档命中 → 出处层②

问一个只有投喂库才有的内容（案例细节），预期标注「用户投喂文档：〈文档名〉（投喂人、日期）」并明示非正式规程；投喂文档内引用的规程不冒充层①。

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/grid-qa/grid-qa.headless.patch.yml \
  "110kV电缆终端发热缺陷那个案例里，缺陷是怎么发现、怎么定性的？"
```

## 四、模型端点切换

开发期占位用 DeepSeek API；切换到本地 vLLM 按 [model-endpoint-switch.md](model-endpoint-switch.md) 执行。

## 目录

- `grid-qa/grid-qa.headless.patch.yml` — headless 演示 overlay（persona 读 persona.md；关 web 检索）
- `grid-qa/sdk-grid-qa.cordis.yml` — SDK 多轮演示组合（JSON-RPC stdio）
- `grid-qa/demo_multiturn.py` — 多轮演示驱动
- `grid-qa/check-preset-mount.mjs` — preset 装载校验
- `grid-qa/setup-knowledge-base.sh` — 知识库初始化
- `grid-qa/corpus/{regulations,user-fed}/` — 演示语料（来源与许可见 corpus/SOURCES.md）

## 五、缺陷识别智能体 defect-inspector（08 票）

业务定义唯一位置：`apps/cli/config/agent-presets/defect-inspector/`（persona.md 只识别+定级的边界、三级定级语义、澄清式交互契约；skills/defect-inspection 检索流程）。开发期视觉输入未接入，演示输入一律为文字缺陷描述（视觉输入路径见该 persona 的「输入与视觉输入路径」节）。

### preset 装载校验（不发起会话）

```sh
node examples/grid-ops-agent/defect-inspector/check-preset-mount.mjs
```

输出 `defect-inspector: listed healthy and standing mount ensured` 即装载完整（脚本按自身目录名取 preset id）。

### 情形 5：识别成功——类型 + 部位 + 定级（headless 一次性）

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/defect-inspector/defect-inspector.headless.patch.yml \
  "110kV电缆户外终端C相尾管发热，红外测温相间最大温差17.3℃，C相较另外两相明显发红，环境温度正常，请判定缺陷。"
```

预期：按「缺陷类型 / 部位 / 定级 / 定级依据」输出，依据分层标注（规程条文 / 用户投喂文档 / 通用分级语义）；不出处置方案、不出数字置信度。

### 情形 6：存疑 → 澄清式交互 → 人工复核（官方 Python SDK，JSON-RPC stdio）

```sh
python3 examples/grid-ops-agent/defect-inspector/demo_multiturn.py
```

一个会话三个代表性请求：R1 同情形 5 的输入（识别成功）；R2 只说「绝缘子好像有点问题」（说明为什么判不了 + 反问形态/位置/背景，多轮澄清）；R3 配合穷尽（无望远镜/无人机/记录、无法靠近）→ 部分判断 + 建议人工复核 + 依据缺口说明。

### 文件

- `defect-inspector/defect-inspector.headless.patch.yml` — headless 演示 overlay（persona 读 persona.md；关 web 检索）
- `defect-inspector/sdk-defect-inspector.cordis.yml` — SDK 多轮演示组合（JSON-RPC stdio）
- `defect-inspector/demo_multiturn.py` — 澄清式交互多轮演示驱动
- `defect-inspector/check-preset-mount.mjs` — preset 装载校验

## 六、处置建议智能体 fault-advisor（08 票）

业务定义唯一位置：`apps/cli/config/agent-presets/fault-advisor/`（persona.md 分层建议结构、不编造规则、固定定位声明；skills/fault-advising 检索流程）。输入为缺陷描述文本（识别智能体下游输出或直接口述）。

### preset 装载校验（不发起会话）

```sh
node examples/grid-ops-agent/fault-advisor/check-preset-mount.mjs
```

### 情形 7：建议成功——分层结构 + 定位声明（headless 一次性）

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/fault-advisor/fault-advisor.headless.patch.yml \
  "1号主变110kV侧套管渗油，油位计比上月下降明显，套管根部法兰附近有油迹并沿本体下流，请给处置建议。"
```

预期：定级骨架 → 分步核心处置步骤（带规程依据，检索未命中的步骤明示「模型通用知识」警示）→ 严重定级自动附关联设备排查 → 工作票/操作票安全提示；不编造备件/排班/工期；末尾固定一行「辅助决策参考，严格执行以规程和工作票流程为准」。

### 情形 8：严重定级触发关联排查 + 不编造（官方 Python SDK，JSON-RPC stdio）

```sh
python3 examples/grid-ops-agent/fault-advisor/demo_multiturn.py
```

一个会话三个代表性请求：R1 电缆终端发热（识别下游输入，定级骨架直接采用不复判，分层建议 + 定位声明）；R2 GIS SF6 连接阀泄漏（严重定级 → 自动附同型家族性缺陷关联排查）；R3 追问「还能撑几天 / 明天班组有没有人」（客户侧数据不掌握，不编造数字，给出现场确认路径）。

### 文件

- `fault-advisor/fault-advisor.headless.patch.yml` — headless 演示 overlay（persona 读 persona.md；关 web 检索）
- `fault-advisor/sdk-fault-advisor.cordis.yml` — SDK 多轮演示组合（JSON-RPC stdio）
- `fault-advisor/demo_multiturn.py` — 分层建议多轮演示驱动
- `fault-advisor/check-preset-mount.mjs` — preset 装载校验

## 七、报表生成智能体 report-writer（14 票）

业务定义唯一位置：`apps/cli/config/agent-presets/report-writer/`（persona.md 双输入模式/报告结构占位/PDF 交付契约 + skills/report-writer-toolbox 历史取数与离线 PDF 脚本）。**历史结果落库**在 `report-writer/data/`（defects/disposals JSONL，全部 `source: demo` 演示数据；生产由缺陷识别/处置智能体经 `history.py append-*` 写入，契约见 data/README.md）。

### preset 装载校验（不发起会话）

```sh
node examples/grid-ops-agent/report-writer/check-preset-mount.mjs
```

### 情形 9：要点扩写成文（headless 一次性，含统计段与 PDF 产出）

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/report-writer/report-writer.headless.patch.yml \
  "把下面要点扩写成《110kV城东变2026年8月设备运维周报（第4周）》：①本周完成1次全站红外测温特巡；②发现35kV城南线电缆终端接线端子过热（严重缺陷）已转处置流程；③1号主变套管法兰渗漏油消缺完成复验；④下周计划GIS室SF6漏检专项排查启动。"
```

预期：按通用运维报告结构成文（客户历史范本未到位，文末注明范本位）；统计段数字来自历史落库脚本输出；产出 `/tmp/rw-*.pdf` 可下载查看。

### 情形 10：统计报表 + PDF + 按设备/时间专项统计（官方 Python SDK，3 个代表性请求）

```sh
python3 examples/grid-ops-agent/report-writer/demo_report.py
```

R1 要点扩写成月报 → R2 基于历史落库补统计段（识别次数/类型分布/定级分布/环比）并导出 PDF → R3 两站 6-8 月按设备对比统计。PDF 为本地离线生成（系统 python3 reportlab + 本地 CJK 字体，`report-writer-toolbox/scripts/md2pdf.py`，`REPORT_PDF_FONT` 可指定字体文件），内网断网可用。

### 文件

- `report-writer/report-writer.headless.patch.yml` — headless 演示 overlay
- `report-writer/sdk-report-writer.cordis.yml` — SDK 演示组合（JSON-RPC stdio）
- `report-writer/demo_report.py` — 3 请求演示驱动（扩写/统计+PDF/专项统计）
- `report-writer/check-preset-mount.mjs` — preset 装载校验
- `report-writer/data/{defects,disposals}.jsonl` — 历史落库演示数据（demo 标注）

## 八、知识更新智能体 kb-updater（14 票）

业务定义唯一位置：`apps/cli/config/agent-presets/kb-updater/`（persona.md 留痕必填/质检拒收/半成功反馈/无审核无下架契约 + skills/kb-updater-feed 投喂流程与图谱快照脚本）。投喂目标 = RAGFlow「电网运维-用户投喂库」（07 票建，出处层②），入库文档名带「（投喂人：姓名·日期）」供知识问答按层②标注。

### preset 装载校验（不发起会话）

```sh
node examples/grid-ops-agent/kb-updater/check-preset-mount.mjs
```

### 情形 11：无姓名投喂 → 反问（headless 一次性）

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/kb-updater/kb-updater.headless.patch.yml \
  "把 examples/grid-ops-agent/kb-updater/feed-docs/配电网架空线路防雷要点（投喂演示-半成功场景）.md 投喂进知识库"
```

预期：反问姓名/工号，不执行任何投喂动作（系统无登录体系，自报留痕必填）。

### 情形 12：投喂全行为（官方 Python SDK，4 个代表性请求）

```sh
python3 examples/grid-ops-agent/kb-updater/demo_feed.py
```

会话 A（正常配置）三请求：无姓名反问 → 王工投喂开关柜局放 PDF（质检→留痕改名→图谱增量→检索自检）→ 空白损坏 PDF 质检拒收（反馈原因、删除未入库文档）；会话 B（图谱目标故意配错 `KB_UPDATER_GRAPH_DATASET`）一请求：李工投喂防雷 md → 文档入库成功、图谱更新失败 → 明示「文档已入库，图谱更新失败（原因）」，不回滚。

### 图谱增量演示（指标② A2-3 剧本素材）

```sh
bash examples/grid-ops-agent/kb-updater/setup-graph-demo.sh       # 建「电网运维-图谱演示库」+ 基线图谱（收敛校验）
bash examples/grid-ops-agent/kb-updater/graph-increment-demo.sh   # 入库前快照 → 投喂 → 图谱增量 → 入库后快照 → 对比
```

产出 `/tmp/ku-graph-{before,after}.json` 与 `/tmp/ku-graph-diff.{json,md}`（实测 137→166 实体 / 158→211 关系，新增实体全部来自投喂文档）。**快照须用 `--server` 通道**（脚本已内置）：v0.27.0 增量构建后 `knowledge_graph` API 返回旧 graph 行，真实图谱经服务端 `get_graph` 读取。

### 文件

- `kb-updater/kb-updater.headless.patch.yml` — headless 演示 overlay
- `kb-updater/sdk-kb-updater.cordis.yml` — SDK 演示组合（bash 超时 10 分钟容纳图谱构建）
- `kb-updater/demo_feed.py` — 4 请求投喂全行为演示驱动（两会话）
- `kb-updater/check-preset-mount.mjs` — preset 装载校验
- `kb-updater/setup-graph-demo.sh` / `graph-increment-demo.sh` — 图谱演示库建库与增量快照对比
- `kb-updater/graph-corpus/` — 图谱演示语料（自编，见其 SOURCES.md）
- `kb-updater/feed-docs/` — 投喂演示文档（开关柜局放 PDF / 空白拒收 PDF / 防雷 md）

## 九、统一入口（运维助手）grid-assistant（15 票）

入口**不是智能体**（不计数于 5 智能体名册，见 [metric5-demo-record.md](metric5-demo-record.md)）：用户不选择智能体、直接说话，入口识别任务类型并路由——简单任务（问知识/要报表）委派对应能力面作答，拍照全链（识别→定级→建议）经 DSH 原生 subagent 委派串联。业务定义唯一位置：`apps/cli/config/agent-presets/grid-assistant/`（persona.md = 路由表/图像消歧/路由兜底/全链存疑中止；不含任何能力面业务文本，能力面 persona 经委派行引用）。实现机制：preset 内五个 `dsh-tool-subagent` 行（spawn 提供者），每行的 `persona` 配置把子智能体的 persona 覆盖为对应能力面的 persona.md，`toolFilter` 把子智能体工具面钉在能力面行集——被委派的子智能体即该能力面；简单任务同样走委派（统一机制）。

### preset 装载校验（不发起会话）

```sh
node examples/grid-ops-agent/grid-assistant/check-preset-mount.mjs
```

### 情形 13：简单任务路由（headless 一次性，①问知识 / ②要报表）

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/grid-assistant/grid-assistant.headless.patch.yml \
  "35kV架空线路穿越树竹速长区，巡视周期怎么安排？"
```

预期：首行〔已转知识问答〕+ 知识问答行为（引用 DL/T 741-2010 条款）。要报表同理（〔已转报表生成〕，成文 + 历史统计 + PDF 路径）。

### 情形 14-16：图像消歧与兜底（headless 一次性）

③ 无入库意图的图像/描述默认走缺陷识别（识别存疑时〔需澄清〕转述识别面的反问）；④ 言语入库意图（「存进知识库」）走投喂（转述留痕姓名反问）；⑤ 双义输入〔需澄清〕反问「识别还是入库」；⑥ 路由不中（杂问）默认以知识问答作答，不拒答。命令同情形 13，换用户消息即可（代表性消息见 [metric5-demo-record.md](metric5-demo-record.md) 入口表）。

### 情形 17：拍照全链一条龙（headless 一次性）

```sh
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/grid-assistant/grid-assistant.headless.patch.yml \
  "现场发现缺陷：110kV电缆户外终端C相尾管发热，红外测温相间最大温差17.3℃，C相较另外两相明显发红，环境温度正常。请走识别定级，然后接着给处置建议。"
```

预期：〔已转缺陷识别 → 处置建议〕——识别（类型/部位/定级/三层依据）自动衔接处置建议（采用定级不复判、分层建议、固定定位声明），一次回答完整转述。

### 情形 18：全链存疑中止 + 图像消歧闭环（官方 Python SDK，JSON-RPC stdio）

```sh
python3 examples/grid-ops-agent/grid-assistant/demo_entry_multiturn.py
```

会话 A 两轮：模糊缺陷描述 → 识别存疑澄清转述（链止于识别层，不进建议）→ 用户无法补充 → 再委派 → 部分判断 + 人工复核收尾（仍不进建议）。会话 B 两轮：双义输入反问 →「存进知识库」→ 转投喂（姓名反问转达；投喂内部行为是 14 票证据，不重复执行入库）。

### 指标⑤演示记录

五智能体 + 入口的可出示演示记录（A5-1 清单与定义 / A5-2 每智能体 3 代表性请求）：[metric5-demo-record.md](metric5-demo-record.md)。

### 文件

- `grid-assistant/grid-assistant.headless.patch.yml` — 入口 headless 演示 overlay（入口 persona 读 persona.md；五能力面 persona 经委派行引用；关 web/通用委派）
- `grid-assistant/sdk-grid-assistant.cordis.yml` — SDK 演示组合（JSON-RPC stdio；subagent 服务 + spawn 提供者 + 五委派行）
- `grid-assistant/demo_entry_multiturn.py` — 多轮演示驱动（全链存疑中止 + 图像消歧闭环，两会话）
- `grid-assistant/check-preset-mount.mjs` — preset 装载校验
