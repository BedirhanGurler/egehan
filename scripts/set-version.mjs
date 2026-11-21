#!/usr/bin/env node
/**
 * Sets one version across all three manifests.
 *
 * The release workflow refuses to publish when the npm package, the VS Code extension and the
 * NuGet project disagree with the tag. That guard exists because bumping three files by hand is
 * a thing people get right four times and wrong on the fifth — this script is how you avoid
 * finding out which release that was.
 *
 *   node scripts/set-version.mjs 0.2.0
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (version === undefined || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: node scripts/set-version.mjs <semver>   e.g. 0.2.0 or 1.0.0-rc.1');
  process.exit(1);
}

const manifests = [
  { path: 'packages/node-cli/package.json', kind: 'json', label: 'npm (egehan)' },
  { path: 'extensions/vscode-extension/package.json', kind: 'json', label: 'VS Code extension' },
  { path: 'packages/dotnet-tool/Directory.Build.props', kind: 'props', label: 'NuGet (Egehan.Cli)' },
];

for (const manifest of manifests) {
  const path = join(ROOT, manifest.path);
  const before = readFileSync(path, 'utf8');

  const pattern = manifest.kind === 'json' ? /("version":\s*")([^"]+)(")/ : /(<Version>)([^<]+)(<\/Version>)/;

  const match = pattern.exec(before);

  // "Not found" and "already correct" are different situations, and conflating them turns a
  // re-run into a failure that looks like a broken manifest.
  if (match === null) {
    console.error(`Could not find a version to set in ${manifest.path}`);
    process.exit(1);
  }

  const previous = match[2];
  if (previous !== version) writeFileSync(path, before.replace(pattern, `$1${version}$3`), 'utf8');

  console.log(
    `  ${version}  ${manifest.label}${previous === version ? '  (unchanged)' : `  (was ${previous})`}`,
  );
}

console.log(`\nAll three manifests are now ${version}.`);
console.log('Next: update CHANGELOG.md, commit, then tag — see RELEASING.md.');
