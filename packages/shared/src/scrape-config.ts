export type ArtifactType = 'JSON' | 'CSV' | 'PNG' | 'HTML' | 'WEBM';

export const ARTIFACT_TYPES: readonly ArtifactType[] = ['JSON', 'CSV', 'PNG', 'HTML', 'WEBM'];

export interface ScrapeFieldSelector {
  name: string;
  selector: string;
  attribute?: string;
}

export interface ScrapeConfig {
  waitFor?: string;
  rowSelector?: string;
  fields: ScrapeFieldSelector[];
  artifacts: ArtifactType[];
}

export interface ScrapeResult {
  rows: Record<string, string | null>[];
  html?: string;
  screenshot?: Buffer;
  recording?: Buffer;
}

class ScrapeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScrapeConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArtifactType(value: unknown): value is ArtifactType {
  return typeof value === 'string' && (ARTIFACT_TYPES as readonly string[]).includes(value);
}

/**
 * Validate/parse a declarative scrape config. Rejects arbitrary JS: only
 * whitelisted CSS-selector-based fields and a fixed set of artifact types
 * are permitted.
 */
export function validateScrapeConfig(input: unknown): ScrapeConfig {
  if (!isRecord(input)) {
    throw new ScrapeConfigError('Scrape config must be an object');
  }

  const { waitFor, rowSelector, fields, artifacts } = input;

  if (waitFor !== undefined && typeof waitFor !== 'string') {
    throw new ScrapeConfigError('waitFor must be a string when provided');
  }
  if (rowSelector !== undefined && typeof rowSelector !== 'string') {
    throw new ScrapeConfigError('rowSelector must be a string when provided');
  }

  if (!Array.isArray(fields) || fields.length === 0) {
    throw new ScrapeConfigError('fields must be a non-empty array');
  }

  const parsedFields: ScrapeFieldSelector[] = fields.map((field, index) => {
    if (!isRecord(field)) {
      throw new ScrapeConfigError(`fields[${index}] must be an object`);
    }
    const { name, selector, attribute } = field;
    if (typeof name !== 'string' || name.length === 0) {
      throw new ScrapeConfigError(`fields[${index}].name must be a non-empty string`);
    }
    if (typeof selector !== 'string' || selector.length === 0) {
      throw new ScrapeConfigError(`fields[${index}].selector must be a non-empty string`);
    }
    if (attribute !== undefined && typeof attribute !== 'string') {
      throw new ScrapeConfigError(`fields[${index}].attribute must be a string when provided`);
    }
    return attribute === undefined ? { name, selector } : { name, selector, attribute };
  });

  if (!Array.isArray(artifacts)) {
    throw new ScrapeConfigError('artifacts must be an array');
  }
  const parsedArtifacts: ArtifactType[] = artifacts.map((artifact, index) => {
    if (!isArtifactType(artifact)) {
      throw new ScrapeConfigError(
        `artifacts[${index}] must be one of ${ARTIFACT_TYPES.join(', ')}`,
      );
    }
    return artifact;
  });

  const config: ScrapeConfig = {
    fields: parsedFields,
    artifacts: parsedArtifacts,
  };
  if (waitFor !== undefined) config.waitFor = waitFor;
  if (rowSelector !== undefined) config.rowSelector = rowSelector;
  return config;
}
