import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import CanvasService from '@deepseek-ai/dsh-host-canvas'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import KgService from '../src/index.ts'
import { assembleHub, capByDegree, normalizeLibraryGraph, type LibraryOutcome } from '../src/normalize.ts'
import { renderKgHtml } from '../src/render.ts'
import type { KgConfig, KgGraphData } from '../src/types.ts'

const contexts: Context[] = []
const tempDirs: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() =>{  resolve() }))))
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** In-memory credentials provider: enough of the seam for resolve() callers. */
class FakeCredentials extends Service {
  constructor(ctx: Context, private readonly values: Record<string, string>) {
    super(ctx, 'credentials')
  }

  async resolve(ref: CredentialRef): Promise<{ value: string; source: string } | undefined> {
    const value = this.values[String(ref)]
    return value === undefined ? undefined : { value, source: 'test-env' }
  }

  async describe(ref: CredentialRef): Promise<{ configured: boolean; writable: boolean }> {
    return { configured: this.values[String(ref)] !== undefined, writable: false }
  }

  async set(): Promise<void> {}
  async unset(): Promise<void> {}
}

interface MockLibrary {
  readonly id: string
  readonly name: string
  /** HTTP status for the graph call; absent means the graph below. */
  readonly failStatus?: number
  readonly graph?: { nodes: unknown[]; edges: unknown[] }
}

/** Minimal RAGFlow double: the two REST endpoints kg_graph talks to. */
function startRagflowMock(libraries: readonly MockLibrary[]): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    const url = req.url ?? ''
    if (url.startsWith('/api/v1/datasets/page') || url.split('?')[0] === '/api/v1/datasets') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ code: 0, data: libraries.map(({ id, name }) => ({ id, name, document_count: 3 })) }))
      return
    }
    const graphMatch = /^\/api\/v1\/datasets\/([^/]+)\/graph$/.exec(url.split('?')[0] ?? '')
    if (graphMatch !== null) {
      const library = libraries.find(candidate => candidate.id === decodeURIComponent(graphMatch[1] ?? ''))
      res.setHeader('content-type', 'application/json')
      if (library === undefined || library.failStatus !== undefined) {
        res.statusCode = library?.failStatus ?? 404
        res.end(JSON.stringify({ code: 1, message: 'boom' }))
        return
      }
      res.end(JSON.stringify({ code: 0, data: { graph: library.graph ?? { nodes: [], edges: [] } } }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ code: 404, message: 'Not Found' }))
  })
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ server, baseUrl: `http://127.0.0.1:${String(port)}` })
    })
  })
}

const CONFIG: KgConfig = {
  apiUrlEnv: 'RAGFLOW_API_URL',
  apiKeyEnv: 'RAGFLOW_API_KEY',
  hubLabel: '知识图谱',
  libraries: [],
  maxNodesPerLibrary: 0,
  titlePrefix: 'DSH',
}

/** Wire every plugin kg_graph depends on, with the given credential values. */
async function harness(values: Record<string, string>): Promise<{ ctx: Context; kg: KgService }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-kg-test-'))
  tempDirs.push(dir)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools, {})
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: dir })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(FakeCredentials, values)
  await ctx.plugin(CanvasService)
  await ctx.plugin(KgService, {})
  return { ctx, kg: ctx.get('kg') as KgService }
}

function execFor(): ToolRunContext {
  return {
    callId: 'c1' as never,
    rootCallId: 'c1' as never,
    name: 'kg_graph',
    arguments: {},
    token: 't1' as never,
    signal: new AbortController().signal,
    deferContext: () => {},
    concludeTurn: () => {},
    agent: { id: 's1', session: { header: { cwd: '/tmp' } } } as never,
  }
}

async function runTool(
  values: Record<string, string>,
  args: { library?: string } = {},
): Promise<{ message: string; ctx: Context; kg: KgService }> {
  const { ctx, kg } = await harness(values)
  const tool = ctx.tools.get('kg_graph')
  const message = await tool?.execute(args, execFor()) as string
  return { message, ctx, kg }
}

