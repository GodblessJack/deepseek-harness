# 指标⑤演示就绪记录（5 智能体 + 统一入口）

> 口径：`/home/admin/modeltest/docs/acceptance-test-plan.md` §6（A5-1 清单与定义 / A5-2 逐个 API 演示 / A5-3 视觉输入路径）。开发期 API 通道 = DSH 会话面（`CI=true pnpm dsh --profile headless --patch …` 一次性请求 + 官方 Python SDK JSON-RPC 多轮会话，见 `spec.md` 测试策略④"每智能体经 DSH 会话发代表性请求"）；验收日 8080 网关重放由部署线（09 票）接入同一会话面。本记录引用各票已交付的演示输出，不重复执行；入口（运维助手）的演示为本票（15 票）新录，输出存 `/tmp/ga-*.out`。
>
> 生成日期：2026-09-05（15 票交付时点）。

## A5-1 智能体清单与定义文档（实配 5，无冗余）

每个智能体的定义文档 = 其 preset 目录的 `persona.md`（名称/职责/输入输出契约的唯一业务文本源），业务需求条文出处为 `/home/admin/modeltest/docs/agent-requirements.md` 对应节。

| # | 智能体 | 定义文档（绝对路径） | preset 装配 | 需求条文 | 交付票 |
|---|---|---|---|---|---|
| 1 | 知识问答 | `/home/admin/DSH/deepseek-harness/apps/cli/config/agent-presets/grid-qa/persona.md` | `apps/cli/config/agent-presets/grid-qa/agent.cordis.yml` | §1 | 07 |
| 2 | 缺陷识别 | `/home/admin/DSH/deepseek-harness/apps/cli/config/agent-presets/defect-inspector/persona.md` | `apps/cli/config/agent-presets/defect-inspector/agent.cordis.yml` | §2 | 08 |
| 3 | 处置建议 | `/home/admin/DSH/deepseek-harness/apps/cli/config/agent-presets/fault-advisor/persona.md` | `apps/cli/config/agent-presets/fault-advisor/agent.cordis.yml` | §3 | 08 |
| 4 | 报表生成 | `/home/admin/DSH/deepseek-harness/apps/cli/config/agent-presets/report-writer/persona.md` | `apps/cli/config/agent-presets/report-writer/agent.cordis.yml` | §4 | 14 |
| 5 | 知识更新 | `/home/admin/DSH/deepseek-harness/apps/cli/config/agent-presets/kb-updater/persona.md` | `apps/cli/config/agent-presets/kb-updater/agent.cordis.yml` | §5 | 14 |

**任务路由为统一入口职能，非智能体（A5-1 判据）**：统一对话入口「运维助手」是系统入口/交互形态，承担任务识别与路由（简单任务委派对应能力面作答、拍照全链经 DSH 原生 subagent 委派串联），不计数、不在 5 智能体名册内（`agent-requirements.md` §0「协同调度名目已取消」）。入口自身的路由定义文档：`/home/admin/DSH/deepseek-harness/apps/cli/config/agent-presets/grid-assistant/persona.md`（15 票交付）；入口的工具面 = 五个能力面委派行（组合即策略），自身不做检索/识别/成文/入库。

装载与直调不受影响（15 票复验，输出 `/tmp/ga-mount-checks.out`）：六个 preset（五能力面 + 入口）经 `node examples/grid-ops-agent/<id>/check-preset-mount.mjs` 全部 `listed healthy and standing mount ensured`——入口上线后五个能力面仍可各自经 API 直调。

## A5-2 每智能体 3 个代表性 API 请求记录

各票演示命令与预期行为登记于 `/home/admin/DSH/deepseek-harness/examples/grid-ops-agent/README.md` 对应节，实测记录在各票施工记录（`/home/admin/modeltest/.scratch/execution-plan/issues/07-dsh-endpoint-switch-first-agent.md`、`08-defect-recognition-and-advising.md`、`14-report-and-knowledge-update.md` 的 ## Comments）。重放即按 README 命令执行。

### 1. 知识问答（07 票）

