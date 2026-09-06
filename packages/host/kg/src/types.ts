/**
 * Public data shapes for the knowledge-graph host plugin.
 * @module @deepseek-ai/dsh-host-kg
 */

/** One raw entity row as RAGFlow may report it; field names vary by version. */
export interface KgRawNode {
  readonly name?: string
  readonly entity_name?: string
  readonly id?: string
  readonly entity?: string
  readonly entity_type?: string
  readonly type?: string
  readonly description?: string
}

/** One raw relationship row; endpoint/label field names vary by version. */
export interface KgRawEdge {
  readonly source?: string
  readonly target?: string
  readonly src?: string
  readonly dst?: string
  readonly from?: string
  readonly to?: string
  readonly relationship?: string
  readonly description?: string
  readonly label?: string
  readonly weight?: number
}

/** Raw graph payload of one dataset as returned by `GET /datasets/{id}/graph`. */
export interface KgLibraryGraph {
  readonly nodes: readonly KgRawNode[]
  readonly edges: readonly KgRawEdge[]
}

/** One normalized entity: names unique per library, type defaulted. */
export interface KgEntity {
  readonly name: string
  readonly type: string
  readonly description?: string
}

/** One normalized relationship: both endpoints are names present in `KgEntity[]`. */
export interface KgRelationship {
  readonly source: string
  readonly target: string
  readonly relationship?: string
  /** Edge weight when RAGFlow reports one. */
  readonly weight?: number
}

/** One knowledge library in the assembled hub view. */
export interface KgLibrary {
  readonly id: string
  readonly name: string
  /** Normalized entities; duplicates by name+type merged, first description wins. */
  readonly nodes: readonly KgEntity[]
  /** Normalized relationships, both endpoints present in `nodes`. */
  readonly edges: readonly KgRelationship[]
  /** Set when this library's graph could not be fetched; message explains why. */
  readonly error?: string
  /** True when the library exists but carries no built graph yet. */
  readonly empty: boolean
}

/** The assembled hub graph written to the canvas. */
export interface KgGraphData {
  readonly hub: string
  readonly libraries: readonly KgLibrary[]
  readonly generatedAt: string
}

/** Result of assembling every library: data on success, error message on total failure. */
export interface KgAssemblyResult {
  readonly data?: KgGraphData
  readonly error?: string
  /** Libraries fetched OK / skipped / failed, for the tool's summary line. */
  readonly okLibraries: number
  readonly failedLibraries: number
  readonly totalNodes: number
  readonly totalEdges: number
}

/** Plugin config as declared in cordis.yml; env names are references, never values. */
export interface KgConfig {
  /** Credential-reference name holding the RAGFlow API base URL. */
  readonly apiUrlEnv: string
  /** Credential-reference name holding the RAGFlow API key. */
  readonly apiKeyEnv: string
  /** Center-node label shown for the hub in the assembled graph. */
  readonly hubLabel: string
  /** Empty list means every dataset; otherwise a name/id whitelist. */
  readonly libraries: readonly string[]
  /** 0 keeps every node; larger values keep the N most-connected entities per library. */
  readonly maxNodesPerLibrary: number
  /** Prefix of the canvas artifact title the tool writes. */
  readonly titlePrefix: string
}
