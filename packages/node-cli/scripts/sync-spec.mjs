#!/usr/bin/env node
/**
 * Copies the language-agnostic contract from @egehan/core-spec into this package's assets/
 * directory, which is what ends up in the published tarball.
 *
 * The assets are generated rather than committed on purpose: core-spec is the single source of
 * truth (see docs/ARCHITECTURE.md, ADR-001), and a committed copy is a second source of truth
 * waiting to drift. `--check` performs the drift comparison without writing, which is what CI runs.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..');
const SPEC_ROOT = join(PACKAGE_ROOT, '..', 'core-spec');
const TARGET_ROOT = join(PACKAGE_ROOT, 'assets');

/** Directories copied verbatim. Fixtures stay out: they are test data, not runtime assets. */
const COPIED = ['spec', 'dictionary', 'schema', 'templates'];

const checkOnly = process.argv.includes('--check');

const listFiles = (root, base = root) => {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const full = join(root, name);
    return statSync(full).isDirectory() ? listFiles(full, base) : [relative(base, full)];
  });
};

let copied = 0;
const drifted = [];

for (const directory of COPIED) {
  const source = join(SPEC_ROOT, directory);
  if (!existsSync(source)) {
    console.error(`sync-spec: ${relative(PACKAGE_ROOT, source)} does not exist`);
    process.exit(1);
  }

  for (const file of listFiles(source)) {
    const from = join(source, file);
    const to = join(TARGET_ROOT, directory, file);
    const content = readFileSync(from);

    if (checkOnly) {
      if (!existsSync(to) || !readFileSync(to).equals(content)) {
        drifted.push(join('assets', directory, file));
      }
      continue;
    }

    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, content);
    copied += 1;
  }
}

if (checkOnly) {
  if (drifted.length > 0) {
    console.error('sync-spec: assets have drifted from @egehan/core-spec:\n');
    for (const file of drifted) console.error(`  ${file}`);
    console.error('\nRun `npm run sync-spec -w egehan` and commit nothing — assets/ is generated.\n');
    process.exit(1);
  }
  console.log('sync-spec: assets match @egehan/core-spec');
} else {
  console.log(`sync-spec: ${copied} asset file(s) in sync with @egehan/core-spec`);
}
