/**
 * Bundled `pdf` skill provider.
 *
 * @module @deepseek-ai/dsh-skill-pdf
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'pdf'
const SKILL_BODY_URL = new URL('../assets/pdf.md', import.meta.url)
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const
const INVOCATION = { modelInvocable: true, userInvocable: false } as const
const DESCRIPTION = 'Extract text from PDF files: uploaded attachments under uploads/ or any workspace PDF. Use when a message shows "[attached file] ...pdf" or the user asks about a PDF.'
/* jscpd:ignore-start -- the bundled-provider block is the structural twin of dsh-skill-badge's immutable provider */
const CANDIDATE: SkillCandidate = {
  name: 'pdf',
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

/** Cordis plugin name. */
export const name = 'skill-pdf'
/** Service required by the bundled provider. */
export const inject = ['skills']

/** Register the bundled `pdf` provider on `ctx.skills`. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
/* jscpd:ignore-end */
