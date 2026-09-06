/**
 * RAGFlow REST client for the kg_graph tool: list datasets, fetch each
 * dataset's graph, fail per-library without sinking the assembly.
 * @module @deepseek-ai/dsh-host-kg
 */

import type { KgLibraryGraph } from './types.ts'

/** One dataset row from `GET /api/v1/datasets`. */
export interface RfDatasetRow {
  readonly id: string
  readonly name: string
  readonly document_count?: number
  readonly chunk_count?: number
}

interface RfListEnvelope {
  readonly code?: number
  readonly message?: string
  readonly data?: unknown
}

/** Raised when RAGFlow answers the list call with anything but success. */
export class RfListError extends Error {}

/** Raised when one dataset's graph call fails; the assembly keeps going. */
export class RfGraphError extends Error {}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` }
}

function unwrap(envelope: RfListEnvelope, what: string): unknown {
  if (envelope.code !== 0) {
    throw new RfListError(`RAGFlow ${what}失败: code=${String(envelope.code)} ${envelope.message ?? ''}`.trim())
  }
  return envelope.data
}

/** List every dataset visible to the key. */
export async function rfListDatasets(
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<readonly RfDatasetRow[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  const onExternalAbort = () => { controller.abort() }
  signal?.addEventListener('abort', onExternalAbort, { once: true })
  try {
    // RAGFlow caps page_size at 100; page through until a short page arrives.
    const PAGE_SIZE = 100
    const all: RfDatasetRow[] = []
    for (let page = 1; page <= 100; page += 1) {
      const response = await fetch(`${baseUrl}/api/v1/datasets?page=${String(page)}&page_size=${String(PAGE_SIZE)}`, {
        headers: authHeaders(apiKey),
        signal: controller.signal,
      })
      if (!response.ok) throw new RfListError(`RAGFlow 列知识库失败: HTTP ${String(response.status)}`)
      const data = unwrap(await response.json() as RfListEnvelope, '列知识库')
      const rows = Array.isArray(data) ? data : (data as { datasets?: unknown }).datasets
      if (!Array.isArray(rows)) throw new RfListError('RAGFlow 列知识库返回结构异常: 缺少 datasets 数组')
      all.push(...rows as RfDatasetRow[])
      if (rows.length < PAGE_SIZE) break
    }
    return all
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

/** Fetch one dataset's knowledge graph; throws RfGraphError on any failure. */
export async function rfFetchGraph(
  baseUrl: string,
  apiKey: string,
  datasetId: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<KgLibraryGraph> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  const onExternalAbort = () => { controller.abort() }
  signal?.addEventListener('abort', onExternalAbort, { once: true })
  try {
    const response = await fetch(`${baseUrl}/api/v1/datasets/${encodeURIComponent(datasetId)}/graph`, {
      headers: authHeaders(apiKey),
      signal: controller.signal,
    })
    if (!response.ok) {
      const hint = response.status === 404 ? '(该知识库可能尚未构建图谱)' : ''
      throw new RfGraphError(`HTTP ${String(response.status)} ${hint}`.trim())
    }
    const envelope = await response.json() as RfListEnvelope
    const data = unwrap(envelope, `拉取图谱 ${datasetId}`)
    // v0.27 nests the payload as data.graph.{nodes,edges}; older shapes sat at data.{nodes,edges}.
    const payload = data as {
      graph?: { nodes?: unknown; edges?: unknown }
      nodes?: unknown
      edges?: unknown
    }
    const nested = payload.graph
    const flatNodes = Array.isArray(payload.nodes) ? payload.nodes : []
    const flatEdges = Array.isArray(payload.edges) ? payload.edges : []
    const nodes = Array.isArray(nested?.nodes) ? nested.nodes : flatNodes
    const edges = Array.isArray(nested?.edges) ? nested.edges : flatEdges
    return { nodes: nodes as KgLibraryGraph['nodes'], edges: edges as KgLibraryGraph['edges'] }
  } catch (error) {
    if (error instanceof RfGraphError || error instanceof RfListError) throw error
    const cause = error instanceof Error ? error.message : String(error)
    throw new RfGraphError(cause.includes('abort') ? `请求超时/中止 (${cause})` : cause)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}
