# 画布

[English](canvas.md) | 中文

[`@deepseek-ai/dsh-host-canvas`](../../packages/host/canvas) 拥有每会话的画布作品存储：面向模型的 `canvas` 工具写入、更新、选中并列出 HTML / Markdown / 纯文本作品，浏览器端通过 `canvas` Typert Remote 轮询同一个存储。Web 端位于 [`@deepseek-ai/dsh-client-ui-canvas`](../../packages/client/ui-canvas)，负责渲染右侧面板与会话中的单作品卡片。

来源：[`packages/host/canvas/src/types.ts`](../../packages/host/canvas/src/types.ts)

## 模型体验

`canvas` 工具是用户可见的展示面：作品是每会话的状态，通过 canvas storage domain 持久化，进程重启后依然保留。每个 Session 拥有独立的桶；工具结果报告已落定作品的标题、类型、字节数与 id；浏览器端在详情列实时渲染选中的作品。写入可以从工作区文件取正文（`contentPath`）并附带更多工作区文件作为附件（`attachments`，例如渲染出的 HTML 报告同源的 PDF）；浏览器端把每条已记录的附件渲染为下载链接，由 web carrier 在 `GET /api/canvas.attachment` 提供下载。作品本体经姊妹通道 `GET /api/canvas.artifact` 下载，附按 kind 推断的 media type 与文件名扩展。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcanvas--canvasservice"></a>

### `ctx.canvas` — `CanvasService`

The canvas host service: per-session artifact store persisted through the storage-domain facility, exposed as a Typert Remote (browser half polls `state`) and driving the model tool.

```ts cordis-catalog
/**
 * All mutations (tool, Remote, and host-plugin consumers such as the
 * knowledge-graph host) funnel through this single admission point. Host
 * plugins call it with `{ op: 'write', ... }` to land or refresh an artifact
 * in place; the returned artifact carries the full content.
 * @param sessionId - the session whose canvas bucket receives the operation.
 * @param args - the operation arguments, same vocabulary as the model tool.
 * @param attachments - optional resolved attachments replacing the target's.
 * @returns the mutation result with the full updated artifact.
 */
async operate( sessionId: string, args: CanvasToolArgs, attachments?: readonly CanvasArtifactAttachment[], ): Promise<SnapshotMutationResult>

/**
 * Downloads channel: open one attached file for streaming.
 * @param sessionId - the session whose bucket holds the artifact.
 * @param artifactId - the artifact carrying the attachment.
 * @param name - the attachment download filename.
 * @returns the file stream with response metadata, or undefined when the session, artifact, attachment, or file is unknown.
 */
async attachmentStream( sessionId: string, artifactId: string, name: string, ): Promise<CanvasAttachmentStream | undefined>

/**
 * Open one artifact's body as a byte stream for download: the persisted
 * content with the kind-derived media type and filename extension.
 * @param sessionId - the session whose bucket holds the artifact.
 * @param artifactId - the artifact whose body is downloaded.
 * @returns the body stream with media type, byte length, and download
 * filename (title plus kind extension), or undefined when the session or
 * artifact is unknown.
 */
async artifactBodyStream( sessionId: string, artifactId: string, ): Promise<CanvasBodyStream | undefined>

/**
 * Browser half: per-session state (artifact summaries without content,
 * selection, revision) — light enough to poll every second.
 * @param request - session identity whose bucket to read.
 * @returns the artifact summaries, selection, and revision counter.
 */
@Remote('state') state(request: CanvasStateRequest): CanvasState

/**
 * Browser half: one artifact's full record including content, fetched when
 * the polled revision or selection changes.
 * @param request - session identity and the artifact id to read.
 * @returns the artifact, or a null artifact when the id is unknown.
 */
@Remote('get') get(request: CanvasGetRequest): CanvasGetResult

/**
 * Browser half: select or deselect one artifact.
 * @param request - session identity and the artifact id to select (null deselects).
 * @returns whether the selection changed and the new selected id.
 */
@Remote('select') async select(request: CanvasSelectRequest): Promise<CanvasSelectResult>

/**
 * Browser half: seed an empty canvas with demo artifacts.
 * @param request - session identity whose empty bucket receives the demo seed.
 * @returns whether the seed succeeded and its message.
 */
@Remote('demo') async demo(request: CanvasDemoRequest): Promise<CanvasDemoResult>
```

Source: [`packages/host/canvas/src/index.ts`](../../packages/host/canvas/src/index.ts)

<a id="ctxkg--kgservice"></a>

### `ctx.kg` — `KgService`

The kg host service: owns the config and registers the kg_graph tool.

Source: [`packages/host/kg/src/index.ts`](../../packages/host/kg/src/index.ts)
<!-- END GENERATED cordis-surface -->
