import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import CanvasService from '../src/index.ts'

const contexts: Context[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function harness(root?: string): Promise<{ ctx: Context; canvas: CanvasService; root: string }> {
  const dir = root ?? await mkdtemp(join(tmpdir(), 'dsh-canvas-test-'))
  if (root === undefined) tempDirs.push(dir)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools, {})
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: dir })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(CanvasService)
  const canvas = ctx.get('canvas') as CanvasService
  return { ctx, canvas, root: dir }
}

describe('CanvasService Remote surface', () => {
  it('declares the state, select, demo, and get Remote methods', async () => {
    const { canvas } = await harness()
    expect(remoteMethods(canvas)).toEqual([
      { method: 'state', invocation: { kind: 'direct' } },
      { method: 'get', invocation: { kind: 'direct' } },
      { method: 'select', invocation: { kind: 'direct' } },
      { method: 'demo', invocation: { kind: 'direct' } },
    ])
  })

  it('state starts empty per session', async () => {
    const { canvas } = await harness()
    const empty = canvas.state({ sessionId: 's1' })
    expect(empty.artifacts).toEqual([])
    expect(empty.selected).toBeNull()
  })

  it('select persists the session selection', async () => {
    const { canvas } = await harness()
    const res = await canvas.select({ sessionId: 's1', id: null })
    expect(res).toEqual({ ok: true, selected: null, message: '' })
  })
})

describe('CanvasService durability', () => {
  it('persists demo artifacts across a process restart', async () => {
    const first = await harness()
    const seeded = await first.canvas.demo({ sessionId: 's1' })
    expect(seeded).toEqual({ ok: true, message: '已填入 2 个示例作品' })
    const before = first.canvas.state({ sessionId: 's1' })
    expect(before.artifacts).toHaveLength(2)
    expect(before.artifacts.map(a => a.id)).toEqual(['a1', 'a2'])
    await first.ctx.fiber.dispose()

    const second = await harness(first.root)
    const after = second.canvas.state({ sessionId: 's1' })
    expect(after.artifacts).toHaveLength(2)
    expect(after.artifacts.map(a => a.id)).toEqual(['a1', 'a2'])
    expect(after.selected).toBe('a1')

    // A second demo on a non-empty canvas is rejected (no overwrite).
    const again = await second.canvas.demo({ sessionId: 's1' })
    expect(again.ok).toBe(false)
  })

  it('keeps sessions isolated in their own buckets', async () => {
    const { canvas } = await harness()
    await canvas.demo({ sessionId: 's1' })
    const other = canvas.state({ sessionId: 's2' })
    expect(other.artifacts).toEqual([])
  })
})

describe('CanvasService tool', () => {
  it('registers the canvas tool on the tools registry', async () => {
    const { ctx } = await harness()
    const schemas = ctx.tools.schemas()
    expect(schemas.some(schema => schema.name === 'canvas')).toBe(true)
  })
})

