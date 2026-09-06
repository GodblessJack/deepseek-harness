/**
 * Browser-local object layer over one Session's canvas store. The Host owns
 * the artifact store; this controller wraps the generated canvas Remote so
 * components receive plain snapshots plus a polling handle. View navigation
 * (which conversation tab shows) belongs to the conversation view machinery,
 * not here.
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

/** One session's canvas view state as components consume it: summaries, no content. */
export interface CanvasView {
  readonly artifacts: readonly CanvasArtifactSummary[]
  readonly selected: string | null
  readonly rev: number
}

/** Content fetch outcome: the full artifact, or a failure message. */
export type CanvasContentResult = { ok: true; artifact: CanvasArtifact } | { ok: false; message: string }

/** Poll outcome: the next snapshot or a transport/business failure message. */
export type CanvasPollResult = { ok: true; view: CanvasView } | { ok: false; message: string }

/** Download filename for one artifact, derived from its title and kind. */
export function canvasDownloadName(artifact: CanvasArtifactSummary): string {
  const extension = artifact.kind === 'html' ? '.html' : artifact.kind === 'markdown' ? '.md' : '.txt'
  return `${artifact.title.replace(/[\\/:*?"<>|]/g, '_')}${extension}`
}

/** Media type of one artifact kind, for browser-side downloads. */
export function canvasMediaType(kind: CanvasArtifactSummary['kind']): string {
  if (kind === 'html') return 'text/html'
  if (kind === 'markdown') return 'text/markdown'
  return 'text/plain'
}

/**
 * Save one artifact's body as a browser download. The content already reached
 * the browser through the canvas Remote (the panel loads it to render), so the
 * download needs no server-side file channel.
 * @param artifact - the full artifact record to save.
 */
export function downloadArtifactBody(artifact: CanvasArtifact): void {
  const blob = new Blob([artifact.content], { type: canvasMediaType(artifact.kind) })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = canvasDownloadName(artifact)
  anchor.click()
  setTimeout(() => { URL.revokeObjectURL(url) }, 60_000)
}

/** Controller owning one session's remote calls and polling state. */
export class CanvasController {
  constructor(
    private readonly remote: CanvasRemote,
    private readonly sessionId: SessionId,
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
   * Select one artifact (or deselect with null). Which conversation view shows
   * the panel is the user's tab choice; selection alone changes no view.
   * @param id - the artifact id to select, or null to deselect.
   */
  async openArtifact(id: string | null): Promise<void> {
    await this.remote.select({ sessionId: this.sessionId, id })
  }

  /** Seed an empty canvas with demo artifacts. */
  async fillDemo(): Promise<void> {
    await this.remote.demo({ sessionId: this.sessionId })
  }
}