| # | 代表性请求 | 通道 | 实测要点（07 票施工记录） |
|---|---|---|---|
| 1 | 「35kV架空线路穿越树竹速长区，巡视周期怎么安排？」（规程命中） | headless（README 情形 1） | 结论先行，引用《架空输电线路运行规程》DL/T 741-2010 第 6.4.4 条（半月周期），出处层① |
| 2 | 「电力系统频率偏差的治理措施有哪些？」（检索不中） | headless（情形 2） | 开头独立一行「以下内容来自模型通用知识，非规程依据」，不拒答，结尾说明库内无对应规程 |
| 3 | 多轮三轮：命中 → 追问秸秆焚烧 →「讲解一下为什么」 | Python SDK `demo_multiturn.py`（情形 3） | 一个会话三轮全部 completed；上下文延续、出处分层标注、「讲解」切讲解导向 |

### 2. 缺陷识别（08 票）

| # | 代表性请求 | 通道 | 实测要点（08 票施工记录） |
|---|---|---|---|
| 1 | 110kV 电缆终端 C 相尾管发热、相间温差 17.3℃（识别成功） | headless（情形 5） | 按「缺陷类型/部位/定级/定级依据」输出，依据分层标注；不出处置、不出数字置信度 |
| 2 | 「绝缘子好像有点问题」（存疑） | Python SDK `demo_multiturn.py` R2（情形 6） | 说明判不了的原因 + 反问形态/位置/背景（澄清式交互） |
| 3 | 配合穷尽（无望远镜/无人机/记录、无法靠近） | Python SDK `demo_multiturn.py` R3（情形 6） | 部分判断 + 建议人工复核 + 依据缺口说明 |

### 3. 处置建议（08 票）

| # | 代表性请求 | 通道 | 实测要点（08 票施工记录） |
|---|---|---|---|
| 1 | 1号主变套管渗油（口述缺陷直调） | headless（情形 7） | 定级骨架 → 分步核心处置（带规程依据）→ 关联排查 → 工作票提示 → 固定定位声明；不编造备件/工期 |
| 2 | GIS SF6 连接阀泄漏（严重定级） | Python SDK `demo_multiturn.py` R2（情形 8） | 严重定级自动附同型家族性缺陷关联排查 |
| 3 | 追问「还能撑几天/明天有没有人」 | Python SDK `demo_multiturn.py` R3（情形 8） | 客户侧数据不掌握，不编造数字，给出现场确认路径 |

### 4. 报表生成（14 票）

| # | 代表性请求 | 通道 | 实测要点（14 票施工记录） |
|---|---|---|---|
| 1 | 周报要点扩写（4 条要点） | headless（情形 9） | 通用结构成文、统计段取自历史库脚本、缺项「（待补充）」占位不虚构、产出可下载 PDF |
| 2 | 月报扩写 + 历史统计（识别/类型/定级分布、环比）+ PDF | Python SDK `demo_report.py` R1-R2（情形 10） | 统计数字全部来自 `history.py` 输出，PDF 本地离线生成（reportlab + 本地 CJK 字体） |
| 3 | 两站 6-8 月按设备对比统计 | Python SDK `demo_report.py` R3（情形 10） | 按设备/时间专项统计，口径与落库记录一致 |

### 5. 知识更新（14 票）

| # | 代表性请求 | 通道 | 实测要点（14 票施工记录） |
|---|---|---|---|
| 1 | 投喂未报姓名 → 反问 | headless（情形 11） | 反问姓名/工号，不执行任何投喂动作（留痕必填） |
| 2 | 王工投喂开关柜局放 PDF；空白损坏 PDF 投喂 | Python SDK `demo_feed.py` 会话 A（情形 12） | 质检 → 留痕改名入库 → 图谱增量 → 检索自检；空白 PDF 拒收并反馈原因、删除未入库文档 |
| 3 | 李工投喂防雷 md（图谱目标故意配错） | Python SDK `demo_feed.py` 会话 B（情形 12） | 文档入库成功、图谱更新失败 → 明示「文档已入库，图谱更新失败（原因）」，不回滚 |

补充（指标②素材）：图谱增量演示 `setup-graph-demo.sh` + `graph-increment-demo.sh` 实测 137→166 实体 / 158→211 关系（快照 `/tmp/ku-graph-{before,after}.json` 与 diff）。

