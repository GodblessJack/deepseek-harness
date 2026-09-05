/**
 * Workspace file upload endpoint: one authenticated POST stores a
 * user-provided file under the calling session's workspace `uploads/` tree.
 * @module @deepseek-ai/dsh-workspace-upload
 */

import { mkdir, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'

/** Cordis function-plugin name. */
export const name = 'workspace-upload'
/** Host service required before the exact route can register. */
export const inject = ['connection']

/** Stable upload path; mirrors the session.export direct-endpoint precedent. */
export const WORKSPACE_UPLOAD_PATH = '/api/workspace.upload'

/** Directory under the session workspace cwd where admitted uploads land. */
export const UPLOADS_DIRECTORY = 'uploads'

/** Admitted byte ceiling for one uploaded file: 20 MiB. */
export const DEFAULT_MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024

/** Required leading bytes of every admitted upload (PDF file header). */
const PDF_MAGIC = '%PDF-'

/** Filename used when a submitted name reduces to no safe segments. */
const FALLBACK_FILENAME = 'upload.pdf'

/** Upload admission policy. */
export interface Config {
  /** Per-file byte cap. @default 20971520 (20 MiB) */
  readonly maxFileBytes?: number
}

/** Validate upload admission configuration. */
export const Config: Schema<Config> = Schema.object({
  maxFileBytes: Schema.natural().min(1).default(DEFAULT_MAX_UPLOAD_FILE_BYTES),
})

interface UploadConnection {
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly ('POST')[]
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

/**
 * Register the authenticated `POST /api/workspace.upload` Fetch route on
 * Connection; the service scopes registration disposal to this plugin fiber.
 * @param ctx - Host context carrying the Connection service.
 * @param config - resolved upload admission policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  connectionOf(ctx).fetch.register({
    path: WORKSPACE_UPLOAD_PATH,
    methods: ['POST'],
    fetch: request => workspaceUploadResponse(
      ctx,
      request,
      config.maxFileBytes ?? DEFAULT_MAX_UPLOAD_FILE_BYTES,
    ),
  })
}

function connectionOf(ctx: Context): UploadConnection {
  return Reflect.get(ctx, 'connection') as UploadConnection
}

/**
 * Admit or reject one multipart upload request. Rejections are plain text
 * with 400/404/413/500 semantics; success is one `{"path","bytes"}` JSON body.
 * @param ctx - composed Host context; the live session store is read per request.
 * @param request - POSTed multipart form request carrying one `file` field.
 * @param maxFileBytes - resolved per-file byte cap.
 * @returns the complete Fetch response.
 */
async function workspaceUploadResponse(
  ctx: Context,
  request: Request,
  maxFileBytes: number,
): Promise<Response> {
  const sessionIdValue = new URL(request.url).searchParams.get('sessionId')
  if (sessionIdValue === null || sessionIdValue === '') {
    return new Response('missing sessionId query parameter', { status: 400 })
  }
  const sessions = ctx.get('sessions')
  if (sessions === undefined) {
    return new Response(
      'workspace upload is unavailable: missing sessions service',
      { status: 500 },
    )
  }
  const session = sessions.get(SessionId(sessionIdValue))
  if (session === undefined) return new Response('session not found', { status: 404 })
  const workspaceRoot = session.header.cwd
  if (workspaceRoot === undefined) {
    return new Response('session has no workspace cwd', { status: 500 })
  }
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return new Response('multipart form data is required', { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return new Response('multipart field "file" must carry one file', { status: 400 })
  }
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.subarray(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
    return new Response('only PDF files are accepted', { status: 400 })
  }
  if (bytes.byteLength > maxFileBytes) {
    return new Response('uploaded file exceeds the configured maxFileBytes', { status: 413 })
  }
  const safeName = sanitizeUploadFilename(file.name)
  try {
    const target = await writeFirstFreeTarget(workspaceRoot, safeName, bytes)
    return Response.json({
      path: relative(workspaceRoot, target).split(sep).join('/'),
      bytes: bytes.byteLength,
    })
  } catch {
    request.signal.throwIfAborted()
    // Swallows the workspace filesystem failures (mkdir/stat/writeFile and
    // the containment assert) for one 500 answer; request abort rethrows above.
    return new Response('upload failed', { status: 500 })
  }
}

/**
 * Reduce one submitted filename to a single safe path segment: separator
 * splits, `.`, and `..` segments drop, and the remaining segments join with
 * `-`, so no separator or parent traversal survives into the stored name.
 * @param filename - the multipart-decoded submitted filename.
 * @returns the sanitized segment, or a fallback when nothing safe remains.
 */
export function sanitizeUploadFilename(filename: string): string {
  const segments = filename.split(/[\\/]+/)
    .filter(segment => segment !== '' && segment !== '.' && segment !== '..')
  const joined = segments.join('-')
  return joined === '' ? FALLBACK_FILENAME : joined
}

/**
 * The candidate stored filename for one sanitized name and collision index:
 * `name`, then `stem-1.ext`, `stem-2.ext`, and so on. An extensionless name
 * gains `.pdf`, the only admitted format.
 * @param safeName - sanitized single-segment filename.
 * @param index - zero-based collision disambiguation index.
 * @returns the candidate filename.
 */
function disambiguatedName(safeName: string, index: number): string {
  if (index === 0) return safeName
  const dot = safeName.lastIndexOf('.')
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName
  const extension = dot > 0 ? safeName.slice(dot) : '.pdf'
  return `${stem}-${String(index)}${extension}`
}

/**
 * Resolve one upload filename under the workspace `uploads/` directory and
 * assert lexical containment inside the workspace root.
 * @param workspaceRoot - the session's absolute workspace cwd.
 * @param filename - single-segment candidate filename.
 * @returns the absolute target path, inside the workspace.
 * @throws when the resolved target escapes the workspace root (an absolute
 *   or traversing filename the sanitization step must have removed).
 */
export function resolveUploadTarget(workspaceRoot: string, filename: string): string {
  const target = resolve(workspaceRoot, UPLOADS_DIRECTORY, filename)
  const path = relative(resolve(workspaceRoot), target)
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`upload target ${JSON.stringify(target)} escapes the session workspace`)
  }
  return target
}

/**
 * Write the uploaded bytes under the first unused target filename, creating
 * the `uploads/` directory on first use.
 * @param workspaceRoot - the session's absolute workspace cwd.
 * @param safeName - sanitized submitted filename.
 * @param bytes - admitted file contents.
 * @returns the absolute path actually written.
 */
async function writeFirstFreeTarget(
  workspaceRoot: string,
  safeName: string,
  bytes: Buffer,
): Promise<string> {
  await mkdir(resolve(workspaceRoot, UPLOADS_DIRECTORY), { recursive: true })
  for (let index = 0; ; index += 1) {
    const target = resolveUploadTarget(workspaceRoot, disambiguatedName(safeName, index))
    if (await pathExists(target)) continue
    await writeFile(target, bytes)
    return target
  }
}

/**
 * Whether one path currently exists.
 * @param path - absolute path to probe.
 * @returns true when the path resolves to any filesystem entry.
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    // Swallows only the not-found answer of stat: the parent directory was
    // just created, and any other filesystem failure resurfaces on write.
    return false
  }
}
