# 业务逻辑与 DSH 框架解耦约定（v0.1 预览版风险对策）

> 适用对象：电网设备运维智能体线全部五个智能体（知识问答、缺陷识别、处置建议、报表生成、知识更新）。风险背景：DSH 处于 0.1.0-rc 预览版，无对外兼容承诺（仓库自述：pre-release 立场是改地基优先于保兼容）。对策 = **锁版本 + 业务定义收敛到可平移文件 + 依赖面白名单**。后续四个智能体照本约定执行。

## 1. 分层：什么算业务，什么算框架

- **业务定义**（我们拥有，随时可搬）：角色与策略（persona 文本）、输出契约（结论先行/出处标注/警示语等）、三层出处判定规则、检索流程指令、演示语料与验收剧本。**存放形态只有两种：agent preset 目录、技能（skill）目录**——都是纯文本文件，无构建产物。
- **框架机制**（DSH 拥有，锁版本使用）：preset 装载与 roster、persona/skill/bash 等插件行、会话与多轮协议（SDK JSON-RPC）、RAGFlow REST 与既有技能脚本。**使用方式只有三种：cordis.yml 组合、settings/env 配置、官方 SDK**。

判据：一句话能说清「这段内容换一个 agent 框架也要原样带走」的，是业务定义；说不清的，是对框架的引用。

## 2. 唯一位置规则（one home per agent）

每个智能体一个 preset 目录（如 `apps/cli/config/agent-presets/grid-qa/`），内含：

- `persona.md` — 角色、回答策略、输出契约（唯一业务文本源）
- `skills/<流程技能>/SKILL.md` — 该智能体的操作流程（如检索与出处判定）
- `agent.cordis.yml` + `preset.yml` — 装配与展示元数据（只引用，不复述业务文本）

演示装配（headless overlay、SDK 组合、驱动脚本）一律**引用** persona.md / 技能目录，禁止复制业务文本。检查法：`grep -r "以下内容来自模型通用知识" examples/ apps/` 的命中里，该警示语的**定义**只允许 `apps/cli/config/agent-presets/grid-qa/persona.md` 一处；其余命中只允许**引文**——README 演示情形预期（中英两侧）、`metric5-demo-record.md` 验收记录、本文件转述检查法自身——引文须原样引用警示语全文，不得改写或放宽规则语义。

## 3. 依赖面白名单

业务智能体只允许依赖以下 DSH 机制（升级评审只需重验这张表）：

| 依赖 | 用途 | 验证方式 |
|---|---|---|
| preset 组合装载（agent.cordis.yml 行语法：persona/tool-bash/tool-fs/skill-filesystem/tool-skill/compaction） | 每会话能力面 | `check-preset-mount.mjs` |
| `dsh-persona` 行（config.text） | 注入 persona | 同上 + 演示第一轮自称 |
| skill 机制（customSkillDirs + tool-skill；preset 内技能目录含 ragflow 技能符号链接） | 检索流程指令入上下文 | 演示中按流程检索 |
| bash 工具 + ragflow-dataset-ingest 技能脚本 | RAGFlow 检索 | `setup-knowledge-base.sh` 自检 |
| 服务器端 RAGFlow token 文件（默认 `/home/admin/DSH/ragflow/logs/.apitok`，环境变量 `RAGFLOW_APITOK_PATH` 可覆盖路径；覆盖变量名须避开 KEY/TOKEN/SECRET/PASSWORD 子串，否则被 DSH 凭据卫生从 shell 环境剥离而失效。凭据值本身仍须逐命令显式注入，见 grid-qa-retrieval 技能） | 检索鉴权 | 演示第 1 轮命中规程 |
| SDK JSON-RPC（session/prompt 多轮） | API 直调与多轮 | `demo_multiturn.py` |
| settings/env 端点配置（llm-deepseek 小节） | 模型端点切换 | `model-endpoint-switch.md` 第 4 节 |

**禁止**：修改 `packages/` 任何产品包；fork/patch vendored Cordis；依赖白名单外的内部服务 API；为单个智能体新建 npm 包（纯配置不建包）。

## 4. 锁版本

- 基线：本仓库 `0.1.0-rc.8`（master，施工记录在票 07）。升级 DSH = 专门变更：重跑 `check-preset-mount.mjs` + 三情形演示 + 端点切换手册第 4 节验证，全绿才合入。
- RAGFlow 镜像固定 `infiniflow/ragflow:v0.27.0` + 已挂载补丁（见 `~/DSH/ragflow-dsh-integration-plan.md` §7 升级注意）。

## 5. 平移步骤（新环境/新机器）

1. 同版本 DSH 就位（本仓库 checkout 同 commit，`pnpm install`）。
2. 复制各智能体 preset 目录到部署的 roster root（shipped root `apps/cli/config/agent-presets/`，或用户 root `$DSH_HOME/.agent-presets/`）；15 票起为**六个目录一起**（grid-assistant 入口以兄弟相对路径引用五个能力面的 persona.md 与 skills/）。
3. 复制 `.agents/skills/ragflow-dataset-ingest/`（RAGFlow 技能）与各 preset 内技能随目录自带。
4. RAGFlow：docker save 镜像 + 导出 volumes（mysql/minio/infinity/ollama），或在新环境重灌语料（`setup-knowledge-base.sh`，语料在 `examples/grid-ops-agent/grid-qa/corpus/`）。
5. 凭据与端点：`.credentials.yaml` + settings `llm-deepseek:` 小节（内网指向本地 vLLM，见 `model-endpoint-switch.md`）。
6. 验收：第 3 节白名单六项全部重跑。

