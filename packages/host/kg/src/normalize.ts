/**
 * Assembly of the hub graph: normalize each library's raw RAGFlow payload,
 * dedup entities, drop dangling edges, apply the whitelist/top-N policy, and
 * build the hierarchical KgGraphData the renderer consumes.
 * @module @deepseek-ai/dsh-host-kg
 */

import type {
  KgAssemblyResult,
  KgConfig,
  KgEntity,
  KgGraphData,
  KgLibrary,
  KgLibraryGraph,
  KgRawEdge,
  KgRawNode,
  KgRelationship,
} from './types.ts'
import type { RfDatasetRow } from './fetch.ts'

/** One library's raw payload plus its fetch outcome, as the assembly loop sees it. */
export interface LibraryOutcome {
  readonly row: RfDatasetRow
  readonly graph?: KgLibraryGraph
  readonly error?: string
}

function entityName(raw: KgRawNode): string | undefined {
  const name = raw.name ?? raw.entity_name ?? raw.id ?? raw.entity
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

function entityType(raw: KgRawNode): string {
  const type = raw.entity_type ?? raw.type
  return typeof type === 'string' && type.length > 0 ? type : '未分类'
}

function entityDescription(raw: KgRawNode): string | undefined {
  const description = raw.description
  return typeof description === 'string' && description.length > 0 ? description : undefined
}

function endpoint(raw: KgRawEdge, keys: readonly (keyof KgRawEdge)[]): string | undefined {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** Normalize one library graph: merge duplicate name+type entities, drop dangling edges. */
export function normalizeLibraryGraph(raw: KgLibraryGraph): { nodes: readonly KgEntity[]; edges: readonly KgRelationship[] } {
  const byKey = new Map<string, KgEntity>()
  for (const rawNode of raw.nodes) {
    const name = entityName(rawNode)
    if (name === undefined) continue
    const description = entityDescription(rawNode)
    const key = `${entityType(rawNode)}\u{0}${name}`
    const existing = byKey.get(key)
    if (existing === undefined) {
      byKey.set(key, { name, type: entityType(rawNode), ...description === undefined ? {} : { description } })
    } else if (existing.description === undefined && description !== undefined) {
      byKey.set(key, { ...existing, description })
    }
  }
  const names = new Map<string, KgEntity>()
  for (const entity of byKey.values()) names.set(entity.name, entity)

  const edges: KgRelationship[] = []
  for (const rawEdge of raw.edges) {
    const source = endpoint(rawEdge, ['source', 'src', 'from'])
    const target = endpoint(rawEdge, ['target', 'dst', 'to'])
    if (source === undefined || target === undefined) continue
    if (!names.has(source) || !names.has(target)) continue
    const relationship = endpoint(rawEdge, ['relationship', 'description', 'label'])
    const weightRaw = (rawEdge as { weight?: unknown }).weight
    edges.push({
      source,
      target,
      ...(relationship === undefined ? {} : { relationship }),
      ...(typeof weightRaw === 'number' ? { weight: weightRaw } : {}),
    })
  }
  return { nodes: [...names.values()], edges }
}

/** Keep the N most-connected entities (and their edges) when policy demands a cap. */
export function capByDegree(
  nodes: readonly KgEntity[],
  edges: readonly KgRelationship[],
  cap: number,
): { nodes: readonly KgEntity[]; edges: readonly KgRelationship[] } {
  if (cap <= 0 || nodes.length <= cap) return { nodes, edges }
  const degree = new Map<string, number>(nodes.map(node => [node.name, 0]))
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }
  const ranked = [...nodes].sort((a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0))
  const keep = new Set(ranked.slice(0, cap).map(node => node.name))
  return {
    nodes: ranked.slice(0, cap),
    edges: edges.filter(edge => keep.has(edge.source) && keep.has(edge.target)),
  }
}

/** True when the configured whitelist (empty = all) admits this dataset. */
export function admittedByWhitelist(row: RfDatasetRow, whitelist: readonly string[]): boolean {
  if (whitelist.length === 0) return true
  return whitelist.includes(row.name) || whitelist.includes(row.id)
}


/** Assemble every outcome into the hub graph; empty graphs surface as `empty` libraries. */
export function assembleHub(
  hubLabel: string,
  outcomes: readonly LibraryOutcome[],
  config: KgConfig,
  generatedAt: string,
): KgAssemblyResult {
  const libraries: KgLibrary[] = []
  let okLibraries = 0
  let failedLibraries = 0
  let totalNodes = 0
  let totalEdges = 0
  for (const outcome of outcomes) {
    if (!admittedByWhitelist(outcome.row, config.libraries)) continue
    if (outcome.error !== undefined) {
      failedLibraries += 1
      libraries.push({ id: outcome.row.id, name: outcome.row.name, nodes: [], edges: [], error: outcome.error, empty: false })
      continue
    }
    const graph = outcome.graph ?? { nodes: [], edges: [] }
    if (graph.nodes.length === 0) {
      libraries.push({ id: outcome.row.id, name: outcome.row.name, nodes: [], edges: [], empty: true })
      continue
    }
    const normalized = normalizeLibraryGraph(graph)
    const capped = capByDegree(normalized.nodes, normalized.edges, config.maxNodesPerLibrary)
    okLibraries += 1
    totalNodes += capped.nodes.length
    totalEdges += capped.edges.length
    libraries.push({ id: outcome.row.id, name: outcome.row.name, nodes: capped.nodes, edges: capped.edges, empty: false })
  }
  const data: KgGraphData = { hub: hubLabel, libraries, generatedAt }
  return { data, okLibraries, failedLibraries, totalNodes, totalEdges }
}