const GOOD_GRAPH = {
  nodes: [
    { entity_name: '避雷器', entity_type: 'CONCEPT', description: '限制过电压的器件', id: '避雷器' },
    { entity_name: '避雷器', entity_type: 'CONCEPT', id: '避雷器' },
    { name: '红外测温', entity_type: 'EVENT' },
    { name: '10kV开关柜', entity_type: 'PRODUCT' },
    { name: '幽灵实体', entity_type: 'CONCEPT' },
  ],
  edges: [
    { src: '避雷器', dst: '红外测温', relationship: '定期检测' },
    { source: '10kV开关柜', target: '避雷器', description: '内含' },
    { source: '避雷器', target: '不存在的实体' },
  ],
}

describe('normalizeLibraryGraph', () => {
  it('maps loose RAGFlow fields, merges name+type duplicates, and drops dangling edges', () => {
    const out = normalizeLibraryGraph(GOOD_GRAPH)
    const names = out.nodes.map(node => node.name)
    expect(names.filter(name => name === '避雷器')).toHaveLength(1)
    expect(names).toContain('红外测温')
    const arrester = out.nodes.find(node => node.name === '避雷器')
    expect(arrester?.type).toBe('CONCEPT')
    expect(arrester?.description).toBe('限制过电压的器件')
    expect(out.edges).toHaveLength(2)
    const bothEndsKnown = out.edges.every((edge) => {
      const sourceKnown = out.nodes.some(node => node.name === edge.source)
      const targetKnown = out.nodes.some(node => node.name === edge.target)
      return sourceKnown && targetKnown
    })
    expect(bothEndsKnown).toBe(true)
  })

  it('capByDegree keeps the most-connected entities and their edges only', () => {
    const nodes = [{ name: 'a', type: 'CONCEPT' }, { name: 'b', type: 'CONCEPT' }, { name: 'c', type: 'CONCEPT' }]
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'c' },
    ]
    const capped = capByDegree(nodes, edges, 2)
    expect(capped.nodes.map(node => node.name).sort()).toEqual(['a', 'b'])
    expect(capped.edges).toHaveLength(1)
  })
})

describe('assembleHub', () => {
  const outcomes: LibraryOutcome[] = [
    { row: { id: 'lib-ok', name: '设备运维' }, graph: GOOD_GRAPH },
    { row: { id: 'lib-fail', name: '故障库' }, error: 'HTTP 500' },
    { row: { id: 'lib-empty', name: '空库' }, graph: { nodes: [], edges: [] } },
    { row: { id: 'lib-off', name: '白名单外' }, graph: GOOD_GRAPH },
  ]

  it('assembles with failures marked, empties flagged, and whitelist applied', () => {
    const config = { ...CONFIG, libraries: ['设备运维', '故障库', '空库'] }
    const result = assembleHub('知识图谱', outcomes, config, '2026-09-06T00:00:00Z')
    expect(result.okLibraries).toBe(1)
    expect(result.failedLibraries).toBe(1)
    expect(result.data?.libraries).toHaveLength(3)
    const failed = result.data?.libraries.find(lib => lib.id === 'lib-fail')
    expect(failed?.error).toBe('HTTP 500')
    expect(result.data?.libraries.find(lib => lib.id === 'lib-empty')?.empty).toBe(true)
    expect(result.data?.libraries.some(lib => lib.id === 'lib-off')).toBe(false)
    expect(result.totalNodes).toBe(4) // 5 raw nodes, duplicate 避雷器 merged; the isolated 幽灵实体 stays
  })
})

describe('renderKgHtml', () => {
  const data: KgGraphData = {
    hub: '知识图谱',
    generatedAt: '2026-09-06T00:00:00Z',
    libraries: [{ id: 'lib-ok', name: '设备运维', nodes: [{ name: '避雷器<script>', type: 'CONCEPT' }], edges: [], empty: false }],
  }

  it('embeds the data island, the vendored engine, and neutralizes script-tag injection', async () => {
    const { readForceGraphAsset } = await import('../src/render.ts')
    const html = renderKgHtml(data, 'DSH · 全库知识图谱', await readForceGraphAsset())
    expect(html).toContain('window.__KG__')
    expect(html).toContain('避雷器\\u003cscript\\u003e')
    expect(html).not.toContain('避雷器<script>')
    expect(html).toContain('force-graph')
    expect(html).toContain('<title>DSH · 全库知识图谱</title>')
    expect(html).toContain('kg-graph')
  })
})

