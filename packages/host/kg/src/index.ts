/**
 * Knowledge-graph host plugin: the `kg_graph` tool pulls every RAGFlow
 * dataset graph and assembles one hub artifact (hub → library → entities)
 * onto the canvas. Credentials resolve per call; a failed library never
 * sinks the whole view.
 * @module @deepseek-ai/dsh-host-kg
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ToolRunContext, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type CanvasService from '@deepseek-ai/dsh-host-canvas'
import type { KgConfig, KgLibraryGraph } from './types.ts'
import { assembleHub, type LibraryOutcome } from './normalize.ts'
import { rfFetchGraph, rfListDatasets } from './fetch.ts'
import { readForceGraphAsset, renderKgHtml } from './render.ts'

export type * from './types.ts'
export { assembleHub, normalizeLibraryGraph, capByDegree } from './normalize.ts'
export { renderKgHtml, readForceGraphAsset, TYPE_PALETTE } from './render.ts'
export { rfListDatasets, rfFetchGraph, RfListError, RfGraphError } from './fetch.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    kg: KgService
  }
}

/** Per-request timeout for RAGFlow calls; graphs can be large but not unbounded. */
const REQUEST_TIMEOUT_MS = 30_000

/** The kg host service: owns the config and registers the kg_graph tool. */
export class KgService extends Service {
  static inject = ['tools', 'canvas', 'credentials']

  static Config = z.object({
    apiUrlEnv: z.string().default('RAGFLOW_API_URL'),
    apiKeyEnv: z.string().default('RAGFLOW_API_KEY'),
    hubLabel: z.string().default('知识图谱'),
    libraries: z.array(z.string()).default([]),
    maxNodesPerLibrary: z.number().default(0),
    titlePrefix: z.string().default('DSH'),
  }) as z<KgConfig>

  readonly config: KgConfig

  /** @param ctx - host context carrying the tool registry, canvas service, and credentials. */
  constructor(ctx: Context, config: KgConfig) {
    super(ctx, 'kg')
    this.config = config
  }

  /** No session events: the artifact is the durable output and the tool's
   * result text carries the summary, so nothing extra reaches the log. */
  protected [Service.init](): void {
    this.ctx.tools.register(this.kgTool())
  }

  /** Resolve the configured credential references fresh for each call. */
  private async resolveEndpoints(): Promise<{ error: string } | { baseUrl: string; apiKey: string }> {
    const config = this.config
    const url = await this.ctx.credentials.resolve(credentialRef(config.apiUrlEnv))
    const key = await this.ctx.credentials.resolve(credentialRef(config.apiKeyEnv))
    if (url === undefined) {
      return { error: `知识图谱拉取失败: 未配置 ${config.apiUrlEnv}(RAGFlow 服务地址,如 http://127.0.0.1:9380)。请写入 .env 或 ${config.apiUrlEnv} 环境变量。` }
    }
    if (key === undefined) {
      return { error: `知识图谱拉取失败: 未配置 ${config.apiKeyEnv}(RAGFlow API Key)。请在 RAGFlow 生成 API Key 后写入 .env 或环境变量。` }
    }
    return { baseUrl: url.value.replace(/\/+$/, ''), apiKey: key.value }
  }

