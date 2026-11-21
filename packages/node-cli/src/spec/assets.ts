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

const MARKER = join('spec', 'rules.json');
const MAX_ASCENT = 6;

let cachedRoot: string | null = null;

/**
 * Where to start probing from.
 *
 * Resolved lazily and defensively. An embedder that bundles this package into CommonJS — the VS
 * Code extension does, because the extension host loads CommonJS — leaves `import.meta` as an
 * empty object, and computing this at module scope would throw while the module was still being
 * initialised. Such an embedder is expected to call `setAssetRoot()`, so the fallback only has to
 * be harmless, not clever.
 */
function moduleDirectory(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

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

  for (const root of candidateRoots(moduleDirectory())) {
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

/**
 * Points the loader at a specific assets directory.
 *
 * An embedder that ships its own copy — the VS Code extension bundles one inside the VSIX — calls
 * this once at startup. It exists so an embedder does not have to set `EGEHAN_SPEC_DIR`: mutating
 * `process.env` inside an extension host changes the environment for every other extension
 * sharing that process, which is not a side effect a library should ask for.
 */
export function setAssetRoot(directory: string): void {
  const absolute = resolve(directory);
  if (!existsSync(join(absolute, MARKER))) {
    throw new Error(`"${absolute}" has no ${MARKER}, so it is not a core-spec directory.`);
  }
  cachedRoot = absolute;
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
