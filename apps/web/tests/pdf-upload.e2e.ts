// Web e2e scenario: composer PDF attachment upload end to end. The browser
// drives the shipped paperclip picker (Playwright setInputFiles fires the same
// change event the OS dialog does), so the REAL endpoint admits the bytes on
// the real wire: the draft renders as a name-and-size chip, submit uploads the
// file through POST /api/workspace.upload into the session workspace uploads/
// tree, and the admitted prompt's single text part leads with the verbatim
// model-visible reference line. Replay serves the model turn from the recorded
// fixture; the typed-line command gate rides the same drive lane (a /cmd line
// with a PDF draft refuses without leaving the composer).
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assertFinalWorkspaceSnapshot, assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot, writeComposerDraft } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/pdf-upload', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()

const PDF_NAME = 'tiny.pdf'
// One minimal one-page PDF, padded to exactly 1024 bytes so the reference
// line's size text pins as `1 KB`; nothing in this scenario parses the body,
// but the object stream lengths stay honest anyway. Pure inline bytes — no
// fixture file, no platform dependency.
const PDF_STREAM = 'BT /F1 18 Tf 20 60 Td (Attachment upload probe) Tj ET'
const PDF_CORE = [
  '%PDF-1.4',
  '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj',
  '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj',
  '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>endobj',
  `4 0 obj<< /Length ${String(PDF_STREAM.length)} >>stream`,
  PDF_STREAM,
  'endstream endobj',
  'trailer<< /Root 1 0 R >>',
  '%%EOF',
].join('\n')
const PDF_BYTES = Buffer.from(`${PDF_CORE}\n%${' '.repeat(1024 - PDF_CORE.length - 3)}\n`, 'latin1')
if (PDF_BYTES.length !== 1024) throw new Error(`pdf-upload fixture must pad to 1024 bytes, got ${String(PDF_BYTES.length)}`)

// The recorded prompt forbids opening the attachment so the model turn stays
// tool-free: a replayed pdf-skill call would re-execute the extraction script
// on every replay, coupling the golden to the machine's engine availability.
const PROMPT = 'Do not open the attached document. Reply with the single word RECEIVED and stop.'
/** The admitted user text part: one reference line, a blank line, the typed text. */
const COMPOSED_PROMPT = `[attached file] uploads/${PDF_NAME} (1 KB)\n\n${PROMPT}`
const REFUSAL = '/goal does not accept PDF attachments; remove them first'

/** turn/end reasons observed, in order. */
function turnEndReasons(events: SessionEvent[]): string[] {
  return events
    .filter(e => e.type === 'turn/end')
    .map(e => (e as SessionEvent & { data: { reason: { kind: string } } }).data.reason.kind)
}

