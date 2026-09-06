# @deepseek-ai/dsh-host-canvas

[English](README.md) | 中文

DeepSeek Harness 宿主侧右侧画布。`CanvasService` 注册 `ctx.canvas` 服务，发布生成的 Host Remote 契约 `canvas.state`、`canvas.get`、`canvas.select`、`canvas.demo`，为 HTTP carrier 暴露 `attachmentStream` 下载方法，并注册面向模型的 `canvas` 工具。作品是 HTML、Markdown 或纯文本，经 storage-domain 设施按 Session 存储；作品可携带可下载附件（会话工作区内的文件）。浏览器半边（`@deepseek-ai/dsh-client-ui-canvas`）轮询 Remote 获取状态（不含内容的作品摘要），并在修订号或选中项变化时按 id 拉取选中作品的内容。

## Service 与 Host Remote 契约

服务注入 `tools` 与 `storageDomain` 注册表。三个 Remote 方法发布在 `canvas` 命名空间下：

| 方法 | 请求 | 结果 |
|---|---|---|
| `canvas.state` | `{ sessionId }` | 每会话 `CanvasState`：作品摘要（含附件、不含内容）、选中项、单调 `rev` |
| `canvas.get` | `{ sessionId, id }` | 单个作品的完整记录（含内容）；artifact 为 null 表示 id 未知 |
| `canvas.select` | `{ sessionId, id \| null }` | `{ ok, selected, message }`；`id: null` 取消选中 |
| `canvas.demo` | `{ sessionId }` | `{ ok, message }`；向空画布填入两个示例作品 |

`state` 是 direct（无流式）；`select` 与 `demo` 在解析前先持久化变更。桶是持久的：canvas storage domain 每个 Session 一行，进程重启后作品恢复、id 计数器越过已持久化的最大值继续。会话间不共享桶。

Remote 面之外，`attachmentStream(sessionId, artifactId, name)` 把一条已记录附件作为字节流打开，附 media type 与长度；web carrier 在 `GET /api/canvas.attachment` 以 UTF-8 `content-disposition` 文件名提供下载。会话、作品、附件名或底层文件未知时解析为 `undefined`（carrier 答 404）。`artifactBodyStream(sessionId, artifactId)` 同样打开作品本体，附按 kind 推断的 media type 与文件名扩展，经 `GET /api/canvas.artifact` 提供；会话或作品未知时解析为 `undefined`。

## canvas 工具

插件在 `ctx.tools` 上注册一个名为 `canvas` 的面向模型的工具。参数与 Remote 动词对应：`op`（`write | update | get | list | select | remove | clear | demo`）、可选 `id`、`title`、`kind`（`html | markdown | text`）与 `content`。写入与更新会选中受影响的作品；工具返回会话中展示的规范化消息文本。`get` 内联返回作品内容，`list` 返回全部作品的摘要。

长文内容可经 `contentPath` 而非 `content` 到达（互斥）：会话工作区内的文件，上限 2 MiB，写入时读为作品内容。`write` 还接受 `attachments`：一组会话工作区内的 `{ name, path }` 文件，记录大小与按文件路径推断的 media type（记录的 name 仍作下载文件名）；浏览器半边为每条附件渲染一个下载链接。附件路径与 `contentPath` 必须解析进会话工作区——越出的路径被拒绝且不记录作品。不带 `attachments` 的 `update` 保留原附件列表。

```yaml
- id: canvas
  name: '@deepseek-ai/dsh-host-canvas'
```

## 模型体验

### 工具 schema

#### 模型所见

模型看到生成的 [`canvas` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-host-canvas)。

#### Token 影响

工具可见的每个请求承担固定 schema 开销。

#### KV Cache 影响

定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使该 schema 的复用失效。

### 工具调用结果

#### 模型所见

每次落定的调用返回规范化消息文本（write/update 报告 id、标题、类型与字节数，记录了附件时附附件数；拒绝时点明违反的工作区规则）。完整画布状态在 storage domain；浏览器半边轮询它，除工具结果外没有画布输出进入模型上下文。

#### Token 影响

每次调用一条 tool-result 消息，以规范化消息文本为界；作品内容不会经本包回显进模型上下文。

#### KV Cache 影响

同一落定结果对应固定结果文本，重放友好；除消息位置外自身无影响。

## Known Limitations and Deferred Work

- **No artifact streaming** — `state` 每次轮询返回全部作品摘要（不含内容），选中作品内容按修订号变化经 `get` 拉取；大作品仅受 storage domain 记录大小约束。
- **No cross-session sharing** — 每个 Session 按设计拥有隔离的桶；会话间共享作品已延后。
- **Attachments are references, not copies** — 附件记录写入时的工作区路径；工作区文件日后被删则下载 404。把文件拷进画布自有存储，待有部署需要作品比工作区长命再做。