describe('kg_graph tool', () => {
  it('fails loud with setup guidance when credentials are absent', async () => {
    const { message } = await runTool({})
    expect(message).toContain('RAGFLOW_API_URL')
  })

  it('fails loud when only the key is absent', async () => {
    const { message } = await runTool({ RAGFLOW_API_URL: 'http://127.0.0.1:1' })
    expect(message).toContain('RAGFLOW_API_KEY')
  })

  it('reports a list failure without writing the canvas', async () => {
    const { message, ctx } = await runTool({ RAGFLOW_API_URL: 'http://127.0.0.1:1', RAGFLOW_API_KEY: 'k' })
    expect(message).toContain('无法列出知识库')
    const canvas = ctx.get('canvas') as CanvasService
    expect(canvas.state({ sessionId: 's1' }).artifacts).toEqual([])
  })

  it('assembles mixed outcomes into one canvas artifact and summarizes', async () => {
    const { baseUrl } = await startRagflowMock([
      { id: 'lib-ok', name: '设备运维', graph: GOOD_GRAPH },
      { id: 'lib-fail', name: '故障库', failStatus: 500 },
      { id: 'lib-empty', name: '空库' },
    ])
    const { message, ctx } = await runTool({ RAGFLOW_API_URL: baseUrl, RAGFLOW_API_KEY: 'k' })
    expect(message).toContain('已在画布展示')
    expect(message).toContain('拉取失败')
    const canvas = ctx.get('canvas') as CanvasService
    const state = canvas.state({ sessionId: 's1' })
    expect(state.artifacts).toHaveLength(1)
    const artifact = state.artifacts[0]
    expect(artifact?.kind).toBe('html')
    expect(artifact?.content).toContain('window.__KG__')
    expect(artifact?.content).toContain('"name":"故障库"')
    const emptyLib = /"id":"lib-empty","name":"空库"[\s\S]*?"empty":true/.exec(artifact?.content ?? '')
    expect(emptyLib).not.toBeNull()
  })

  it('scopes to one library when asked and fails loud on unknown names', async () => {
    const { baseUrl } = await startRagflowMock([
      { id: 'lib-a', name: '设备运维', graph: GOOD_GRAPH },
      { id: 'lib-b', name: '故障库', graph: GOOD_GRAPH },
    ])
    const { message, ctx } = await runTool({ RAGFLOW_API_URL: baseUrl, RAGFLOW_API_KEY: 'k' }, { library: '设备运维' })
    expect(message).toContain('设备运维')
    const canvas = ctx.get('canvas') as CanvasService
    const content = canvas.state({ sessionId: 's1' }).artifacts[0]?.content ?? ''
    expect(content).toContain('设备运维')
    expect(content).not.toContain('"name":"故障库"')

    const miss = await runTool({ RAGFLOW_API_URL: baseUrl, RAGFLOW_API_KEY: 'k' }, { library: '不存在' })
    expect(miss.message).toContain('找不到知识库')
  })

  it('reports empty assembly when no library has a graph yet', async () => {
    const { baseUrl } = await startRagflowMock([{ id: 'lib-empty', name: '空库' }])
    const { message } = await runTool({ RAGFLOW_API_URL: baseUrl, RAGFLOW_API_KEY: 'k' })
    expect(message).toContain('未构建图谱')
  })

  it('refreshes the same-titled artifact in place instead of piling up', async () => {
    const graph = { nodes: [{ name: '旧实体', entity_type: 'CONCEPT' }], edges: [] }
    const { baseUrl, server } = await startRagflowMock([{ id: 'lib-a', name: '设备运维', graph }])
    const { ctx } = await runTool({ RAGFLOW_API_URL: baseUrl, RAGFLOW_API_KEY: 'k' })

    // Feed a second entity through the same mock before the second call.
    graph.nodes.push({ name: '新实体', entity_type: 'HAZARD' })
    void server
    const tool = ctx.tools.get('kg_graph')
    const second = await tool?.execute({}, execFor()) as string
    expect(second).toContain('原地刷新')

    const canvas = ctx.get('canvas') as CanvasService
    const state = canvas.state({ sessionId: 's1' })
    expect(state.artifacts).toHaveLength(1)
    expect(state.artifacts[0]?.content).toContain('新实体')
  })
})
