/**
 * Canvas side panel host: the model-facing `canvas` tool and the per-session
 * artifact store, exposed to the browser half through a Typert Remote.
 * @module @deepseek-ai/dsh-host-canvas
 */

import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { relative, resolve } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {
  CanvasArtifact,
  CanvasArtifactAttachment,
  CanvasArtifactSummary,
  CanvasDemoRequest,
  CanvasGetRequest,
  CanvasGetResult,
  CanvasDemoResult,
  CanvasSelectRequest,
  CanvasSelectResult,
  CanvasState,
  CanvasStateRequest,
} from './types.ts'
import { canvasDomainSpec, type CanvasBucketRow } from './spec.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    canvas: CanvasService
  }
}

/** One per-session canvas bucket as persisted on disk. */
type CanvasBucket = CanvasBucketRow

const KIND_KEYS: readonly ('html' | 'markdown' | 'text')[] = ['html', 'markdown', 'text']

function isKind(value: unknown): value is CanvasArtifact['kind'] {
  return typeof value === 'string' && KIND_KEYS.includes(value as CanvasArtifact['kind'])
}

/** Attachment input as the model tool receives it; resolved against the session workspace before storage. */
export interface CanvasToolAttachmentInput {
  readonly name: string
  readonly path: string
}

/** Extension-keyed media types for attachment downloads; unknown extensions are opaque bytes. */
const ATTACHMENT_MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
}

/** Upper bound for one contentPath read — a canvas artifact is presentation text, not bulk file transport. */
const MAX_CONTENT_PATH_BYTES = 2 * 1024 * 1024

function mediaTypeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  const extension = dot === -1 ? '' : path.slice(dot).toLowerCase()
  return ATTACHMENT_MEDIA_TYPES[extension] ?? 'application/octet-stream'
}

/** Download media type and filename extension per artifact kind. */
const ARTIFACT_BODY_KINDS: Readonly<Record<CanvasArtifact['kind'], { mediaType: string; extension: string }>> = {
  html: { mediaType: 'text/html', extension: '.html' },
  markdown: { mediaType: 'text/markdown', extension: '.md' },
  text: { mediaType: 'text/plain', extension: '.txt' },
}

/** One artifact body opened for download: the content bytes and download naming. */
export interface CanvasBodyStream {
  readonly stream: ReadableStream<Uint8Array>
  readonly mediaType: string
  readonly bytes: number
  readonly filename: string
}

/** One resolved attachment: the absolute host path, media type, and byte size recorded at write time. */
export interface CanvasAttachmentStream {
  readonly stream: ReadableStream<Uint8Array>
  readonly mediaType: string
  readonly bytes: number
}

