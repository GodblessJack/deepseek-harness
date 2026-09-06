#!/usr/bin/env node
/**
 * Mount-check for the kb-updater agent preset: boot the base bundle plus the
 * agent-presets roster over a scratch root under this leaf, list the roster,
 * and ensure the kb-updater standing mount (`standingKeyFor` mounts the subtree
 * without starting an agent, session, or turn). Exit 0 when kb-updater lists
 * healthy and mounts; exit 1 with the reason otherwise.
 *
 * Usage: node examples/grid-ops-agent/kb-updater/check-preset-mount.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boot, loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'

const repoRoot = resolve(import.meta.dirname, '../../../')
const basePatchFile = join(repoRoot, 'packages/bundle/base/cordis.patch.yml')
const shippedPresets = join(repoRoot, 'apps/cli/config/agent-presets')
// Bare plugin specifiers resolve from the harness home's flat profile fallback
// (`$DSH_HOME/profiles/node_modules`, one symlink per workspace package) — the
// same base every real profile's compositions resolve through.
const profileFallback = process.env.DSH_HOME !== undefined
  ? join(process.env.DSH_HOME, 'profiles/node_modules')
  : join(process.env.HOME ?? '', '.dsh/profiles/node_modules')
// The scratch root must sit under $DSH_HOME/profiles: the preset subtree
// resolves bare plugin names against the HOST composition's baseUrl (this
// scratch dir), whose parent-level `node_modules` is the flat fallback every
// real profile resolves through.
const scratch = mkdtempSync(join(dirname(profileFallback), '.kb-updater-mount-check-'))
let exitCode = 1

try {
  writeFileSync(join(scratch, 'cordis.yml'), '# scratch profile root — an empty entry list\n[]\n')
  const patches = [
    ...(loadOptionalPatches('kb-updater-check', basePatchFile) ?? []),
    {
      insert: [{
        id: 'agent-presets',
        name: '@deepseek-ai/dsh-agent-presets',
        config: { default: 'standard', roots: [{ path: shippedPresets, trust: 'system' }] },
      }],
    },
  ]
  const ctx = await boot('kb-updater-check', join(scratch, 'cordis.yml'), patches, undefined, pathToFileURL(profileFallback).href)
  try {
    const roster = ctx.get('agentPresets')
    if (roster === undefined) throw new Error('agentPresets service did not activate')
    const presets = await roster.list()
    console.log(`roster: ${presets.map(p => `${p.id}${p.broken === undefined ? '' : ` (broken: ${p.broken})`}`).join(', ')}`)
    const preset = presets.find(p => p.id === 'kb-updater')
    if (preset === undefined) throw new Error('preset kb-updater is not on the roster')
    if (preset.broken !== undefined) throw new Error(`preset kb-updater is broken: ${preset.broken}`)
    await roster.standingKeyFor('kb-updater')
    console.log('kb-updater: listed healthy and standing mount ensured')
    exitCode = 0
  } finally {
    await ctx.fiber.dispose()
  }
} catch (error) {
  console.error(`kb-updater mount check failed: ${error instanceof Error ? error.stack : String(error)}`)
  let cause = error instanceof Error ? error.cause : undefined
  while (cause !== undefined && cause !== null) {
    console.error(`  cause: ${cause instanceof Error ? cause.stack : String(cause)}`)
    for (const detail of cause instanceof AggregateError ? cause.errors : []) {
      console.error(`    entry: ${detail instanceof Error ? detail.message : String(detail)}`)
    }
    cause = cause instanceof Error ? cause.cause : undefined
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
  process.exit(exitCode)
}
