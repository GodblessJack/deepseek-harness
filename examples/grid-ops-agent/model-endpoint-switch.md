# DSH 模型端点切换手册：DeepSeek API → 本地 vLLM（OpenAI 兼容）

> 目标读者：在本机运维 DSH 部署的工程师。照做即完成切换；每步带验证。开发期以现有 DeepSeek API 为占位端点（`$DSH_HOME/.credentials.yaml` 中的 `DEEPSEEK_API_KEY`），本手册在 vLLM 就绪后执行即可切换。
>
> 范围：DSH 的**模型调用平面**（chat/completions）。RAGFlow 自身的模型渠道（图谱抽取等）见第六节；检索平面（RAGFlow REST 9380）与模型端点无关，不受影响。

## 0. 机制：端点在哪里决定

DSH 的 DeepSeek 适配器（`@deepseek-ai/dsh-llm-deepseek`，provider 路由 `deepseek-official`）按以下优先级解析端点与密钥（每请求解析，端点与密钥同一代生效）：

1. **settings 文档** `$DSH_HOME/settings.yaml` 的 `llm-deepseek:` 小节（热加载，Web 服务无需重启）——本手册的主路径；
2. **环境变量** `DEEPSEEK_BASE_URL`（仅启动环境快照这一受信层，改环境须重启进程）与 `DEEPSEEK_API_KEY`（经凭据存储按请求解析：进程环境 > `$DSH_HOME/.credentials.yaml` > 项目/用户 `.env`）;
3. 组合层 `cordis.patch.yml` 直接给 `llm-deepseek` 行 `config.baseURL`（部署期固化用，优先级低于 settings 小节）。

都未设置时使用公网 `https://api.deepseek.com`。

## 1. 前置：vLLM 端点自检

```sh
# 假设 vLLM 以 OpenAI 兼容模式服务（按实际端口/模型名替换）
curl -s http://127.0.0.1:8000/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <vllm-api-key-or-any>' \
  -d '{"model":"<served-model-name>","messages":[{"role":"user","content":"ping"}],"max_tokens":8}'
```

记录三个值：`<base-url>`（含 `/v1`）、`<served-model-name>`（vLLM `--served-model-name`，下文以 `grid-llm-v1` 代称）、`<api-key>`（vLLM 未设 `--api-key` 时任意非空串即可）。

## 2. 密钥：新增一条凭据（不动 DeepSeek 占位键）

在 `$DSH_HOME/.credentials.yaml`（owner-only 文件）追加一行，避免覆盖开发期占位用的 `DEEPSEEK_API_KEY`：

```yaml
GRID_LLM_API_KEY: <vllm-api-key-or-dummy>
```

## 3. 端点：写 settings 小节（Web 服务热加载，不重启）

编辑 `$DSH_HOME/settings.yaml`，把 `llm-deepseek:` 小节改为（保留原有其他小节）：

```yaml
llm-deepseek:
  baseURL: http://127.0.0.1:8000/v1
  apiKeyEnv: GRID_LLM_API_KEY
  models:
    - id: grid-llm-v1
      name: 本地 vLLM
```

要点：

- `apiKeyEnv` 指向第 2 步的凭据名；密钥与端点同一代解析，不会出现新端点配旧密钥。
- `models[].id` 必须与 vLLM `--served-model-name` 完全一致，否则模型选择器发出的 model 名不被端点认识。
- 现存会话不受影响（每请求解析），新请求即走新端点。
- 若端点拒绝 reasoning 参数（返回 4xx 且日志含 reasoning/thinking 字样），在小节里加 `reasoningEffort: off`（或 `thinking: disabled`）后重试。

## 4. 验证

```sh
# 4.1 headless 一次性（走同一 settings；从仓库根执行）
CI=true pnpm dsh --profile headless "只回复两个字符：ok"
# 预期 stdout: ok
```

```sh
# 4.2 端点侧确认：vLLM 日志出现该请求（model=grid-llm-v1），且 DeepSeek API 后台无新调用
```

```sh
# 4.3 知识问答智能体回归（检索平面不受影响）
CI=true pnpm dsh --profile headless \
  --patch examples/grid-ops-agent/grid-qa/grid-qa.headless.patch.yml \
  "35kV架空线路穿越树竹速长区，巡视周期怎么安排？"
# 预期：仍引用规程出处作答（RAGFlow 检索与模型端点相互独立）
```

Web 界面：刷新模型选择页，`本地 vLLM` 出现并可选中；发一条消息能收到回复。

## 5. CLI / SDK 直连通道（不走 settings 时）

- **Python SDK**（官方外部 API 通道）：`DeepSeekHarness(base_url="http://127.0.0.1:8000/v1", api_key="<key>", model="grid-llm-v1", ...)`——构造参数写入 runtime 子进程的 `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY`。
- **一次性 env**（headless/临时进程）：`DEEPSEEK_BASE_URL=… DEEPSEEK_API_KEY=… CI=true pnpm dsh --profile headless "…"`。
- **systemd 服务**（dsh-web）：改用 env 路线时在 unit 加 `Environment=DEEPSEEK_BASE_URL=…` 后 `systemctl --user restart dsh-web`；settings 路线（第 3 节）无需这些。

## 6. RAGFlow 模型渠道（全内网时一并切）

RAGFlow 栈内租户 provider（图谱抽取/关键词改写当前用 DeepSeek API）同样换 base_url：管理 API `PUT /api/v1/providers/<name>/instances`（或重建实例），模型名对齐 vLLM 服务名。本节仅在内网断网演练时需要；只切 DSH 端点时可不动。

## 7. 回退

删除（或注释）`llm-deepseek:` 小节中的 `baseURL`/`apiKeyEnv`/新增 `models` 条目，下一个请求即回到公网 DeepSeek API 与原凭据。组合层若曾设 `config.baseURL`，同样删除。

## 8. 常见故障

| 现象 | 判定 |
|---|---|
| Web 模型页无新模型 | `models[].id` 与 served-model-name 不一致，或 settings.yaml 缩进错误（热加载失败会在服务日志报解析错误） |
| `no API key for provider route` | 凭据名与 `apiKeyEnv` 不一致，或 `.credentials.yaml` 不是 owner-only（600） |
| 404 on /chat/completions | `baseURL` 缺 `/v1` 或多写 `/chat/completions` |
| 回复异常慢/拒答 reasoning 参数 | 见第 3 节 `reasoningEffort: off` |
