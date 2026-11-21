import { readFileSync } from 'node:fs';

/**
 * The CLI's own version, read from its package.json at runtime rather than written into the
 * source. A version constant in code is a constant somebody forgets to bump, and it would then
 * lie inside every chronicle the release produced.
 */
let cached: string | null = null;

export function packageVersion(): string {
  if (cached !== null) return cached;

  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: unknown;
    };
    cached = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch {
    cached = '0.0.0';
  }

  return cached;
}
