#!/usr/bin/env node
/**
 * The gate between `npm run build` and `npm publish`.
 *
 * Two jobs. It removes the source maps, because the package ships compiled JavaScript but not the
 * TypeScript sources: a `.js.map` in the tarball points at files that are not there, so a
 * debugger would report "source not found" where it previously reported nothing. (The `files`
 * allowlist in package.json wins over `.npmignore`, so this is done by deleting them rather than
 * by ignoring them.)
 *
 * And it refuses to publish an incomplete package. Every one of these has a failure mode that
 * only shows up after release, on somebody else's machine: a missing rules file turns every
 * command into a crash, a missing README turns the npm page blank, a missing dictionary makes the
 * tool refuse the language it was installed for.
 */

import { readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED = [
  'dist/cli/main.js',
  'dist/index.js',
  'dist/index.d.ts',
  'assets/spec/rules.json',
  'assets/dictionary/narratives.tr.json',
  'assets/dictionary/narratives.en.json',
  'assets/templates/egehan-book.html',
  'assets/templates/hook.sh',
  'README.md',
  'LICENSE',
];

let removed = 0;

const stripMaps = (directory) => {
  if (!existsSync(directory)) return;

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      stripMaps(path);
    } else if (path.endsWith('.map')) {
      rmSync(path);
      removed += 1;
    }
  }
};

stripMaps(join(ROOT, 'dist'));

const missing = REQUIRED.filter((file) => !existsSync(join(ROOT, file)));

if (missing.length > 0) {
  console.error('\nThe package is incomplete and must not be published:\n');
  for (const file of missing) console.error(`  missing  ${file}`);
  console.error('\nRun `npm run build -w egehan` and try again.\n');
  process.exit(1);
}

// The dictionaries are discovered at runtime, so an empty directory is a package that installs
// fine and then refuses every language.
const languages = readdirSync(join(ROOT, 'assets', 'dictionary')).filter((file) =>
  /^narratives\.[a-z]{2}.*\.json$/.test(file),
);

if (languages.length < 2) {
  console.error(`\nOnly ${languages.length} dictionary file(s) were packed. Expected at least two.\n`);
  process.exit(1);
}

console.log(
  `package: ${REQUIRED.length} required file(s) present, ${languages.length} language(s), ` +
    `${removed} source map(s) removed`,
);
