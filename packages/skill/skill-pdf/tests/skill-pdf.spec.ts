import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillPdf from '@deepseek-ai/dsh-skill-pdf'

const SCRIPT = fileURLToPath(new URL('../assets/scripts/pdf2text.py', import.meta.url))

/** Run pdf2text and capture its refusal; returns null when it unexpectedly succeeds. */
async function runRefusing(args: readonly string[]): Promise<{ code: number | null; stderr: string } | null> {
  return new Promise((resolve) => {
    execFile('python3', [SCRIPT, ...args], (error, _stdout, stderr) => {
      if (error === null) { resolve(null); return }
      const code = typeof (error as NodeJS.ErrnoException).code === 'number'
        ? (error as NodeJS.ErrnoException & { code: number }).code
        : null
      resolve({ code, stderr })
    })
  })
}

const DESCRIPTION = 'Extract text from PDF files: uploaded attachments under uploads/ or any workspace PDF. Use when a message shows "[attached file] ...pdf" or the user asks about a PDF.'

describe('dsh-skill-pdf', () => {
  it('registers the bundled pdf provider and serves the skill body', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillPdf)
    const resourcePath = fileURLToPath(new URL('../assets/', import.meta.url))

    expect(await ctx.skills.list()).toEqual([{
      name: 'pdf',
      description: DESCRIPTION,
      invocation: { modelInvocable: true, userInvocable: false },
      provider: 'pdf',
      source: 'bundled',
      resourceBase: { kind: 'directory', path: resourcePath },
    }])
    const loaded = await ctx.skills.get('pdf')
    expect(loaded?.content).toContain('pdf2text.py')
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: resourcePath })

    const script = await stat(join(resourcePath, 'scripts', 'pdf2text.py'))
    expect(script.isFile()).toBe(true)
  })

  it('disposes with the fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(SkillPdf)

    expect((await ctx.skills.list()).map(skill => skill.name)).toContain('pdf')

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it.each([
    ['--first', '0'],
    ['--first', '-3'],
    ['--last', '-1'],
  ])('pdf2text rejects %s %s before touching engines or the PDF', async (flag, value) => {
    // The guard runs before engine detection, so the rejection holds on hosts
    // with no pypdf/pdftotext installed; the PDF path itself is never read.
    const result = await runRefusing(['missing.pdf', flag, value])
    expect(result).not.toBeNull()
    expect(result?.code).toBe(1)
    expect(result?.stderr).toContain('must be >=')
  })
})
