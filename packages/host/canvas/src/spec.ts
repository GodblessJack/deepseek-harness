/**
 * Durable storage-domain declaration for per-session canvas artifacts.
 * @module @deepseek-ai/dsh-host-canvas/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { CanvasArtifact, CanvasArtifactAttachment } from './types.ts'

/** Runtime schema for the closed artifact kind vocabulary. */
export const canvasArtifactKindSchema = z.union([
  z.literal('html'),
  z.literal('markdown'),
  z.literal('text'),
]) satisfies z.ZodType<CanvasArtifact['kind']>

/** Runtime schema for one artifact attachment record. */
export const canvasAttachmentSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  mediaType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
}) satisfies z.ZodType<CanvasArtifactAttachment>

/** Runtime schema for one artifact record persisted on disk. */
export const canvasArtifactSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  kind: canvasArtifactKindSchema,
  content: z.string(),
  updatedAt: z.string(),
  attachments: z.array(canvasAttachmentSchema).readonly().optional(),
}) satisfies z.ZodType<CanvasArtifact>

/** Runtime schema for one whole-Session canvas bucket. */
export const canvasBucketRowSchema = z.object({
  artifacts: z.array(canvasArtifactSchema),
  selected: z.string().nullable(),
  rev: z.number().int().nonnegative(),
})

/** Durable bucket row inferred from {@link canvasBucketRowSchema}. */
export type CanvasBucketRow = z.infer<typeof canvasBucketRowSchema>

/** One whole-Session canvas bucket per Session id. */
export const canvasDomainSpec = defineDomain({
  name: 'canvas',
  version: 0,
  tables: {
    buckets: domainTable<string, CanvasBucketRow>(canvasBucketRowSchema),
  },
})
