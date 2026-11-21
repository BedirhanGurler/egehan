import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { availableLanguages } from '../spec/dictionary.js';
import type { EgehanRules } from '../spec/rules.js';
import type { Language, Tone } from '../engine/types.js';

/**
 * `.egehanrc.json` — the per-project settings file.
 *
 * Validation is strict and the messages name the offending key and the accepted values. A config
 * file is edited by hand, usually months after it was written, and "invalid configuration" with no
 * further detail is how a tool teaches people to delete the file and start over.
 *
 * Note what is *not* here: nothing that would change the narration for one machine but not
 * another. Language and tone are project-wide decisions recorded in the file, so two developers
 * running the tool on the same repository produce the same chronicle.
 */

export const TONES: readonly Tone[] = ['poetic', 'minimalist', 'humorous'];
/**
 * Output formats.
 *
 * `both` means the two artifacts a project keeps — the Markdown chronicle and the interactive
 * HTML timeline. The JSON report is a separate opt-in because it is the machine format: it carries
 * the generation timestamp and is meant for tooling, not for reading.
 */
export const FORMATS = ['md', 'html', 'json', 'both', 'all'] as const;
export type OutputFormat = (typeof FORMATS)[number];
export const THEMES = ['auto', 'light', 'dark'] as const;
export type ChronicleTheme = (typeof THEMES)[number];

export interface EgehanConfig {
  readonly projectName: string | null;
  /** Opt-in, free text, never generated. Empty in this repository by design. */
  readonly dedication: string | null;
  readonly language: Language;
  readonly tone: Tone;
  readonly theme: ChronicleTheme;
  readonly redactEmails: boolean;
  readonly anonymizeAuthors: boolean;
  readonly includeMergeCommits: boolean;
  readonly format: OutputFormat;
  readonly output: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function defaultConfig(rules: EgehanRules): EgehanConfig {
  return {
    projectName: null,
    dedication: null,
    language: 'en',
    tone: 'poetic',
    theme: 'auto',
    // The privacy default comes from the rules file, not from this code, so it is reviewable in
    // one place alongside the reason it exists.
    redactEmails: rules.privacy.redactEmailsByDefault,
    anonymizeAuthors: false,
    includeMergeCommits: false,
    format: 'both',
    output: '.',
  };
}

export function configPath(root: string, rules: EgehanRules): string {
  return join(root, rules.output.configFileName);
}

export function configExists(root: string, rules: EgehanRules): boolean {
  return existsSync(configPath(root, rules));
}

/** Reads `.egehanrc.json` when present, merged over the defaults. */
export function loadConfig(root: string, rules: EgehanRules): EgehanConfig {
  const path = configPath(root, rules);
  if (!existsSync(path)) return defaultConfig(rules);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`${rules.output.configFileName} is not valid JSON: ${reason}`);
  }

  return mergeConfig(defaultConfig(rules), parsed, rules.output.configFileName);
}

/** Applies a partial object (a config file or CLI flags) over a base config, validating as it goes. */
export function mergeConfig(base: EgehanConfig, patch: unknown, source: string): EgehanConfig {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ConfigError(`${source} must contain a JSON object`);
  }

  const raw = patch as Record<string, unknown>;
  const known = new Set<keyof EgehanConfig>([
    'projectName',
    'dedication',
    'language',
    'tone',
    'theme',
    'redactEmails',
    'anonymizeAuthors',
    'includeMergeCommits',
    'format',
    'output',
  ]);

  for (const key of Object.keys(raw)) {
    if (key.startsWith('$')) continue;
    if (!known.has(key as keyof EgehanConfig)) {
      throw new ConfigError(
        `${source} has an unknown setting "${key}". Known settings: ${[...known].join(', ')}.`,
      );
    }
  }

  return {
    projectName: optionalString(raw, 'projectName', base.projectName, source),
    dedication: optionalString(raw, 'dedication', base.dedication, source),
    language: oneOf(raw, 'language', base.language, availableLanguages(), source) as Language,
    tone: oneOf(raw, 'tone', base.tone, TONES, source) as Tone,
    theme: oneOf(raw, 'theme', base.theme, THEMES, source) as ChronicleTheme,
    redactEmails: boolean(raw, 'redactEmails', base.redactEmails, source),
    anonymizeAuthors: boolean(raw, 'anonymizeAuthors', base.anonymizeAuthors, source),
    includeMergeCommits: boolean(raw, 'includeMergeCommits', base.includeMergeCommits, source),
    format: oneOf(raw, 'format', base.format, FORMATS, source) as OutputFormat,
    output: requiredString(raw, 'output', base.output, source),
  };
}

function optionalString(
  raw: Record<string, unknown>,
  key: string,
  fallback: string | null,
  source: string,
): string | null {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value !== 'string') throw new ConfigError(`${source}: "${key}" must be a string or null`);
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function requiredString(raw: Record<string, unknown>, key: string, fallback: string, source: string): string {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`${source}: "${key}" must be a non-empty string`);
  }
  return value.trim();
}

function boolean(raw: Record<string, unknown>, key: string, fallback: boolean, source: string): boolean {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new ConfigError(`${source}: "${key}" must be true or false`);
  return value;
}

function oneOf(
  raw: Record<string, unknown>,
  key: string,
  fallback: string,
  allowed: readonly string[],
  source: string,
): string {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ConfigError(`${source}: "${key}" must be one of ${allowed.join(', ')}`);
  }
  return value;
}

/** Serializes a config for `.egehanrc.json`, with a pointer to the schema for editors. */
export function serializeConfig(config: EgehanConfig): string {
  const body = {
    $schema: 'https://github.com/bedirhangurler/egehan/schema/egehanrc.schema.json',
    projectName: config.projectName,
    dedication: config.dedication,
    language: config.language,
    tone: config.tone,
    theme: config.theme,
    redactEmails: config.redactEmails,
    anonymizeAuthors: config.anonymizeAuthors,
    includeMergeCommits: config.includeMergeCommits,
    format: config.format,
    output: config.output,
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}