  private kgTool(): ToolDefinition {
    const config = this.config
    return {
      name: 'kg_graph',
      description: [
        '拉取 RAGFlow 全部知识库的知识图谱,合成一张「中心 → 知识库 → 库内实体关系」的汇聚大图,并展示在右侧画布。',
        '当用户要求「打开/看看知识图谱」「展示图谱关系」「全局知识大图」时调用。',
        '可选参数 library 只看单个知识库;不带参数输出全部知识库的完整汇聚图。',
        '每次调用都实时拉取当前图谱并在画布原地刷新同一作品——知识库更新(如投喂新文档并重建图谱)后,再调用一次即可看到最新图谱。',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          library: { type: 'string', description: '只展示这一个知识库(名称或 id);省略则展示全部' },
        },
        required: [],
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
      },
      execute: async (args: unknown, exec: ToolRunContext): Promise<string> => {
        const libraryArg = (args as { library?: unknown } | undefined)?.library
        const only = typeof libraryArg === 'string' && libraryArg.length > 0 ? libraryArg : undefined
        const endpoints = await this.resolveEndpoints()
        if ('error' in endpoints) return endpoints.error
        const { baseUrl, apiKey } = endpoints

        let rows
        try {
          rows = await rfListDatasets(baseUrl, apiKey, REQUEST_TIMEOUT_MS)
        } catch (e) {
          return `知识图谱拉取失败: 无法列出知识库 (${e instanceof Error ? e.message : String(e)})。请检查 ${config.apiUrlEnv} 指向的 RAGFlow 服务与 API Key。`
        }
        if (rows.length === 0) return '知识图谱为空: RAGFlow 中没有任何知识库,请先创建并解析文档。'

        const selected = only === undefined
          ? rows
          : rows.filter(row => row.name === only || row.id === only)
        if (selected.length === 0) {
          const names = rows.map(row => row.name).join('、')
          return `知识图谱拉取失败: 找不到知识库「${only}」。现有知识库: ${names}。`
        }

        const outcomes: LibraryOutcome[] = await Promise.all(selected.map(async (row) => {
          try {
            const graph: KgLibraryGraph = await rfFetchGraph(baseUrl, apiKey, row.id, REQUEST_TIMEOUT_MS)
            return { row, graph }
          } catch (e) {
            return { row, error: e instanceof Error ? e.message : String(e) }
          }
        }))

        const effectiveConfig: KgConfig = only === undefined ? config : { ...config, libraries: [selected[0]?.id ?? ''] }
        const hubLabel = only ?? config.hubLabel
        const assembly = assembleHub(hubLabel, outcomes, effectiveConfig, new Date().toISOString())

        if (assembly.okLibraries === 0 && assembly.failedLibraries === 0) {
          const allEmpty = assembly.data?.libraries.every(lib => lib.empty) ?? false
          return allEmpty
            ? '知识图谱为空: 所选知识库均未构建图谱。请先在 RAGFlow 侧触发图谱构建(如 ragflow-run-graphrag.sh)后重试。'
            : '知识图谱为空: 配置的白名单没有匹配到任何知识库。'
        }
        if (assembly.data === undefined) return '知识图谱组装失败: 未知错误。'
        if (assembly.okLibraries === 0 && assembly.failedLibraries > 0) {
          const reasons = assembly.data.libraries.map(lib => `${lib.name}: ${lib.error ?? ''}`).join('; ')
          return `知识图谱拉取失败: 全部 ${assembly.failedLibraries} 个知识库均失败 (${reasons})。请检查 RAGFlow 服务状态与图谱构建情况。`
        }

        const title = `${config.titlePrefix} · ${only ?? '全库'}知识图谱`
        const html = renderKgHtml(assembly.data, title, await readForceGraphAsset())
        const sessionId = exec.agent !== undefined ? exec.agent.id : 'default'
        const canvas = this.ctx.get('canvas') as CanvasService
        // Refresh in place: overwriting the same-titled artifact lets the
        // canvas panel re-render live (it polls rev) instead of piling up
        // one artifact per call — knowledge updates land as a graph update.
        const prior = canvas.state({ sessionId }).artifacts.find(artifact => artifact.title === title)
        const out = await canvas.operate(sessionId, {
          op: 'write',
          title,
          kind: 'html',
          content: html,
          ...prior === undefined ? {} : { id: prior.id },
        })
        if (!out.ok) return `画布写入失败: ${out.message ?? '未知原因'}`
        const refreshed = prior !== undefined ? '(已原地刷新,反映最新知识库状态)' : ''
        const skipped = assembly.failedLibraries === 0 ? '' : `,${assembly.failedLibraries} 库拉取失败(图中标红)`
        return `已在画布展示「${title}」: ${assembly.data.libraries.length} 个知识库,${assembly.totalNodes} 实体,${assembly.totalEdges} 关系${skipped}。作品 id=${out.artifact?.id ?? '未知'}${refreshed}。`
      },
    }
  }
}

export default KgService
