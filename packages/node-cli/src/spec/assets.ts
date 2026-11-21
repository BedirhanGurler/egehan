import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locates the core-spec assets at runtime.
 *
 * In a published install they sit in this package's `assets/` directory, copied there at build
 * time by scripts/sync-spec.mjs. Inside the monorepo during development they may not have been
 * synced yet, so `packages/core-spec` is probed as a fallback. Both layouts are supported
 * deliberately: a contributor who runs the CLI straight after a clone should get working output
 * rather than a missing-file error they have to learn the build graph to understand.
 */

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const MARKER = join('spec', 'rules.json');
const MAX_ASCENT = 6;

let cachedRoot: string | null = null;

const candidateRoots = (start: string): string[] => {
  const roots: string[] = [];
  let current = start;

  for (let level = 0; level <= MAX_ASCENT; level += 1) {
    roots.push(join(current, 'assets'));
    roots.push(join(current, 'packages', 'core-spec'));
    roots.push(join(current, '..', 'core-spec'));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return roots;
};

/** Absolute path of the directory holding `spec/`, `dictionary/` and `templates/`. */
export function assetRoot(): string {
  if (cachedRoot !== null) return cachedRoot;

  const override = process.env['EGEHAN_SPEC_DIR'];
  if (override !== undefined && override !== '') {
    const absolute = resolve(override);
    if (!existsSync(join(absolute, MARKER))) {
      throw new Error(
        `EGEHAN_SPEC_DIR points at "${absolute}", which has no ${MARKER}. ` +
          'It must point at a core-spec directory.',
      );
    }
    cachedRoot = absolute;
    return absolute;
  }

  for (const root of candidateRoots(MODULE_DIR)) {
    if (existsSync(join(root, MARKER))) {
      cachedRoot = resolve(root);
      return cachedRoot;
    }
  }

  throw new Error(
    'Could not locate the Egehan spec assets. Inside the repository, run ' +
      '`npm run sync-spec -w egehan`; in an installed package this means the tarball is incomplete.',
  );
}

export function assetPath(...segments: string[]): string {
  return join(assetRoot(), ...segments);
}

export function readAssetJson<T>(...segments: string[]): T {
  const path = assetPath(...segments);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read the spec asset "${path}": ${reason}`);
  }
}
