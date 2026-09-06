/**
 * Scope-addressed conversation send, cancel, and history orchestration.
 *
 * Scope addressing rides the cordis Service tracker: property access through
 * `ctx.conversation` rebinds `this.ctx` to the caller's context, so methods
 * read the session tag with `scopeOf`. Mutable state must remain reachable
 * through one property read; assignment through the tracker proxy and `#`
 * private fields bypass that rebinding.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
// Type-only imports: a plugin-to-plugin value import is a bundle purity
// error, so scope resolution goes through the sessions service (scopeOf
// method) instead of the standalone helper.
import type {
  ISessions, PendingSubmissionRetirement, SessionFace,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {
  ComposerAttachment, FileDraftAttachment, ImageDraftAttachment,
} from './contract/slots.ts'
import type { QueueAction, QueueItemId } from './contract/queue.ts'
import type { ComposerBlocks } from './contract/composer-blocks.ts'
import type {
  DraftAttachmentId, SessionInputResolver, SubmitImageAttachment, SubmitOutcome,
} from './contract/input.ts'
import type { InputSubmitMode } from './contract/composer-submission.ts'

/**
 * The outward conversation face (`ctx.conversation`): the scope-addressed
 * verbs and the input registry other plugins may reach — and exactly what a
 * test fake must supply.
 */
export interface IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /**
   * The per-session composer-block registry: how a plugin the composer
   * cannot import makes a session's input inert with its own reason.
   */
  readonly blocks: ComposerBlocks
  /**
   * Send a prompt into the caller scope's session (queued turn).
   * @param text - prompt text, sent verbatim as one text block.
   * @returns completion; business failures reject (and land in promptError).
   */
  send(text: string): Promise<void>
  /**
   * Apply one edit, remove, or strict steer operation to a pending queue occurrence.
   * @param itemId - agent-owned inbox occurrence identity.
   * @param action - requested queue operation.
   * @returns completion; converged strict-steer races resolve, while other failures reject.
   */
  updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void>
  /**
   * Cancel the scoped session's in-flight turn while preserving its pending Queue.
   * @returns completion; failures reject as in send.
   */
  cancel(): Promise<void>
  /**
   * Pull one older history page for the scoped session.
   * @returns completion of the page pull.
   */
  loadOlder(): Promise<void>
}

/** The only admitted browser-declared media type for draft files. */
export const DRAFT_FILE_MEDIA_TYPE = 'application/pdf'

/**
 * Frontend intake ceiling on PDF drafts per message (the input-state
 * pre-check; nothing server-side depends on it).
 */
export const MAX_DRAFT_FILES_PER_MESSAGE = 4

/**
 * Per-file byte ceiling mirrored from the workspace-upload endpoint's
 * default for the intake pre-check; the endpoint re-enforces its configured
 * cap authoritatively.
 */
export const MAX_DRAFT_FILE_BYTES = 20 * 1024 * 1024

/** Workspace-upload route the draft-file flow posts to. */
const WORKSPACE_UPLOAD_PATH = '/api/workspace.upload'

/** Create one browser-only image draft; only its id enters input state. */
function browserDraftAttachment(file: File): ImageDraftAttachment {
  return {
    kind: 'image',
    id: randomUUID() as DraftAttachmentId,
    previewUrl: URL.createObjectURL(file),
    file,
  }
}

/** Create one browser-only file draft; only its id enters input state. */
function browserDraftFile(file: File): FileDraftAttachment {
  return {
    kind: 'file',
    id: randomUUID() as DraftAttachmentId,
    file,
    sizeText: uploadSizeText(file.size),
  }
}

/**
 * Fill the draft's intrinsic dimensions once the browser parses the image
 * header (a metadata read off the preview URL, not a full decode). Failures
 * and non-browser runtimes leave them absent — consumers size those images
 * from CSS constraints instead. The descriptors stay registry-owned; submit
 * reads the dimensions into an immutable echo snapshot, so this late write
 * does not require a store notification.
 */
function probeDimensions(attachment: ImageDraftAttachment): void {
  if (typeof Image !== 'function') return
  const probe = new Image()
  probe.onload = () => {
    attachment.width = probe.naturalWidth
    attachment.height = probe.naturalHeight
  }
  probe.src = attachment.previewUrl
}

/** Give the echo one paint opportunity without letting a throttled frame clock block admission. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        setTimeout(resolve, 0)
        return
      }
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(fallback)
        setTimeout(resolve, 0)
      }
      const fallback = setTimeout(finish, 100)
      requestAnimationFrame(finish)
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/** Native canonical base64 of one browser file (FileReader data-URL encode; no main-thread byte loop). */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = reader.result as string
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('conversation: image read failed'))
    }
    reader.readAsDataURL(file)
  })
}

