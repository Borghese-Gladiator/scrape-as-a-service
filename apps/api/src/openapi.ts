import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  ArtifactSchema,
  CreateDefinitionBody,
  CreateRunBody,
  CreateSecretBody,
  ErrorResponseSchema,
  RunDetailSchema,
  ScrapeDefinitionSchema,
  ScrapeRunSchema,
  SecretMetaSchema,
  UpdateDefinitionBody,
  pageOf,
} from './schemas.js';

const API_KEY_HEADER = 'X-API-Key';

function jsonBody<T extends z.ZodTypeAny>(schema: T) {
  return { content: { 'application/json': { schema } } };
}

function errorResponse(description: string) {
  return { description, ...jsonBody(ErrorResponseSchema) };
}

/**
 * Every route's request body and response shape come from the same Zod
 * schemas that `parseBody` validates against at runtime, so this document
 * cannot drift from what the API actually accepts.
 */
export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'apiKey', {
    type: 'apiKey',
    in: 'header',
    name: API_KEY_HEADER,
  });
  const security = [{ apiKey: [] }];

  registry.registerPath({
    method: 'get',
    path: '/health',
    summary: 'Liveness check. Needs no API key.',
    responses: { 200: jsonBody(z.object({ status: z.literal('ok') })) },
  });

  registry.registerPath({
    method: 'get',
    path: '/definitions',
    summary: 'One page of definitions.',
    security,
    responses: {
      200: { description: 'OK', ...jsonBody(pageOf(ScrapeDefinitionSchema)) },
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/definitions/{id}',
    summary: 'One definition. A soft-deleted one still answers.',
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'OK', ...jsonBody(ScrapeDefinitionSchema) },
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/definitions',
    summary: 'Create. Accepts a v2 step program.',
    security,
    request: { body: jsonBody(CreateDefinitionBody) },
    responses: {
      201: { description: 'Created', ...jsonBody(ScrapeDefinitionSchema) },
      400: errorResponse('Invalid body, URL, or step program'),
    },
  });
  registry.registerPath({
    method: 'put',
    path: '/definitions/{id}',
    summary: 'Update name, url, or config. Each is optional.',
    security,
    request: {
      params: z.object({ id: z.string() }),
      body: jsonBody(UpdateDefinitionBody),
    },
    responses: {
      200: { description: 'OK', ...jsonBody(ScrapeDefinitionSchema) },
      400: errorResponse('Invalid body'),
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/definitions/{id}',
    summary: 'Soft delete. Runs and artifacts stay readable.',
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: { 204: { description: 'Deleted' }, 404: errorResponse('Not found') },
  });

  registry.registerPath({
    method: 'get',
    path: '/runs',
    summary: 'One page of runs. Takes ?definitionId= and ?status=.',
    security,
    responses: { 200: { description: 'OK', ...jsonBody(pageOf(ScrapeRunSchema)) } },
  });
  registry.registerPath({
    method: 'get',
    path: '/runs/{id}',
    summary: 'The run, its attempts, and its artifacts.',
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'OK', ...jsonBody(RunDetailSchema) },
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/runs',
    summary: 'Trigger a run.',
    security,
    request: { body: jsonBody(CreateRunBody) },
    responses: {
      201: { description: 'Created', ...jsonBody(ScrapeRunSchema) },
      400: errorResponse('Invalid body'),
      404: errorResponse('Definition not found'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/runs/{id}/cancel',
    summary: 'Cancel a QUEUED or RUNNING run.',
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'OK', ...jsonBody(ScrapeRunSchema) },
      404: errorResponse('Not found'),
      409: errorResponse('Already terminal'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/runs/{id}/rerun',
    summary: 'Start a new run from the same definition.',
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      201: { description: 'Created', ...jsonBody(ScrapeRunSchema) },
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/runs/{runId}/artifacts',
    summary: 'The artifact rows of a run.',
    security,
    request: { params: z.object({ runId: z.string() }) },
    responses: { 200: { description: 'OK', ...jsonBody(z.array(ArtifactSchema)) } },
  });
  registry.registerPath({
    method: 'get',
    path: '/runs/{runId}/artifacts.zip',
    summary: 'Every artifact of a run, as a streaming archive.',
    security,
    request: { params: z.object({ runId: z.string() }) },
    responses: {
      200: {
        description: 'A zip archive',
        content: { 'application/zip': { schema: z.string() } },
      },
      404: errorResponse('Not found, or the run has no artifacts'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/artifacts/{id}/download',
    summary: 'One artifact.',
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'The artifact bytes' },
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/artifacts/{id}/url',
    summary: 'A short-lived presigned download URL.',
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: 'OK',
        ...jsonBody(z.object({ url: z.string(), expiresInSeconds: z.number() })),
      },
      404: errorResponse('Not found'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/secrets',
    summary: 'List secret names. Never returns a value.',
    security,
    responses: { 200: { description: 'OK', ...jsonBody(z.array(SecretMetaSchema)) } },
  });
  registry.registerPath({
    method: 'post',
    path: '/secrets',
    summary: 'Store a secret, encrypted at rest.',
    security,
    request: { body: jsonBody(CreateSecretBody) },
    responses: {
      201: { description: 'Created', ...jsonBody(SecretMetaSchema) },
      400: errorResponse('Invalid body'),
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/secrets/{id}',
    summary: 'Remove a secret.',
    security,
    request: { params: z.object({ id: z.string() }) },
    responses: { 204: { description: 'Deleted' }, 404: errorResponse('Not found') },
  });

  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: { title: 'Scrape-as-a-Service API', version: '1.0.0' },
  });
}