describe('canvas tool attachments', () => {
  /** Minimal tool-run context: the tool reads the session id and workspace cwd off the agent. */
  function execFor(workspace: string | undefined): ToolRunContext {
    return {
      callId: 'c1' as never,
      rootCallId: 'c1' as never,
      name: 'canvas',
      arguments: {},
      token: 't1' as never,
      signal: new AbortController().signal,
      deferContext: () => {},
      concludeTurn: () => {},
      ...workspace === undefined ? {} : { agent: { id: 's1', session: { header: { cwd: workspace } } } as never },
    }
  }

  async function workspaceWithFile(name: string, body: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-canvas-ws-'))
    tempDirs.push(dir)
    await writeFile(join(dir, name), body, 'utf8')
    return dir
  }

  it('write records attachments resolved against the session workspace and streams them back', async () => {
    const { ctx, canvas } = await harness()
    const ws = await workspaceWithFile('月报.pdf', '%PDF-1.4 fake bytes')
    const tool = ctx.tools.get('canvas')
    const message = await tool?.execute({
      op: 'write',
      title: '报告',
      kind: 'markdown',
      content: '# 概况',
      attachments: [{ name: '月报.pdf', path: '月报.pdf' }],
    }, execFor(ws))
    expect(message).toContain('1 个下载附件')
    const state = canvas.state({ sessionId: 's1' })
    const artifact = state.artifacts[0]
    expect(artifact?.attachments).toEqual([
      { name: '月报.pdf', path: join(ws, '月报.pdf'), mediaType: 'application/pdf', bytes: '%PDF-1.4 fake bytes'.length },
    ])
    const opened = await canvas.attachmentStream('s1', artifact?.id ?? 'none', '月报.pdf')
    expect(opened).toBeDefined()
    expect(opened?.mediaType).toBe('application/pdf')
    const bytes = await new Response(opened!.stream).arrayBuffer()
    expect(bytes.byteLength).toBe('%PDF-1.4 fake bytes'.length)
  })

  it('infers the attachment media type from the recorded file path, not the download name', async () => {
    const { ctx, canvas } = await harness()
    const ws = await workspaceWithFile('rw-report.pdf', '%PDF-1.4 fake bytes')
    const tool = ctx.tools.get('canvas')
    await tool?.execute({
      op: 'write',
      content: 'x',
      attachments: [{ name: '2026年8月设备运维月报', path: 'rw-report.pdf' }],
    }, execFor(ws))
    const artifact = canvas.state({ sessionId: 's1' }).artifacts[0]
    expect(artifact?.attachments?.[0]?.mediaType).toBe('application/pdf')
    const opened = await canvas.attachmentStream('s1', artifact?.id ?? 'none', '2026年8月设备运维月报')
    expect(opened?.mediaType).toBe('application/pdf')
  })

  it('rejects attachments resolving outside the session workspace', async () => {
    const { ctx, canvas } = await harness()
    const ws = await workspaceWithFile('inside.txt', 'x')
    const tool = ctx.tools.get('canvas')
    const message = await tool?.execute({
      op: 'write',
      content: 'x',
      attachments: [{ name: 'secret.pdf', path: '../../etc/hostname' }],
    }, execFor(ws))
    expect(message).toContain('会话工作区内')
    expect(canvas.state({ sessionId: 's1' }).artifacts).toEqual([])
  })

  it('rejects missing attachment files and records no artifact', async () => {
    const { ctx, canvas } = await harness()
    const ws = await workspaceWithFile('inside.txt', 'x')
    const tool = ctx.tools.get('canvas')
    const message = await tool?.execute({
      op: 'write',
      content: 'x',
      attachments: [{ name: 'gone.pdf', path: 'gone.pdf' }],
    }, execFor(ws))
    expect(message).toContain('附件文件不存在')
    expect(canvas.state({ sessionId: 's1' }).artifacts).toEqual([])
  })

  it('rejects attachments when no session workspace is in scope', async () => {
    const { ctx } = await harness()
    const tool = ctx.tools.get('canvas')
    const message = await tool?.execute({
      op: 'write',
      content: 'x',
      attachments: [{ name: 'a.pdf', path: 'a.pdf' }],
    }, execFor(undefined))
    expect(message).toContain('会话工作区上下文')
  })

  it('update keeps prior attachments when none are sent', async () => {
    const { ctx, canvas } = await harness()
    const ws = await workspaceWithFile('月报.pdf', 'pdf')
    const tool = ctx.tools.get('canvas')
    await tool?.execute({
      op: 'write',
      content: 'v1',
      attachments: [{ name: '月报.pdf', path: '月报.pdf' }],
    }, execFor(ws))
    await tool?.execute({ op: 'update', id: 'a1', content: 'v2' }, execFor(ws))
    const summary = canvas.state({ sessionId: 's1' }).artifacts[0]
    expect('content' in (summary ?? {})).toBe(false)
    const artifact = canvas.get({ sessionId: 's1', id: 'a1' }).artifact
    expect(artifact?.content).toBe('v2')
    expect(artifact?.attachments?.map(a => a.name)).toEqual(['月报.pdf'])
    expect(summary?.attachments?.map(a => a.name)).toEqual(['月报.pdf'])
  })

  it('write reads long-form content from a workspace file via contentPath', async () => {
    const { ctx, canvas } = await harness()
    const ws = await workspaceWithFile('report.html', '<h1>报告</h1>')
    const tool = ctx.tools.get('canvas')
    const message = await tool?.execute({
      op: 'write',
      title: '报告',
      kind: 'html',
      contentPath: 'report.html',
    }, execFor(ws))
    expect(message).toContain('id=a1')
    expect('content' in (canvas.state({ sessionId: 's1' }).artifacts[0] ?? {})).toBe(false)
    const artifact = canvas.get({ sessionId: 's1', id: 'a1' }).artifact
    expect(artifact?.content).toBe('<h1>报告</h1>')
    expect(artifact?.kind).toBe('html')
    expect(canvas.get({ sessionId: 's1', id: 'a9' })).toEqual({ ok: false, artifact: null, message: '作品不存在' })
  })

  it('rejects contentPath paired with content and paths outside the workspace', async () => {
    const { ctx, canvas } = await harness()
    const ws = await workspaceWithFile('report.html', '<h1>报告</h1>')
    const tool = ctx.tools.get('canvas')
    const both = await tool?.execute({
      op: 'write',
      content: 'x',
      contentPath: 'report.html',
    }, execFor(ws))
    expect(both).toContain('二选一')
    const outside = await tool?.execute({
      op: 'write',
      contentPath: '../elsewhere.html',
    }, execFor(ws))
    expect(outside).toContain('会话工作区内')
    expect(canvas.state({ sessionId: 's1' }).artifacts).toEqual([])
  })

  it('attachmentStream answers undefined for unknown session, artifact, or name', async () => {
    const { canvas } = await harness()
    expect(await canvas.attachmentStream('s-none', 'a1', 'x.pdf')).toBeUndefined()
  })
})