/** Unsupported browser-declared image type, localized by the UI boundary. */
export class UnsupportedImageMediaTypeError extends Error {
  /** Browser-declared MIME value, possibly empty. */
  readonly mediaType: string

  /** @param mediaType - Browser-declared MIME value, possibly empty. */
  constructor(mediaType: string) {
    super(`unsupported image media type: ${mediaType || '(empty)'}`)
    this.name = 'UnsupportedImageMediaTypeError'
    this.mediaType = mediaType
  }
}

/** Unsupported browser-declared draft-file type, localized by the UI boundary. */
export class UnsupportedFileMediaTypeError extends Error {
  /** Browser-declared MIME value, possibly empty. */
  readonly mediaType: string

  /** @param mediaType - Browser-declared MIME value, possibly empty. */
  constructor(mediaType: string) {
    super(`unsupported file media type: ${mediaType || '(empty)'}`)
    this.name = 'UnsupportedFileMediaTypeError'
    this.mediaType = mediaType
  }
}

/** Workspace-upload endpoint refusal; the message carries the HTTP status line text. */
export class WorkspaceUploadError extends Error {
  /** HTTP status code of the refusing response. */
  readonly status: number

  /**
   * @param status - HTTP status code of the refusing response.
   * @param statusText - the response's status line text, possibly empty.
   */
  constructor(status: number, statusText: string) {
    super(`workspace upload failed (${status}${statusText === '' ? '' : ` ${statusText}`})`)
    this.name = 'WorkspaceUploadError'
    this.status = status
  }
}

/**
 * Byte count as compact binary units with one separating space
 * (`512 B`, `12 KB`, `1 MB`, `1.5 MB`).
 * @param bytes - the byte count.
 * @returns the unit text.
 */