## 入口（运维助手，非智能体）演示记录（15 票，2026-09-05）

命令均自仓库根执行，`CI=true pnpm dsh --profile headless --patch examples/grid-ops-agent/grid-assistant/grid-assistant.headless.patch.yml "〈用户消息〉"`；多轮为 `python3 examples/grid-ops-agent/grid-assistant/demo_entry_multiturn.py`。输出全文存 `/tmp/ga-*.out`。

| # | 验收行为 | 用户消息（代表性请求） | 实测要点 | 输出 |
|---|---|---|---|---|
| ① | 简单任务路由：问知识 | 35kV架空线路穿越树竹速长区，巡视周期怎么安排？ | 〔已转知识问答〕+ 引用 DL/T 741-2010 6.4.4 的回答（知识问答行为带引用） | `/tmp/ga-demo1-knowledge.out` |
| ② | 简单任务路由：要报表 | 周报要点扩写（4 条要点） | 〔已转报表生成〕+ 通用结构成文、统计段来自历史库、PDF 交付（`/tmp/ga-demo2-report.pdf`） | `/tmp/ga-demo2-report.out` |
| ③ | 图像默认走识别 | 拍了张 110kV 电缆终端照片，C 相尾管发红，你看看 | 无入库意图 → 委派缺陷识别；识别存疑 → 〔需澄清〕转述识别面的澄清反问（测温数据/形态/背景），链未进建议 | `/tmp/ga-demo3-image-default.out` |
| ④ | 显式入库意图走投喂 | 把 kb-updater/feed-docs/配电网架空线路防雷要点….md 存进知识库 | 言语入库意图 → 委派知识更新；〔需澄清〕原样转述留痕姓名反问「请先告知您的姓名/工号（投喂留痕用）」 | `/tmp/ga-demo4-feed-intent.out` |
| ⑤ | 图像存疑澄清反问 | 拍了份开关柜的局部放电检测资料，帮我处理一下 | 〔需澄清〕入口反问「识别缺陷还是存进知识库？」（双义消歧），不做内容启发式 | `/tmp/ga-demo5-image-ambiguous.out` |
| ⑥ | 路由不中兜底 | 中秋值班安全提醒祝福语三句 | 不匹配任何能力面 → 〔已转知识问答〕作答（宽松型兜底），不拒答、不建闲聊层 | `/tmp/ga-demo6-fallback.out` |
| ⑦ | 拍照全链一条龙 | 110kV 电缆终端 C 相尾管发热 17.3℃，请走识别定级然后给处置建议 | 〔已转缺陷识别 → 处置建议〕：识别给类型/部位/定级（危急）/三层依据 → 自动衔接处置建议（采用定级不复判、分层建议、固定定位声明），一次回答完整转述 | `/tmp/ga-demo7-fullchain.out` |
| ⑧ | 全链存疑中止 | SDK 多轮：绝缘子模糊描述 → 表示无法补充 | 识别澄清反问转述、链中止于识别层；再委派后部分判断（类型/部位成立、定级缺失）+ 转人工复核收尾；全程未委派处置建议（无定级不给建议）。会话 B：双义反问 →「存进知识库」→ 转投喂（姓名反问转达） | `/tmp/ga-demo8-multiturn.out` |

语音通路说明：语音经本地转写（FunASR，部署归 09 票）后走同一文本链路，入口不感知模态（`agent-requirements.md` §0 输入模态）。

## 验收日重放指引

1. 本机预演（开发期通道）：按 `README.md` 各节命令逐个重放（建库 `setup-knowledge-base.sh` → 装载校验 `check-preset-mount.mjs` → 各情形命令）。
2. 8080 网关（验收日）：部署线（09 票）将同一 DSH 会话面挂到对外网关后，按本记录 A5-2 的「代表性请求」列逐智能体重放 3 请求。
3. A5-3 视觉输入路径：开发期演示走文字链路（defect-inspector persona「输入与视觉输入路径」节已写明接入后判定流程不变），多模态确认后补照片重放，当前出示路径说明并标注待验。