describe('web e2e: PDF draft upload with prompt reference line', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let sessionEvents: SessionEvent[]

  afterEach(async () => {
    // scaffold.close() failures MUST fail the scenario: assertConsumed() is
    // the fixture-drift tripwire and cleanup problems are real defects. Run
    // every teardown step regardless, then rethrow what failed.
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    browser = undefined
    const closing = scaffold
    scaffold = undefined
    await closing?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'pdf-upload teardown failed')
  })

  /** Boot scaffold + page; pass the fixture only for scenarios that drive a model turn. */
  async function launch(replayFixture?: string): Promise<void> {
    sessionEvents = []
    scaffold = await launchWebScaffold({
      ...(replayFixture === undefined ? {} : { replayFixture }),
      paceMs: 15,
      compareReplaySession: replayFixture !== undefined,
    })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // Fresh world: connect a Workspace so the composer scenarios start live.
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }

  /** Attach the inline PDF through the hidden picker and wait for its chip. */
  async function attachDraftPdf(): Promise<void> {
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    await page.locator('input[type="file"]').setInputFiles({
      name: PDF_NAME, mimeType: 'application/pdf', buffer: PDF_BYTES,
    })
    const rail = page.locator('[role="group"][aria-label="Pending attachments"]')
    await rail.waitFor({ timeout: 10_000 })
    await expect.poll(() => rail.textContent()).toContain(PDF_NAME)
    await expect.poll(() => rail.textContent()).toContain('1 KB')
  }

  it.skipIf(MODE !== 'record')('records the base fixture live through the composer', async () => {
    await launch(FIXTURE)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-pdf-upload-record'))
    await attachDraftPdf()
    const settled = scaffold!.whenTurnSettled(180_000)
    await writeComposerDraft(page, page.locator('[data-composer-input]').first(), PROMPT)
    await page.locator('[data-composer-input]').first().press('Enter')
    const sessionId = await settled
    await recordFixture(scaffold!, sessionId, FIXTURE)
  }, 200_000)

  it.skipIf(MODE === 'record')('uploads through the endpoint, stores the file, and logs the verbatim reference line', async () => {
    expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([COMPOSED_PROMPT])
    await launch(FIXTURE)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-pdf-upload'))
    await attachDraftPdf()
    const settled = scaffold!.whenTurnSettled(30_000)
    await writeComposerDraft(page, page.locator('[data-composer-input]').first(), PROMPT)
    await page.locator('[data-composer-input]').first().press('Enter')
    const sessionId = await settled

    // The admitted prompt is exactly one text part: the reference line leads,
    // the blank line separates, the typed text follows — the model-visible
    // contract, pinned verbatim against the durable log.
    const userTexts = sessionEvents.flatMap((event) => {
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') return []
      return [event.data.content.filter(block => block.type === 'text').map(block => block.text).join('')]
    })
    expect(userTexts).toEqual([COMPOSED_PROMPT])
    expect(turnEndReasons(sessionEvents).at(-1)).toBe('completed')

    // The endpoint stored the exact bytes under the session workspace uploads/
    // tree (connectFreshWorkspace stages the workspace folder itself).
    expect(sessionId).toBeDefined()
    const stored = await readFile(join(scaffold!.workspaceCwd, 'workspace', 'uploads', PDF_NAME))
    expect(stored.equals(PDF_BYTES)).toBe(true)
    // Independent oracle over the complete final workspace: catches any
    // unexpected extra file the endpoint leaked, which the byte check above
    // cannot see.
    await assertFinalWorkspaceSnapshot(SNAPSHOT_DIR, join(scaffold!.workspaceCwd, 'workspace'))

    // The exact-text match: the composed prompt itself names the word, so a
    // substring wait would also resolve against the echoed user message.
    await page.getByText('RECEIVED', { exact: true }).waitFor({ timeout: 15_000 })
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('refuses a typed-line command while a PDF draft is attached', async () => {
    // No model turn issues from this scenario: boot without a replay fixture
    // (the scaffold's documented shape for call-free scenarios).
    await launch()
    onTestFailed(() => saveFailureShot(page, 'web-e2e-pdf-upload-command-gate'))
    const input = page.locator('[data-composer-input]').first()
    await attachDraftPdf()
    await writeComposerDraft(page, input, '/goal summarize the attached document')
    await input.press('Enter')

    // Enter adjudication refuses the command line: one notice toast, while the
    // draft text and the PDF chip both stay for the user to resolve.
    await page.getByRole('alert').filter({ hasText: REFUSAL }).waitFor({ timeout: 10_000 })
    await expect.poll(() => input.textContent()).toContain('/goal summarize the attached document')
    await expect.poll(() => page.locator('[role="group"][aria-label="Pending attachments"]').count())
      .toBe(1)

    // Nothing left the composer: no prompt was admitted, no session event logged.
    expect(sessionEvents.flatMap(e => e.type === 'user/message' ? [e] : [])).toEqual([])
    expect(turnEndReasons(sessionEvents)).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'ui.expected.md', 'workspace.expected'])
  })
})