export function uploadSizeText(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 || Number.isInteger(value) ? value : value.toFixed(1)} ${units[unit]}`
}

/**
 * The verbatim model-visible reference line for one uploaded draft file; the
 * stored workspace path names the file (the uploaded name may have been
 * sanitized or disambiguated server-side), so the declared name stays out of
 * the line.
 * @param path - the workspace-relative path the upload endpoint returned.
 * @param bytes - the stored byte count.
 * @returns the `[attached file] path (size)` reference line.
 */
export function formatUploadReference(path: string, bytes: number): string {
  return `[attached file] ${path} (${uploadSizeText(bytes)})`
}

/** Scope-addressed conversation service (root singleton, provided as `conversation`). */
export class ConversationController extends Service implements IConversation {
  /** The per-session input machine registry (SessionInputResolver face). */
  readonly input: SessionInputResolver
  /** The per-session composer-block registry. */
  readonly blocks: ComposerBlocks
  private readonly draftAttachments = new Map<DraftAttachmentId, ComposerAttachment>()

  /**
   * @param ctx - owning root context (the plugin apply context; the service
   * registers itself and follows that fiber's lifetime).
   * @param config - carries the SessionInputResolver and composer-block registry
   * constructed by the plugin apply (the same instances the slot inject
   * factories close over).
   */
  constructor(ctx: Context, config: { input: SessionInputResolver; blocks: ComposerBlocks }) {
    super(ctx, 'conversation')
    this.input = config.input
    this.blocks = config.blocks
    ctx.effect(() => () => {
      for (const attachment of this.draftAttachments.values()) {
        if (attachment.kind === 'image') revokePreview(attachment.previewUrl)
      }
      this.draftAttachments.clear()
    }, 'conversation draft attachments')
  }

  /**
   * Send a prompt into the scoped session. Business failures also land in the
   * session snapshot's promptError (object-layer state); the rejection here
   * exists for caller choreography (the composer restores the draft on it).
   * @param text - prompt text, sent verbatim as one text block.
   */
  async send(text: string): Promise<void> {
    const session = this.scopedSession('send')
    const result = await session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`)
  }

  /**
   * Submit ordered draft images and PDF files with text through one host
   * admission. A local submission echo enters the session snapshot
   * synchronously; serialization, the PDF uploads, and the prompt round-trip
   * start after the browser can paint it. Each draft file uploads to the
   * session workspace first; its verbatim reference line then leads the text
   * part (`references\n\n text`). On the echo's observed retirement the draft
   * images hand their preview URLs to the durable image cache and both kinds
   * leave the registry; on failure they stay registered so the composer can
   * restore them.
   * @param session - target session.
   * @param text - serialized prompt text.
   * @param imageIds - ordered draft-local image ids.
   * @param fileIds - ordered draft-local PDF file ids.
   * @param mode - queue or steer delivery selected by composer policy.
   * @param signal - optional cancellation for the complete Host admission.
   * @returns the Host admission outcome; local attachment preparation and upload failures reject.
   */
  async sendSession(
    session: SessionFace,
    text: string,
    imageIds: readonly DraftAttachmentId[],
    fileIds: readonly DraftAttachmentId[],
    mode: InputSubmitMode,
    signal?: AbortSignal,
  ): Promise<SubmitOutcome> {
    const attachments = this.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw new Error('conversation.sendSession: one or more draft images are no longer available')
    }
    const files = this.draftFiles(fileIds)
    if (files.length !== fileIds.length) {
      throw new Error('conversation.sendSession: one or more draft files are no longer available')
    }
    if (session.getSnapshot().subagent !== null) {
      const uploaded = await this.serializeImages(attachments.map(attachment => attachment.file))
      const references = await this.uploadDraftFiles(session.sessionId, files)
      const result = await session.prompt(withFileReferences(uploaded, references, text), mode, signal)
      return result.ok ? { kind: 'success' } : { kind: 'error' }
    }
    let finishRetirement: ((retirement: PendingSubmissionRetirement) => void) | undefined
    const retirement = attachments.length === 0
      ? undefined
      : new Promise<PendingSubmissionRetirement>((resolve) => { finishRetirement = resolve })
    const submission = session.beginSubmission({
      text,
      images: attachments.map(attachment => ({
        previewUrl: attachment.previewUrl,
        ...(attachment.file.name === '' ? {} : { name: attachment.file.name }),
        ...(attachment.width === undefined ? {} : { width: attachment.width }),
        ...(attachment.height === undefined ? {} : { height: attachment.height }),
      })),
      onRetire: (settlement) => {
        this.settleSubmittedImages(session.sessionId, attachments, settlement)
        this.settleSubmittedFiles(files, settlement)
        finishRetirement?.(settlement)
      },
    })
    let content: Parameters<SessionFace['prompt']>[0]
    try {
      await nextPaint()
      const uploaded = await this.serializeImages(attachments.map(attachment => attachment.file))
      const references = await this.uploadDraftFiles(session.sessionId, files)
      content = withFileReferences(uploaded, references, text)
    } catch (error) {
      submission.abandon()
      throw error
    }
    const result = await session.prompt(content, mode, signal, submission.requestId)
    if (!result.ok) return { kind: 'error' }
    if (retirement !== undefined && (await retirement).reason !== 'observed') return { kind: 'error' }
    return { kind: 'success' }
  }

  /**
   * Create runtime-only draft images and their object URLs.
   * @param files - browser files to register after MIME validation.
   * @returns ordered draft descriptors.
   */
  createDraftImages(files: readonly File[]): readonly ImageDraftAttachment[] {
    for (const file of files) imageMediaType(file.type)
    return files.map((file) => {
      const attachment = browserDraftAttachment(file)
      this.draftAttachments.set(attachment.id, attachment)
      probeDimensions(attachment)
      return attachment
    })
  }

  /**
   * Create runtime-only PDF draft files (no preview URL, no dimension probe).
   * @param files - browser files to register after media-type validation.
   * @returns ordered draft descriptors.
   */
  createDraftFiles(files: readonly File[]): readonly FileDraftAttachment[] {
    for (const file of files) draftFileMediaType(file.type)
    return files.map((file) => {
      const attachment = browserDraftFile(file)
      this.draftAttachments.set(attachment.id, attachment)
      return attachment
    })
  }

  /**
   * Resolve ordered input-state ids to runtime-owned draft images.
   * @param ids - draft attachment ids.
   * @returns image drafts that remain live, in requested order.
   */
  draftImages(ids: readonly DraftAttachmentId[]): readonly ImageDraftAttachment[] {
    const attachments: ImageDraftAttachment[] = []
    for (const id of ids) {
      const attachment = this.draftAttachments.get(id)
      if (attachment?.kind === 'image') attachments.push(attachment)
    }
    return attachments
  }

  /**
   * Resolve ordered input-state ids to runtime-owned draft files.
   * @param ids - draft attachment ids.
   * @returns file drafts that remain live, in requested order.
   */
  draftFiles(ids: readonly DraftAttachmentId[]): readonly FileDraftAttachment[] {
    const attachments: FileDraftAttachment[] = []
    for (const id of ids) {
      const attachment = this.draftAttachments.get(id)
      if (attachment?.kind === 'file') attachments.push(attachment)
    }
    return attachments
  }

  /**
   * Serialize ordered draft images to command-submit wire payloads without
   * sending or releasing them (the composer releases only after the command
   * settles successfully).
   * @param imageIds - ordered draft-local attachment ids.
   * @returns base64 payloads in id order.
   */
  async serializeDraftImages(imageIds: readonly DraftAttachmentId[]): Promise<readonly SubmitImageAttachment[]> {
    const attachments = this.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw new Error('conversation.serializeDraftImages: one or more draft images are no longer available')
    }
    return Promise.all(attachments.map(attachment => this.encodeImage(attachment.file)))
  }

  /**
   * Release one browser-owned draft image and preview URL.
   * @param id - draft attachment id.
   */
  releaseDraftImage(id: DraftAttachmentId): void {
    const attachment = this.draftAttachments.get(id)
    if (attachment === undefined) return
    this.draftAttachments.delete(id)
    if (attachment.kind === 'image') revokePreview(attachment.previewUrl)
  }

  /**
   * Release a set of browser-owned draft images.
   * @param attachments - descriptors to release.
   */
  releaseDraftImages(attachments: readonly ImageDraftAttachment[]): void {
    for (const attachment of attachments) this.releaseDraftImage(attachment.id)
  }

  /**
   * Release one browser-owned draft file (nothing to revoke; the browser
   * keeps the File).
   * @param id - draft attachment id.
   */
  releaseDraftFile(id: DraftAttachmentId): void {
    this.draftAttachments.delete(id)
  }

  /**
   * Release a set of browser-owned draft files.
   * @param attachments - descriptors to release.
   */
  releaseDraftFiles(attachments: readonly FileDraftAttachment[]): void {
    for (const attachment of attachments) this.releaseDraftFile(attachment.id)
  }

  /** Apply one operation to a pending queue occurrence. */
  async updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void> {
    const session = this.scopedSession('updateQueue')
    const result = await session.updateQueue(itemId, action)
    if (!result.ok) {
      if (
        action.kind === 'steer'
        && (result.error.code === 'steer-unavailable' || result.error.code === 'queue-item-not-found')
      ) return
      throw new Error(`conversation.updateQueue failed: ${result.error.code}: ${result.error.message}`)
    }
  }

  /** Cancel the scoped session's in-flight turn while preserving Queue (failures land in promptError and reject, as in send). */
  async cancel(): Promise<void> {
    const session = this.scopedSession('cancel')
    const result = await session.cancel()
    if (!result.ok) throw new Error(`conversation.cancel failed: ${result.error.code}: ${result.error.message}`)
  }

  /** Pull one older history page for the scoped Session. */
  async loadOlder(): Promise<void> {
    await this.scopedSession('loadOlder').loadOlder()
  }

  /** Resolve the caller scope's session face or throw on root contexts. */
  private scopedSession(op: string): SessionFace {
    const id = this.scopeId(op)
    const binding = this.requireSessions().binding(id)
    if (binding === undefined) throw new Error(`conversation.${op}: session "${id}" resolved no binding`)
    return binding.session
  }

  /** Read the caller's session scope tag via the sessions service; root contexts fail loud. */
  private scopeId(op: string): SessionId {
    const id = this.requireSessions().scopeOf(this.ctx)
    if (id === undefined) {
      throw new Error(`conversation.${op} requires a session scope — address one via ctx.sessions.scope(id).conversation`)
    }
    return id
  }

  private requireSessions(): ISessions {
    // Strict ctx.get, not the injection proxy: the scope-addressed pattern
    // reads the service off whatever context the tracker rebound.
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) throw new Error('conversation: sessions service unavailable')
    return sessions
  }

  /**
   * Settle one submission's draft images when its echo retires. Observed:
   * each image leaves the registry, handing its preview URL to the durable
   * image cache (seeded under the admitted reference so the transcript node
   * renders immediately while the cache reads canonical bytes) or revoking it
   * when the cache already holds that reference. Failed: nothing changes;
   * the ids stay registered for the composer's rail restore.
   */
  private settleSubmittedImages(
    sessionId: SessionId,
    attachments: readonly ImageDraftAttachment[],
    retirement: PendingSubmissionRetirement,
  ): void {
    if (retirement.reason !== 'observed') return
    const uiConversation = this.ctx.get('uiConversation')
    attachments.forEach((attachment, index) => {
      const live = this.draftAttachments.get(attachment.id)
      if (live === undefined) return
      this.draftAttachments.delete(attachment.id)
      const ref = retirement.attachments[index]
      if (ref !== undefined && uiConversation?.seedImageUrl(sessionId, ref, attachment.previewUrl) === true) return
      revokePreview(attachment.previewUrl)
    })
  }

  /** Convert browser files to canonical base64 prompt parts. */
  private serializeImages(images: readonly File[]): Promise<Parameters<SessionFace['prompt']>[0]> {
    return Promise.all(images.map(async file => ({ type: 'image' as const, ...await this.encodeImage(file) })))
  }

  /**
   * Release submitted draft files once their echo retires as observed: the
   * workspace owns the stored bytes, so the registry entries simply drop.
   * Failed: nothing changes; the ids stay registered for the composer's
   * restore path.
   * @param files - the submission's file drafts, in send order.
   * @param retirement - the echo's settlement.
   */
  private settleSubmittedFiles(
    files: readonly FileDraftAttachment[],
    retirement: PendingSubmissionRetirement,
  ): void {
    if (retirement.reason !== 'observed') return
    for (const file of files) this.draftAttachments.delete(file.id)
  }

  /**
   * Upload ordered draft files to the session workspace and collect their
   * verbatim reference lines.
   * @param sessionId - owning session (the upload route's workspace scope).
   * @param files - file drafts in send order.
   * @returns reference lines in send order.
   */
  private async uploadDraftFiles(
    sessionId: SessionId,
    files: readonly FileDraftAttachment[],
  ): Promise<readonly string[]> {
    const references: string[] = []
    for (const file of files) {
      const { path, bytes } = await this.uploadDraftFile(sessionId, file)
      references.push(formatUploadReference(path, bytes))
    }
    return references
  }

  /**
   * Upload one draft file through the workspace-upload endpoint.
   * @param sessionId - owning session (the upload route's workspace scope).
   * @param attachment - the draft file to store.
   * @returns the stored workspace-relative path and byte count.
   * @throws WorkspaceUploadError when the endpoint refuses the file or answers a malformed body.
   */
  private async uploadDraftFile(
    sessionId: SessionId,
    attachment: FileDraftAttachment,
  ): Promise<{ path: string; bytes: number }> {
    const form = new FormData()
    form.append('file', attachment.file, attachment.file.name)
    const res = await fetch(
      `${WORKSPACE_UPLOAD_PATH}?sessionId=${encodeURIComponent(sessionId)}`,
      { method: 'POST', body: form },
    )
    if (!res.ok) throw new WorkspaceUploadError(res.status, res.statusText)
    const body: unknown = await res.json()
    if (typeof body !== 'object' || body === null) throw new WorkspaceUploadError(res.status, 'malformed response')
    const { path, bytes } = body as { path?: unknown; bytes?: unknown }
    if (typeof path !== 'string' || typeof bytes !== 'number') {
      throw new WorkspaceUploadError(res.status, 'malformed response')
    }
    return { path, bytes }
  }

  /** Canonical base64 wire form of one browser image file. */
  private async encodeImage(file: File): Promise<SubmitImageAttachment> {
    return {
      mediaType: imageMediaType(file.type),
      data: await base64Of(file),
      ...(file.name === '' ? {} : { name: file.name }),
    }
  }
}

function imageMediaType(value: string): ImageMediaType {
  switch (value) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
    case 'image/gif':
      return value
    default:
      throw new UnsupportedImageMediaTypeError(value)
  }
}

function draftFileMediaType(value: string): 'application/pdf' {
  if (value === DRAFT_FILE_MEDIA_TYPE) return value
  throw new UnsupportedFileMediaTypeError(value)
}

/**
 * Compose the prompt content: uploaded image parts first, then one text part
 * whose body leads with the upload reference lines (joined by newlines)
 * ahead of the user text. Without references the content is exactly the
 * image-and-text form.
 * @param uploaded - serialized image parts in send order.
 * @param references - upload reference lines in send order.
 * @param text - serialized user text, possibly empty.
 * @returns the complete prompt content.
 */
function withFileReferences(
  uploaded: Parameters<SessionFace['prompt']>[0],
  references: readonly string[],
  text: string,
): Parameters<SessionFace['prompt']>[0] {
  const composed = references.length === 0
    ? text
    : references.join('\n') + (text === '' ? '' : `\n\n${text}`)
  return [...uploaded, ...(composed === '' ? [] : [{ type: 'text' as const, text: composed }])]
}

function revokePreview(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}
