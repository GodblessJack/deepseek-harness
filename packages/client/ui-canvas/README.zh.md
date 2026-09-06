# @deepseek-ai/dsh-client-ui-canvas

[English](README.md) | 中文

画布侧面板的浏览器半边：右侧作品面板与会话中的单作品卡片。它经 `api-remotes` 组装消费来自 [`@deepseek-ai/dsh-host-canvas`](../../host/canvas/README.zh.md) 的 `canvas` Host Remote，渲染两个 slot：

- `details` — 右侧面板：作品页签、选中作品的查看器（HTML 沙箱 iframe、支持管道表格的本地 Markdown 渲染器或纯文本），以及每条已记录附件一个下载链接。面板头部提供关闭、下载（作品本体经 `GET /api/canvas.artifact`）、复制、打印操作；打印在新标签打开作品（HTML 原样、markdown 经面板渲染器渲染）并调起浏览器打印对话框。
- `tool.call.toolview` key `canvas` — 每次画布工具调用一张会话卡片，点击可在面板中打开该作品。

浏览器插件不声明宿主侧行为；它经 `exports["./client"]` 与 `dsh.client` manifest 交付，通过 `dsh-web-app` bundle 名单组合。

```yaml
- id: ui-canvas
  name: '@deepseek-ai/dsh-client-ui-canvas'
```

## 数据与生命周期

每个 Session 一个 `CanvasController`，包装生成的 `remote.canvas` 面与详情列开合动作。面板挂载期间以 1 秒间隔轮询 `canvas.state`（仅摘要——选中作品的内容在修订号或选中项变化时按需拉取）；卡片从落定的工具结果文本解析作品身份，每次写入自动打开一次面板。轮询到的作品附件经 carrier 的 `GET /api/canvas.attachment` 端点成为下载链接（PDF 附件显示 下载 PDF）；文件缺失时 carrier 答 404，浏览器以自身下载错误呈现。全部状态保留在 Host 存储；刷新页面重新轮询 Host，重新渲染该 Session 仍持有的内容。

## 模型体验

None, as this browser-only plugin registers no prompt, tool, message, or provider request. It renders Host-owned tool output; nothing here enters model input.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Poll-based panel** — 详情面板以固定 1 秒间隔轮询而非订阅推送通道；Host 未拥有画布变更的事件流。轮询只携带不含内容的摘要；内容按修订号或选中项变化重新拉取。
- **Card parsing is message-text coupled** — 会话卡片从画布工具落定的消息文本推导作品 id；Host 侧消息格式变更须同步到这里。
- **Attachment links assume the carrier mount** — 下载 URL 指向 web carrier 的 `/api/canvas.attachment`；其他 carrier（ACP、JSON-RPC）拿到附件元数据但没有自己的传输通路。
