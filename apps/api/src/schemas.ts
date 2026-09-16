import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const SECRET_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,120}$/;

/**
 * `config` stays `z.unknown()` here: the step-program shape is validated by
 * `validateScrapeConfig` in `@scraper/shared`, not reimplemented in Zod. See
 * the README's step verb table for its real shape.
 */
const scrapeConfigSchema = z.unknown().openapi({
  description: 'A v2 step program. See the README "Scrape definitions" section.',
  type: 'object',
});

export const CreateDefinitionBody = z
  .object({
    name: z.string().min(1),
    url: z.string().min(1),
    config: scrapeConfigSchema,
  })
  .openapi('CreateDefinitionBody');

export const UpdateDefinitionBody = z
  .object({
    name: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    config: scrapeConfigSchema.optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined || body.url !== undefined || body.config !== undefined,
    {
      message: 'one of name, url and config is required',
    },
  )
  .openapi('UpdateDefinitionBody');

export const CreateRunBody = z
  .object({
    definitionId: z.string().min(1),
    trigger: z.enum(['MANUAL', 'API']).optional(),
  })
  .openapi('CreateRunBody');

export const CreateSecretBody = z
  .object({
    name: z.string().regex(SECRET_NAME_PATTERN),
    value: z.string().min(1),
  })
  .openapi('CreateSecretBody');

const dateTime = z.string().openapi({ format: 'date-time' });

export const ScrapeDefinitionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    config: scrapeConfigSchema,
    created_at: dateTime,
    deleted_at: dateTime.nullable(),
  })
  .openapi('ScrapeDefinition');

export const ScrapeRunSchema = z
  .object({
    id: z.string(),
    definition_id: z.string(),
    status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']),
    trigger: z.enum(['MANUAL', 'API']),
    created_at: dateTime,
    started_at: dateTime.nullable(),
    finished_at: dateTime.nullable(),
  })
  .openapi('ScrapeRun');

export const ScrapeRunAttemptSchema = z
  .object({
    id: z.string(),
    run_id: z.string(),
    attempt_number: z.number().int(),
    status: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED']),
    worker_id: z.string().nullable(),
    error_code: z.string().nullable(),
    error_message: z.string().nullable(),
    started_at: dateTime,
    heartbeat_at: dateTime.nullable(),
    finished_at: dateTime.nullable(),
  })
  .openapi('ScrapeRunAttempt');

export const ArtifactSchema = z
  .object({
    id: z.string(),
    run_id: z.string(),
    type: z.enum(['JSON', 'CSV', 'PNG', 'HTML', 'WEBM', 'PDF']),
    name: z.string().nullable(),
    step_index: z.number().int().nullable(),
    object_key: z.string(),
    content_type: z.string(),
    size_bytes: z.number().int(),
    created_at: dateTime,
  })
  .openapi('Artifact');

export const RunDetailSchema = ScrapeRunSchema.extend({
  attempts: z.array(ScrapeRunAttemptSchema),
  artifacts: z.array(ArtifactSchema),
}).openapi('RunDetail');

export const SecretMetaSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    created_at: dateTime,
    updated_at: dateTime,
  })
  .openapi('SecretMeta');

export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export const ErrorResponseSchema = z
  .object({ error: z.string() })
  .openapi('ErrorResponse');
