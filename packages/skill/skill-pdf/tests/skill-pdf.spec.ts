import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillPdf from '@deepseek-ai/dsh-skill-pdf'

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
})