/** DEMO_HTML is a self-contained interactive card the demo seed writes. */
const DEMO_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>互动卡片</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e293b,#0f172a);font-family:system-ui,-apple-system,sans-serif;color:#e2e8f0}
  .card{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:32px 40px;max-width:360px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.45)}
  h1{font-size:20px;margin:0 0 8px}
  p{color:#94a3b8;font-size:14px;margin:0 0 20px;line-height:1.6}
  .count{font-size:44px;font-weight:700;color:#38bdf8;margin:0 0 20px}
  button{background:#38bdf8;color:#0f172a;border:none;border-radius:10px;padding:10px 22px;font-size:15px;font-weight:600;cursor:pointer}
  button:active{transform:scale(.97)}
</style>
</head>
<body>
<div class="card">
  <h1>交互式画布卡片</h1>
  <p>这是画布中的 HTML 内容, 由对话里的 agent 写入, 可以包含交互脚本。</p>
  <div class="count" id="count">0</div>
  <button id="btn" type="button">点我 +1</button>
</div>
<script>
  var n = 0
  var count = document.getElementById('count')
  document.getElementById('btn').addEventListener('click', function () {
    n += 1
    count.textContent = n
  })
</script>
</body>
</html>`

const DEMO_MD = [
  '# 项目说明',
  '',
  '这是一份 **Markdown** 作品, 由画布渲染。支持标题、列表、引用、行内代码等常用语法。',
  '',
  '## 特性',
  '',
  '- 左侧对话, 右侧画布',
  '- Agent 通过 canvas 工具写入内容',
  '- 支持 HTML / Markdown / 纯文本三种类型',
  '- 交互式 HTML 可以运行脚本',
  '',
  '## 支持的语法示例',
  '',
  '| 语法 | 效果 |',
  '| --- | --- |',
  '| `**粗体**` | **粗体** |',
  '| `表格` | 本表格 |',
  '',
  '## 下一步',
  '',
  '> 试试在对话里说: 帮我在画布上写一个项目进度看板',
  '',
  '也可以切到「互动卡片示例」看看 HTML 交互效果。',
].join('\n')

/** Tool arguments accepted by the canvas model tool. */
export interface CanvasToolArgs {
  readonly op: 'write' | 'update' | 'get' | 'list' | 'select' | 'remove' | 'clear' | 'demo'
  readonly id?: string
  readonly title?: string
  readonly kind?: 'html' | 'markdown' | 'text'
  readonly content?: string
  /** Workspace-relative or absolute file whose text becomes the content; exclusive with {@link content}. */
  readonly contentPath?: string
  readonly attachments?: readonly CanvasToolAttachmentInput[]
}

/** A settled mutation result carrying the full snapshot. */
interface SnapshotMutationResult {
  readonly ok: boolean
  readonly message?: string
  readonly artifact: CanvasArtifact | null
  readonly artifacts: readonly CanvasArtifactSummary[]
  readonly selected: string | null
}

/**
 * The canvas host service: per-session artifact store persisted through the
 * storage-domain facility, exposed as a Typert Remote (browser half polls
 * `state`) and driving the model tool.
 */
export class CanvasService extends TypertRemoteService {
  static inject = ['tools', 'storageDomain']

  private table?: KvTable<string, CanvasBucketRow>

  /** @param ctx - host context carrying the tool registry and storage-domain facility. */
  constructor(ctx: Context) {
    super(ctx, 'canvas')
  }

  /** Open the durable bucket table, then register the canvas tool. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(canvasDomainSpec)
    this.ctx.effect(() => async () => {
      await domain.close()
    }, 'canvas.domainClose')
    this.table = domain.table('buckets')
    this.ctx.tools.register(this.canvasTool())
  }

  private bucket(sessionId: string): CanvasBucket {
    return this.table?.get(sessionId) ?? { artifacts: [], selected: null, rev: 0 }
  }

  /** Persist one mutated bucket durably. */
  private async persist(sessionId: string, bucket: CanvasBucket): Promise<void> {
    if (this.table !== undefined) await this.table.put(sessionId, bucket)
  }

  /** Next artifact id: one past the largest existing numeric id (restart-safe). */
  private nextId(bucket: CanvasBucket): string {
    let max = 0
    for (const artifact of bucket.artifacts) {
      const match = /^a(\d+)$/.exec(artifact.id)
      const n = match === null ? 0 : Number(match[1])
      if (Number.isFinite(n) && n > max) max = n
    }
    return `a${max + 1}`
  }

  private find(bucket: CanvasBucket, id: string): CanvasArtifact | undefined {
    return bucket.artifacts.find(artifact => artifact.id === id)
  }

  private static now(): string {
    return new Date().toISOString()
  }

  private snapshot(bucket: CanvasBucket): SnapshotMutationResult['artifacts'] {
    return bucket.artifacts.map(({ content: _content, ...summary }) => summary)
  }

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
  async operate(
    sessionId: string,
    args: CanvasToolArgs,
    attachments?: readonly CanvasArtifactAttachment[],
  ): Promise<SnapshotMutationResult> {
    const b = this.bucket(sessionId)
    const op = args.op

    if (op === 'write' || op === 'update') {
      if (args.id !== undefined) {
        const current = this.find(b, args.id)
        if (current === undefined) return { ok: false, message: `找不到要覆盖的作品: ${args.id}`, artifact: null, artifacts: this.snapshot(b), selected: b.selected }
        const settled = attachments ?? current.attachments
        const updated: CanvasArtifact = {
          id: current.id,
          title: args.title ?? current.title,
          kind: isKind(args.kind) ? args.kind : current.kind,
          content: args.content ?? current.content,
          updatedAt: CanvasService.now(),
          ...settled === undefined ? {} : { attachments: settled },
        }
        const index = b.artifacts.findIndex(artifact => artifact.id === updated.id)
        if (index !== -1) b.artifacts[index] = updated
        b.rev += 1
        b.selected = updated.id
        await this.persist(sessionId, b)
        return this.writeResult(b, updated)
      }
      const artifact: CanvasArtifact = {
        id: this.nextId(b),
        title: args.title || '未命名',
        kind: isKind(args.kind) ? args.kind : 'markdown',
        content: args.content || '',
        updatedAt: CanvasService.now(),
        ...attachments === undefined ? {} : { attachments },
      }
      b.artifacts.push(artifact)
      b.rev += 1
      b.selected = artifact.id
      await this.persist(sessionId, b)
      return this.writeResult(b, artifact)
    }

    if (op === 'get') {
      if (args.id === undefined) return { ok: false, message: 'get 需要 id', artifact: null, artifacts: this.snapshot(b), selected: b.selected }
      const artifact = this.find(b, args.id)
      if (artifact === undefined) return { ok: false, message: `找不到作品: ${args.id}`, artifact: null, artifacts: this.snapshot(b), selected: b.selected }
      return { ok: true, artifact, artifacts: this.snapshot(b), selected: b.selected, message: `「${artifact.title}」[${artifact.kind}] (${artifact.content.length} 字符, id=${artifact.id})\n\n${artifact.content}` }
    }

    if (op === 'list') {
      const rows = b.artifacts.map(artifact => `${artifact.id} · ${artifact.title} [${artifact.kind}] (${artifact.content.length} 字符)`)
      const body = rows.length > 0 ? rows.join('\n') : '(空)'
      return { ok: true, artifact: null, artifacts: this.snapshot(b), selected: b.selected, message: `画布共 ${b.artifacts.length} 个作品:\n${body}` }
    }

    if (op === 'select') {
      const id = args.id || null
      if (id !== null && this.find(b, id) === undefined) return { ok: false, message: `找不到作品: ${id}`, artifact: null, artifacts: this.snapshot(b), selected: b.selected }
      b.selected = id
      b.rev += 1
      await this.persist(sessionId, b)
      return { ok: true, artifact: id !== null ? this.find(b, id) ?? null : null, artifacts: this.snapshot(b), selected: b.selected }
    }

    if (op === 'remove') {
      if (args.id === undefined) return { ok: false, message: 'remove 需要 id', artifact: null, artifacts: this.snapshot(b), selected: b.selected }
      const removed = this.find(b, args.id)
      if (removed === undefined) return { ok: false, message: `找不到作品: ${args.id}`, artifact: null, artifacts: this.snapshot(b), selected: b.selected }
      const index = b.artifacts.findIndex(artifact => artifact.id === removed.id)
      if (index !== -1) b.artifacts.splice(index, 1)
      if (b.selected === removed.id) b.selected = null
      b.rev += 1
      await this.persist(sessionId, b)
      return { ok: true, artifact: null, artifacts: this.snapshot(b), selected: b.selected }
    }

    if (op === 'clear') {
      b.artifacts = []
      b.selected = null
      b.rev += 1
      await this.persist(sessionId, b)
      return { ok: true, artifact: null, artifacts: [], selected: null }
    }

    // The remaining op is 'demo' (every other op returned above).
    if (b.artifacts.length > 0) return { ok: false, message: '画布已有内容, 未覆盖', artifact: null, artifacts: this.snapshot(b), selected: b.selected }
    b.artifacts.push({
      id: this.nextId(b), title: '互动卡片示例', kind: 'html', content: DEMO_HTML, updatedAt: CanvasService.now(),
    })
    b.artifacts.push({
      id: this.nextId(b), title: '项目说明', kind: 'markdown', content: DEMO_MD, updatedAt: CanvasService.now(),
    })
    const first = b.artifacts[0]
    b.selected = first !== undefined ? first.id : null
    b.rev += 1
    await this.persist(sessionId, b)
    return { ok: true, artifact: null, artifacts: this.snapshot(b), selected: b.selected, message: '已填入 2 个示例作品' }
  }

  private writeResult(b: CanvasBucket, artifact: CanvasArtifact): SnapshotMutationResult {
    return { ok: true, artifact, artifacts: this.snapshot(b), selected: b.selected }
  }

  /**
   * Resolve one model-supplied path against the session workspace: relative
   * paths anchor there and the file must exist inside it — canvas file inputs
   * must not widen file access beyond the session's own area.
   * @param input - the raw model-supplied path.
   * @param workspace - the session workspace root.
   * @param label - what the path names, for failure messages.
   * @returns the absolute path and byte size, or a failure message for the tool result.
   */
  private async resolveWorkspaceFile(
    input: string,
    workspace: string,
    label: string,
  ): Promise<{ ok: true; absolute: string; bytes: number } | { ok: false; message: string }> {
    if (input.length === 0) return { ok: false, message: `${label}路径不能为空` }
    const absolute = resolve(workspace, input)
    const within = relative(workspace, absolute)
    if (within.startsWith('..') || within.length === 0) {
      return { ok: false, message: `${label}路径必须位于会话工作区内: ${input}` }
    }
    let info
    try {
      info = await stat(absolute)
    } catch {
      return { ok: false, message: `${label}文件不存在: ${input}` }
    }
    if (!info.isFile()) {
      return { ok: false, message: `${label}不是普通文件: ${input}` }
    }
    return { ok: true, absolute, bytes: info.size }
  }

  /**
   * Resolve model-supplied attachment inputs against the session workspace.
   * @param inputs - raw tool attachment inputs, or undefined when none were sent.
   * @param workspace - the session workspace root; attachments are rejected without one.
   * @returns the resolved records, a failure message for the tool result, or undefined when there is nothing to resolve.
   */
  private async resolveAttachments(
    inputs: readonly CanvasToolAttachmentInput[] | undefined,
    workspace: string | undefined,
  ): Promise<{ ok: true; value: readonly CanvasArtifactAttachment[] } | { ok: false; message: string } | undefined> {
    if (inputs === undefined || inputs.length === 0) return undefined
    if (workspace === undefined) {
      return { ok: false, message: '附件需要会话工作区上下文; 请在会话内重试' }
    }
    const resolved: CanvasArtifactAttachment[] = []
    for (const input of inputs) {
      if (input.name.length === 0 || input.path.length === 0) {
        return { ok: false, message: '附件的 name 与 path 均不能为空' }
      }
      const file = await this.resolveWorkspaceFile(input.path, workspace, '附件')
      if (!file.ok) return file
      resolved.push({ name: input.name, path: file.absolute, mediaType: mediaTypeFor(file.absolute), bytes: file.bytes })
    }
    return { ok: true, value: resolved }
  }

  /**
   * Downloads channel: open one attached file for streaming.
   * @param sessionId - the session whose bucket holds the artifact.
   * @param artifactId - the artifact carrying the attachment.
   * @param name - the attachment download filename.
   * @returns the file stream with response metadata, or undefined when the session, artifact, attachment, or file is unknown.
   */
  async attachmentStream(
    sessionId: string,
    artifactId: string,
    name: string,
  ): Promise<CanvasAttachmentStream | undefined> {
    const artifact = this.find(this.bucket(sessionId), artifactId)
    const attachment = artifact?.attachments?.find(entry => entry.name === name)
    if (artifact === undefined || attachment === undefined) return undefined
    try {
      const info = await stat(attachment.path)
      if (!info.isFile()) return undefined
    } catch {
      return undefined
    }
    return {
      stream: Readable.toWeb(createReadStream(attachment.path)) as ReadableStream<Uint8Array>,
      mediaType: attachment.mediaType,
      bytes: attachment.bytes,
    }
  }

  /**
   * Open one artifact's body as a byte stream for download: the persisted
   * content with the kind-derived media type and filename extension.
   * @param sessionId - the session whose bucket holds the artifact.
   * @param artifactId - the artifact whose body is downloaded.
   * @returns the body stream with media type, byte length, and download
   * filename (title plus kind extension), or undefined when the session or
   * artifact is unknown.
   */
  async artifactBodyStream(
    sessionId: string,
    artifactId: string,
  ): Promise<CanvasBodyStream | undefined> {
    const artifact = this.find(this.bucket(sessionId), artifactId)
    if (artifact === undefined) return undefined
    const descriptor = ARTIFACT_BODY_KINDS[artifact.kind]
    const bytes = Buffer.byteLength(artifact.content, 'utf8')
    return {
      stream: new Blob([artifact.content]).stream() as ReadableStream<Uint8Array>,
      mediaType: descriptor.mediaType,
      bytes,
      filename: `${artifact.title}${descriptor.extension}`,
    }
  }

  private canvasTool(): ToolDefinition {
    return {
      name: 'canvas',
      description: '管理右侧画布(Canvas)中的内容作品: 创建/更新 HTML、Markdown 或纯文本内容, 在对话进行的同时把内容实时展示在右侧画布上。适合生成交互式网页预览、文档、图表说明、代码片段等。op: write 创建或替换作品(传 id 则覆盖), update 局部更新已有作品, get 取回某个作品的完整内容, list 列出所有作品, select 选中作品(id 传空串则取消选中), remove 删除作品, clear 清空画布。write/update 可带 attachments 指定下载附件(如本地生成的 PDF), 画布会为每个附件提供下载按钮。手写 HTML 长报告时优先从交付技能的主题骨架起笔（或经 markdown 转换），保持与 PDF 交付物同一样式来源。每次 write/update 后画布会自动选中并展示该作品。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          op: { type: 'string', enum: ['write', 'update', 'get', 'list', 'select', 'remove', 'clear', 'demo'], description: '要执行的操作' },
          id: { type: 'string', description: '作品 id (update/get/select/remove 需要; write 传 id 时覆盖该作品)' },
          title: { type: 'string', description: '作品标题' },
          kind: { type: 'string', enum: ['html', 'markdown', 'text'], description: '作品类型, 默认 markdown' },
          content: { type: 'string', description: '作品内容' },
          contentPath: { type: 'string', description: '内容文件路径(相对路径按会话工作区解析), 工具读取该文件作为作品内容; 与 content 二选一, 适合长文/HTML 报告' },
          attachments: {
            type: 'array',
            description: '随作品交付的下载附件(如本地生成的 PDF 文件)。路径必须位于会话工作区内; 画布为每个附件提供下载按钮',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', description: '下载文件名, 如 2026-08设备运维月报.pdf' },
                path: { type: 'string', description: '文件路径, 相对路径按会话工作区解析' },
              },
              required: ['name', 'path'],
            },
          },
        },
        required: ['op'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
      },
      execute: async (args: CanvasToolArgs, exec: ToolRunContext) => {
        const sessionId = exec.agent !== undefined ? exec.agent.id : 'default'
        const workspace = exec.agent?.session.header.cwd
        let content = args.content
        if (args.contentPath !== undefined) {
          if (args.content !== undefined) return 'content 与 contentPath 只能二选一'
          if (workspace === undefined) return 'contentPath 需要会话工作区上下文; 请在会话内重试'
          const file = await this.resolveWorkspaceFile(args.contentPath, workspace, '内容文件')
          if (!file.ok) return file.message
          if (file.bytes > MAX_CONTENT_PATH_BYTES) {
            return `内容文件超过 ${MAX_CONTENT_PATH_BYTES} 字节上限: ${args.contentPath}`
          }
          try {
            content = await readFile(file.absolute, 'utf8')
          } catch {
            return `内容文件读取失败: ${args.contentPath}`
          }
        }
        const resolved = await this.resolveAttachments(args.attachments, workspace)
        if (resolved !== undefined && !resolved.ok) return resolved.message
        const out = await this.operate(
          sessionId,
          { ...args, ...content === undefined ? {} : { content } },
          resolved?.ok === true ? resolved.value : undefined,
        )
        const attachmentNote = out.artifact?.attachments !== undefined
          ? `, 附 ${out.artifact.attachments.length} 个下载附件`
          : ''
        const message = out.message !== undefined
          ? out.message
          : (out.artifact !== null
            ? `画布已更新: 「${out.artifact.title}」[${out.artifact.kind}] (${out.artifact.content.length} 字符, id=${out.artifact.id})${attachmentNote}, 已展示在右侧画布。`
            : '画布操作完成。')
        return message
      },
    }
  }

  /**
   * Browser half: per-session state (artifact summaries without content,
   * selection, revision) — light enough to poll every second.
   * @param request - session identity whose bucket to read.
   * @returns the artifact summaries, selection, and revision counter.
   */
  @Remote('state')
  state(request: CanvasStateRequest): CanvasState {
    const b = this.bucket(request.sessionId)
    return { artifacts: this.snapshot(b), selected: b.selected, rev: b.rev }
  }

  /**
   * Browser half: one artifact's full record including content, fetched when
   * the polled revision or selection changes.
   * @param request - session identity and the artifact id to read.
   * @returns the artifact, or a null artifact when the id is unknown.
   */
  @Remote('get')
  get(request: CanvasGetRequest): CanvasGetResult {
    const artifact = this.find(this.bucket(request.sessionId), request.id)
    if (artifact === undefined) {
      return { ok: false, artifact: null, message: '作品不存在' }
    }
    return { ok: true, artifact, message: '' }
  }

  /**
   * Browser half: select or deselect one artifact.
   * @param request - session identity and the artifact id to select (null deselects).
   * @returns whether the selection changed and the new selected id.
   */
  @Remote('select')
  async select(request: CanvasSelectRequest): Promise<CanvasSelectResult> {
    const out = await this.operate(request.sessionId, request.id !== null
      ? { op: 'select', id: request.id }
      : { op: 'select' })
    return { ok: out.ok, selected: out.selected, message: out.message ?? '' }
  }

  /**
   * Browser half: seed an empty canvas with demo artifacts.
   * @param request - session identity whose empty bucket receives the demo seed.
   * @returns whether the seed succeeded and its message.
   */
  @Remote('demo')
  async demo(request: CanvasDemoRequest): Promise<CanvasDemoResult> {
    const out = await this.operate(request.sessionId, { op: 'demo' })
    return { ok: out.ok, message: out.message ?? '' }
  }
}

export default CanvasService