## 6. 后续四个智能体的复制范式（从 grid-07 起）

1. 建 `apps/cli/config/agent-presets/<agent-id>/`：`persona.md`（策略与输出契约）+ `skills/<agent-id>-<流程>/SKILL.md` + `agent.cordis.yml`（从 grid-qa 复制改行集）+ `preset.yml`。
2. 演示装配放 `examples/grid-ops-agent/<agent-id>/`：headless overlay（`!!js` 读本 agent persona.md）+ 按需 SDK 组合/驱动。
3. 固定验收件：`check-preset-mount.mjs` 泛化指向新 preset id；端到端演示至少覆盖该智能体需求条文里的判定性行为（如缺陷识别的澄清式交互、处置建议的分层动态）。
4. 入库语料归 `corpus/`，来源与许可记入 `corpus/SOURCES.md`。
5. 每个智能体交付时在票内登记：preset 目录绝对路径、白名单表是否有新增依赖（新增即修订本约定）。

## 7. 预设清单（08 票起登记；新智能体交付时追加行）

| 智能体 | preset 目录（apps/cli/config/agent-presets/ 下） | order | 交付票 | 白名单新增 |
|---|---|---|---|---|
| 知识问答 grid-qa | `grid-qa/` | 5 | 07 | 无 |
| 缺陷识别 defect-inspector | `defect-inspector/` | 6 | 08 | 无（行集与 grid-qa 相同；检索只读复用同一 RAGFlow 技能与服务器 token 文件） |
| 处置建议 fault-advisor | `fault-advisor/` | 7 | 08 | 无（行集与 grid-qa 相同；同上） |
| 报表生成 report-writer | `report-writer/` | 8 | 14 | 有，见下 |
| 知识更新 kb-updater | `kb-updater/` | 9 | 14 | 有，见下 |
| 统一入口 grid-assistant | `grid-assistant/` | 0 | 15 | 有，见下 |

入口 grid-assistant **不是智能体**（不计数于 5 智能体名册）：它是会话入口/路由职能，工具面 = 五个能力面委派行（`dsh-tool-subagent` × 5，spawn 提供者），每行 `persona` 配置把子智能体 persona 覆盖为对应能力面的 persona.md（兄弟目录相对路径引用，业务文本仍各归其家）、`toolFilter` 把子智能体工具面钉在能力面行集。bash/fs/skill 行与能力面共享——DSH 子智能体加入父会话的 preset 组合（`composeFrom`），共享行是被委派子智能体的工具面；入口自身不直接做业务活由 persona 约束（机制上 preset 内无法按 agent 区分工具可见性）。平移时六个 preset 目录须一起复制（入口引用兄弟能力面目录）。

08 票两 preset 的演示装配在 `examples/grid-ops-agent/{defect-inspector,fault-advisor}/`；`check-preset-mount.mjs` 自 08 票起按脚本所在目录名推导 preset id（一份脚本体服务所有智能体叶，grid-qa 的旧脚本保持原样）。14 票两 preset 的装载校验沿用 grid-qa 形态（各自叶内独立脚本、显式 preset id）。15 票入口的装载校验沿用 08 票形态（按目录名推导）。各叶各持一份装载校验脚本拷贝、keyless smoke 暂不入仓内测试套件：已登记为取舍（见各交付票），不视为遗漏。

14 票白名单新增（第 3 节表追加口径，升级评审与平移时一并核对）：

- **报表生成 report-writer**：系统 `python3 + reportlab + 本地 CJK 字体`（`report-writer-toolbox/scripts/md2pdf.py` 离线 PDF 生成，`REPORT_PDF_FONT` 指定字体文件）；同技能 `scripts/history.py` 读写历史落库 JSONL（落库数据在部署侧 `examples/grid-ops-agent/report-writer/data/`，可用 `--store` 换库）。无 RAGFlow 依赖（报表统计只取历史落库，不检索知识库）。
- **知识更新 kb-updater**：复用 ragflow-dataset-ingest 技能脚本与服务器 token 文件（同 grid-qa）；新增两类服务器端部署件——图谱构建触发脚本 `KB_UPDATER_GRAPH_SCRIPT`（默认 `/home/admin/DSH/ragflow/ragflow-run-graphrag.sh`，绕 v0.27.0 #18760 回归）与图谱快照 docker exec 读取通道（`graph_snapshot.py --server`：增量构建后 `knowledge_graph` API 返回旧 graph 行，真实图谱须经容器内 `get_graph` 读取）；质检拒收用 RAGFlow 官方删除 API（`DELETE /api/v1/datasets/{id}/documents`，删的是未入库的失败上传，不构成下架能力）。
- **统一入口 grid-assistant**：DSH 原生 subagent 委派（`dsh-subagent` 服务 + `dsh-subagent-spawn-in-process` 提供者由 base 组合注册，preset 只加 `dsh-tool-subagent` 消费行 ×5：`persona` 覆盖 + `toolFilter` 钉子 + `maxDepth: 1` + 前台一次性）；SDK 演示组合需自带 subagent 服务/提供者行与 `dsh-attachment-local`（`tool-fs` 仅在附件存储挂载时注册 `read_image`，而委派行 toolFilter 点名它）。会话中途 preset 切换被硬锁（`agent-preset-locked`），路由全部经「会话创建时选入口 preset + 子智能体委派」两层实现，不依赖中途切换。
