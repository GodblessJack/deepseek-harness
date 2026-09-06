/**
 * Browser-local object layer over one Session's canvas store. The Host owns
 * the artifact store; this controller wraps the generated canvas Remote so
 * components receive plain snapshots plus a polling handle, and owns the
 * details-column open/close verbs the panel and card trigger.
 * @module @deepseek-ai/dsh-client-ui-canvas/client/controller
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  CanvasArtifact,
  CanvasArtifactSummary,
  CanvasDemoRequest,
  CanvasDemoResult,
  CanvasGetRequest,
  CanvasGetResult,
  CanvasState,
  CanvasStateRequest,
  CanvasSelectRequest,
  CanvasSelectResult,
} from '@deepseek-ai/dsh-host-canvas/types'

/** The canvas Remote face this controller calls. */
export interface CanvasRemote {
  state: (request: CanvasStateRequest) => Promise<RemoteResult<CanvasState>>
  get: (request: CanvasGetRequest) => Promise<RemoteResult<CanvasGetResult>>
  select: (request: CanvasSelectRequest) => Promise<RemoteResult<CanvasSelectResult>>
  demo: (request: CanvasDemoRequest) => Promise<RemoteResult<CanvasDemoResult>>
}

/** Layout verbs the controller triggers on user intent. */
export interface CanvasLayoutActions {
  readonly open: () => void
  readonly close: () => void
}

/** One session's canvas view state as components consume it: summaries, no content. */
export interface CanvasView {
  readonly artifacts: readonly CanvasArtifactSummary[]
  readonly selected: string | null
  readonly rev: number
}

/** Content fetch outcome: the full artifact, or a failure message. */
export type CanvasContentResult = { ok: true; artifact: CanvasArtifact } | { ok: false; message: string }

/**
 * Build the downloads-channel URL for one artifact attachment.
 * @param sessionId - the session whose bucket holds the artifact.
 * @param artifactId - the artifact carrying the attachment.
 * @param name - the attachment download filename.
 * @returns the carrier-relative GET URL for the attachment download.
 */
export function canvasAttachmentUrl(sessionId: string, artifactId: string, name: string): string {
  const query = new URLSearchParams({ sessionId, artifactId, name })
  return `/api/canvas.attachment?${query.toString()}`
}

/**
 * Build the downloads-channel URL for one artifact's body.
 * @param sessionId - the session whose bucket holds the artifact.
 * @param artifactId - the artifact whose body is downloaded.
 * @returns the carrier-relative GET URL for the artifact-body download.
 */
export function canvasArtifactUrl(sessionId: string, artifactId: string): string {
  const query = new URLSearchParams({ sessionId, artifactId })
  return `/api/canvas.artifact?${query.toString()}`
}

/** Poll outcome: the next snapshot or a transport/business failure message. */
export type CanvasPollResult = { ok: true; view: CanvasView } | { ok: false; message: string }

/** Controller owning one session's remote calls and polling state. */
export class CanvasController {
  constructor(
    private readonly remote: CanvasRemote,
    private readonly sessionId: SessionId,
    private readonly layout: CanvasLayoutActions,
  ) {}

  /**
   * Read the current state (artifact summaries without content), unwrapping
   * the RemoteResult envelope.
   * @returns the next view snapshot, or the failure message on a transport/business error.
   */
  async poll(): Promise<CanvasPollResult> {
    const res = await this.remote.state({ sessionId: this.sessionId })
    if (!res.ok) return { ok: false, message: res.error.message }
    return { ok: true, view: { artifacts: res.value.artifacts, selected: res.value.selected, rev: res.value.rev } }
  }

  /**
   * Fetch one artifact's full record including content — called when the
   * polled revision or the selection changes, not on every poll.
   * @param id - the artifact id to read.
   * @returns the artifact, or the failure message when it is unknown.
   */
  async loadContent(id: string): Promise<CanvasContentResult> {
    const res = await this.remote.get({ sessionId: this.sessionId, id })
    if (!res.ok) return { ok: false, message: res.error.message }
    if (res.value.artifact === null) return { ok: false, message: res.value.message }
    return { ok: true, artifact: res.value.artifact }
  }

  /**
   * Select one artifact (or deselect with null) and open the details column.
   * @param id - the artifact id to select, or null to deselect.
   */
  async openArtifact(id: string | null): Promise<void> {
    await this.remote.select({ sessionId: this.sessionId, id })
    this.layout.open()
  }

  /** Close the details column. */
  close(): void {
    this.layout.close()
  }

  /** Seed an empty canvas with demo artifacts. */
  async fillDemo(): Promise<void> {
    await this.remote.demo({ sessionId: this.sessionId })
  }
}
