/**
 * Wire contracts for the canvas Remote: per-session artifact state and the
 * mutation verbs the browser half and the model tool share.
 * @module @deepseek-ai/dsh-host-canvas/types
 */

/** One artifact rendered on the right-side canvas. */
export interface CanvasArtifact {
  /** Stable per-session artifact id ('a1', 'a2', ...). */
  readonly id: string
  readonly title: string
  readonly kind: 'html' | 'markdown' | 'text'
  readonly content: string
  /** ISO-8601 timestamp of the last write. */
  readonly updatedAt: string
  /** Downloadable files recorded at write time; served by the downloads channel. Absent or undefined means none. */
  readonly attachments?: readonly CanvasArtifactAttachment[] | undefined
}

/** One downloadable file attached to an artifact; the panel renders one download affordance per entry. */
export interface CanvasArtifactAttachment {
  /** Download filename offered to the browser. */
  readonly name: string
  /** Host-side absolute file path recorded at write time. */
  readonly path: string
  /** IANA media type sent with the download response. */
  readonly mediaType: string
  /** Size in bytes recorded at write time. */
  readonly bytes: number
}

/** Artifact list row: identity and attachments, content omitted (fetched per id). */
export interface CanvasArtifactSummary {
  readonly id: string
  readonly title: string
  readonly kind: CanvasArtifact['kind']
  readonly updatedAt: string
  /** Downloadable files recorded at write time; absent or undefined means none. */
  readonly attachments?: readonly CanvasArtifactAttachment[] | undefined
}

/** Per-session canvas state as polled by the browser half: artifact summaries without content. */
export interface CanvasState {
  readonly artifacts: readonly CanvasArtifactSummary[]
  readonly selected: string | null
  readonly rev: number
}

/** Request for one artifact's full record including content. */
export interface CanvasGetRequest {
  readonly sessionId: string
  readonly id: string
}

/** Result of a full-record fetch; a null artifact means the id is unknown. */
export interface CanvasGetResult {
  readonly ok: boolean
  readonly artifact: CanvasArtifact | null
  readonly message: string
}

/** Request for the full state of one session's canvas. */
export interface CanvasStateRequest {
  readonly sessionId: string
}

/** Request to select (or, with empty id, deselect) one artifact. */
export interface CanvasSelectRequest {
  readonly sessionId: string
  readonly id: string | null
}

/** Result of a select/deselect mutation. */
export interface CanvasSelectResult {
  readonly ok: boolean
  readonly selected: string | null
  readonly message: string
}

/** Request to seed a session's empty canvas with demo artifacts. */
export interface CanvasDemoRequest {
  readonly sessionId: string
}

/** Result of the demo seed. */
export interface CanvasDemoResult {
  readonly ok: boolean
  readonly message: string
}

/** One mutation result: the affected artifact (when one exists), the full list, and the selection. */
export interface CanvasMutationResult {
  readonly ok: boolean
  readonly message: string
  readonly artifact: CanvasArtifact | null
  readonly artifacts: readonly CanvasArtifactSummary[]
  readonly selected: string | null
}
