/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the webserver, Connection, the session store, and
 * the upload route; every assertion observes the authenticated HTTP surface
 * of the running server (multipart admission, PDF magic, size cap,
 * containment, name collisions, teardown). A Connection-level suite covers
 * the service-absent and cwd-less answers plus the pure admission helpers.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as WorkspaceUpload from '../src/index.ts'

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1')

/** Build one multipart body carrying a single `file` field. */
function pdfForm(bytes: Buffer, filename: string): FormData {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), filename)
  return form
}

/** Exchange the Connection launch token for the authority-bound session cookie. */
function browserCookie(connection: HostConnectionHandle, origin: string): string {
  const target = new URL(connection.authenticatedUrl(origin))
  let setCookie: string | undefined
  connection.authorizeIndex({
    method: 'GET',
    url: `${target.pathname}${target.search}`,
    headers: { host: target.host },
  }, {
    writeHead(_status: number, headers?: Record<string, string>) { setCookie = headers?.['set-cookie'] },
    end() {},
  })
  if (setCookie === undefined) throw new Error('workspace-upload fixture did not receive an authentication cookie')
  return setCookie.split(';', 1)[0]!
}

describe('workspace upload real Loader composition', () => {
  let root: string | undefined
  let context: Context | undefined
  let origin: string | undefined
  let cookie: string | undefined
  let workspaces = 0

  /** One fresh workspace plus a live session whose header cwd points at it. */
  async function sessionWithWorkspace(): Promise<{ sessionId: string; workspaceRoot: string }> {
    workspaces += 1
    const workspaceRoot = join(root!, `ws-${String(workspaces)}`)
    await mkdir(workspaceRoot, { recursive: true })
    const sessions = context!.get('sessions') as unknown as SessionStore
    const session = sessions.create(SessionId(`upload-${String(workspaces)}`), {
      meta: { createdAt: 1, cwd: workspaceRoot },
    })
    return { sessionId: String(session.id), workspaceRoot }
  }

  /** POST one body to the mounted upload route with the browser session cookie. */
  async function post(sessionId: string, body: FormData): Promise<Response> {
    return fetch(`${origin}/api/workspace.upload?sessionId=${sessionId}`, {
      method: 'POST',
      headers: { cookie: cookie! },
      body,
    })
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workspace-upload-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: fixture-dependencies',
      "- name: '@deepseek-ai/dsh-host-webserver'",
      '  config:',
      "    host: '127.0.0.1'",
      '    port: 0',
      "- name: '@deepseek-ai/dsh-client-connection'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-workspace-upload'",
      '  config:',
      '    maxFileBytes: 128',
      '',
    ].join('\n'))

    const dependencies = {
      name: 'fixture-dependencies',
      apply(ctx: Context) {
        const records = new Map<unknown, unknown>()
        ctx.provide('credentials', {
          async modifyRecord(
            key: unknown,
            mutate: (current: unknown) => Promise<unknown>,
          ): Promise<unknown> {
            const current = records.get(key)
            const next = await mutate(current)
            if (next !== undefined) records.set(key, next)
            return next ?? current
          },
        } as never)
      },
    }
    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['fixture-dependencies', dependencies],
      ['@deepseek-ai/dsh-host-webserver', WebServer],
      ['@deepseek-ai/dsh-client-connection', Connection],
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-workspace-upload', WorkspaceUpload],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()
    expect([...context.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    origin = `http://127.0.0.1:${String(context.webServer.port)}`
    cookie = browserCookie(context.get('connection') as unknown as HostConnectionHandle, origin)
  }, 60_000)

  afterAll(async () => {
    await context?.fiber.dispose()
    context = undefined
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it('uploads a PDF into the session workspace uploads/ directory', async () => {
    const { sessionId, workspaceRoot } = await sessionWithWorkspace()
    const response = await post(sessionId, pdfForm(PDF, 'doc.pdf'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ path: 'uploads/doc.pdf', bytes: PDF.byteLength })
    await expect(readFile(join(workspaceRoot, 'uploads', 'doc.pdf'))).resolves.toEqual(PDF)
  })

  it('rejects a request without a usable sessionId query parameter', async () => {
    const noQuery = await fetch(`${origin}/api/workspace.upload`, {
      method: 'POST',
      headers: { cookie: cookie! },
      body: pdfForm(PDF, 'doc.pdf'),
    })
    expect(noQuery.status).toBe(400)
    await expect(noQuery.text()).resolves.toContain('sessionId')
    const emptyQuery = await fetch(`${origin}/api/workspace.upload?sessionId=`, {
      method: 'POST',
      headers: { cookie: cookie! },
      body: pdfForm(PDF, 'doc.pdf'),
    })
    expect(emptyQuery.status).toBe(400)
  })

  it('rejects an unknown session', async () => {
    const response = await post('missing-session', pdfForm(PDF, 'doc.pdf'))
    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toContain('session not found')
  })

  it('rejects a non-PDF payload by its magic bytes', async () => {
    const { sessionId } = await sessionWithWorkspace()
    const response = await post(sessionId, pdfForm(Buffer.from('clearly not a PDF payload'), 'doc.pdf'))
    expect(response.status).toBe(400)
    await expect(response.text()).resolves.toContain('PDF')
  })

  it('rejects a multipart body without a file field', async () => {
    const { sessionId } = await sessionWithWorkspace()
    const stringField = new FormData()
    stringField.append('file', 'a plain text field')
    const response = await post(sessionId, stringField)
    expect(response.status).toBe(400)
    await expect(response.text()).resolves.toContain('file')
  })

  it('rejects an oversized file', async () => {
    const { sessionId, workspaceRoot } = await sessionWithWorkspace()
    const response = await post(sessionId, pdfForm(Buffer.concat([PDF, Buffer.alloc(200)]), 'big.pdf'))
    expect(response.status).toBe(413)
    await expect(readFile(join(workspaceRoot, 'uploads', 'big.pdf'))).rejects.toThrow()
  })

  it('admits a file exactly at maxFileBytes and rejects one byte over', async () => {
    const { sessionId, workspaceRoot } = await sessionWithWorkspace()
    const exact = Buffer.concat([PDF, Buffer.alloc(128 - PDF.byteLength)])
    expect(exact.byteLength).toBe(128)
    const admitted = await post(sessionId, pdfForm(exact, 'exact.pdf'))
    expect(admitted.status).toBe(200)
    await expect(admitted.json()).resolves.toEqual({ path: 'uploads/exact.pdf', bytes: 128 })
    await expect(readFile(join(workspaceRoot, 'uploads', 'exact.pdf'))).resolves.toEqual(exact)
    const over = await post(
      sessionId,
      pdfForm(Buffer.concat([PDF, Buffer.alloc(128 - PDF.byteLength + 1)]), 'over.pdf'),
    )
    expect(over.status).toBe(413)
    await expect(readFile(join(workspaceRoot, 'uploads', 'over.pdf'))).rejects.toThrow()
  })

  it('disambiguates a duplicate name', async () => {
    const { sessionId, workspaceRoot } = await sessionWithWorkspace()
    await expect(post(sessionId, pdfForm(PDF, 'doc.pdf'))).resolves.toMatchObject({ status: 200 })
    const second = await post(sessionId, pdfForm(PDF, 'doc.pdf'))
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual({ path: 'uploads/doc-1.pdf', bytes: PDF.byteLength })
    await expect(readFile(join(workspaceRoot, 'uploads', 'doc.pdf'))).resolves.toEqual(PDF)
    await expect(readFile(join(workspaceRoot, 'uploads', 'doc-1.pdf'))).resolves.toEqual(PDF)
  })

  it('disambiguates an extensionless duplicate name', async () => {
    const { sessionId } = await sessionWithWorkspace()
    await expect(post(sessionId, pdfForm(PDF, 'report'))).resolves.toMatchObject({ status: 200 })
    const second = await post(sessionId, pdfForm(PDF, 'report'))
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual({ path: 'uploads/report-1.pdf', bytes: PDF.byteLength })
  })

  it('sanitizes path separators and parent segments in the filename', async () => {
    const { sessionId, workspaceRoot } = await sessionWithWorkspace()
    const response = await post(sessionId, pdfForm(PDF, 'a/../evil.pdf'))
    expect(response.status).toBe(200)
    const body = await response.json() as { path: string }
    expect(body.path).not.toContain('..')
    expect(body.path).toBe('uploads/a-evil.pdf')
    await expect(readFile(join(workspaceRoot, 'uploads', 'a-evil.pdf'))).resolves.toEqual(PDF)
  })

  it('falls back to a default name when the filename reduces to nothing', async () => {
    const { sessionId, workspaceRoot } = await sessionWithWorkspace()
    const response = await post(sessionId, pdfForm(PDF, '..'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ path: 'uploads/upload.pdf', bytes: PDF.byteLength })
    await expect(readFile(join(workspaceRoot, 'uploads', 'upload.pdf'))).resolves.toEqual(PDF)
  })

  it('answers 500 when the workspace write fails', async () => {
    const { sessionId, workspaceRoot } = await sessionWithWorkspace()
    await writeFile(join(workspaceRoot, 'uploads'), 'a regular file blocking the directory')
    const response = await post(sessionId, pdfForm(PDF, 'doc.pdf'))
    expect(response.status).toBe(500)
  })
})

describe('workspace upload Connection route', () => {
  /** Mount the plugin on one Connection service, optionally with the session store. */
  async function mounted(withSessions: boolean): Promise<{
    readonly connection: HostConnectionService
    readonly ctx: Context
    readonly dispose: () => Promise<void>
  }> {
    const ctx = new Context()
    if (withSessions) await ctx.plugin(SessionStore)
    const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
    const fiber = ctx.plugin({ inject: [...WorkspaceUpload.inject], apply: WorkspaceUpload.apply })
    await fiber
    return { connection, ctx, dispose: () => fiber.dispose() }
  }

  it('answers 500 when the sessions service is absent', async () => {
    const { connection, dispose } = await mounted(false)
    const shared = connection.createSharedFetchHandler('/api')
    const response = await shared.fetch(new Request(
      'http://host/api/workspace.upload?sessionId=session-1',
      { method: 'POST', body: pdfForm(PDF, 'doc.pdf') },
    ))
    expect(response.status).toBe(500)
    await expect(response.text()).resolves.toContain('sessions')
    await dispose()
  })

  it('answers 500 when the live session has no workspace cwd', async () => {
    const { connection, ctx, dispose } = await mounted(true)
    const sessions = ctx.get('sessions') as unknown as SessionStore
    sessions.create(SessionId('cwd-less-session'), { meta: { createdAt: 1 } })
    const shared = connection.createSharedFetchHandler('/api')
    const response = await shared.fetch(new Request(
      'http://host/api/workspace.upload?sessionId=cwd-less-session',
      { method: 'POST', body: pdfForm(PDF, 'doc.pdf') },
    ))
    expect(response.status).toBe(500)
    await expect(response.text()).resolves.toContain('cwd')
    await dispose()
  })

  it('removes the route with the plugin fiber', async () => {
    const { connection, dispose } = await mounted(true)
    const shared = connection.createSharedFetchHandler('/api')
    await dispose()
    const response = await shared.fetch(new Request(
      'http://host/api/workspace.upload?sessionId=session-1',
      { method: 'POST', body: pdfForm(PDF, 'doc.pdf') },
    ))
    expect(response.status).toBe(404)
  })

  it('validates the admission config', () => {
    expect(WorkspaceUpload.Config({})).toEqual({ maxFileBytes: 20 * 1024 * 1024 })
    expect(WorkspaceUpload.Config({ maxFileBytes: 128 })).toEqual({ maxFileBytes: 128 })
    for (const maxFileBytes of [0, -1, 1.5]) {
      expect(() => WorkspaceUpload.Config({ maxFileBytes })).toThrow()
    }
  })

  it('neutralizes separator and parent-segment filenames', () => {
    expect(WorkspaceUpload.sanitizeUploadFilename('doc.pdf')).toBe('doc.pdf')
    expect(WorkspaceUpload.sanitizeUploadFilename('a/../evil.pdf')).toBe('a-evil.pdf')
    expect(WorkspaceUpload.sanitizeUploadFilename('..\\..\\evil.pdf')).toBe('evil.pdf')
    expect(WorkspaceUpload.sanitizeUploadFilename('..')).toBe('upload.pdf')
    expect(WorkspaceUpload.sanitizeUploadFilename('')).toBe('upload.pdf')
  })

  it('contains resolved upload targets under the workspace uploads directory', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-workspace-upload-target-'))
    try {
      expect(WorkspaceUpload.resolveUploadTarget(workspaceRoot, 'doc.pdf'))
        .toBe(join(workspaceRoot, 'uploads', 'doc.pdf'))
      expect(() => WorkspaceUpload.resolveUploadTarget(workspaceRoot, '/etc/passwd')).toThrow(/workspace/)
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})
