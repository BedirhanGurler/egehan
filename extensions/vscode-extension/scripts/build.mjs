#!/usr/bin/env node
/**
 * Builds the VSIX payload: the core-spec assets, then a single bundled CommonJS file.
 *
 * The extension bundles rather than shipping node_modules. In a monorepo the `egehan` dependency
 * is a symlink, which a packed VSIX cannot carry, and the extension host loads CommonJS while
 * `egehan` is ESM — esbuild settles both. A build tool is a reasonable dependency for a build;
 * the published CLI's promise of a single runtime dependency is unaffected.
 */

import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SPEC = join(ROOT, '..', '..', 'packages', 'core-spec');
const ASSETS = join(ROOT, 'assets');

const assetsOnly = process.argv.includes('--assets-only');

rmSync(ASSETS, { recursive: true, force: true });
mkdirSync(ASSETS, { recursive: true });
for (const directory of ['spec', 'dictionary', 'schema', 'templates']) {
  cpSync(join(SPEC, directory), join(ASSETS, directory), { recursive: true });
}
console.log('assets: copied from @egehan/core-spec');

if (assetsOnly) process.exit(0);

// esbuild bundles the library from its build output, so a stale or missing dist would silently
// produce an extension running last week's engine.
const library = join(ROOT, '..', '..', 'packages', 'node-cli', 'dist', 'index.js');
if (!existsSync(library)) {
  console.error('The egehan package has not been built. Run `npm run build -w egehan` first.');
  process.exit(1);
}

/**
 * The pure core, transpiled on its own so the test suite can import it without VS Code.
 *
 * Everything in src/core avoids importing `vscode` precisely so that its behaviour — the status
 * bar text, the milestone diffing, the webview hardening — can be tested in plain Node, which is
 * the only place this project has to test it.
 */
await build({
  entryPoints: [
    join(ROOT, 'src', 'core', 'settings.ts'),
    join(ROOT, 'src', 'core', 'statusBar.ts'),
    join(ROOT, 'src', 'core', 'milestones.ts'),
    join(ROOT, 'src', 'core', 'webviewHtml.ts'),
  ],
  outdir: join(ROOT, 'dist', 'core'),
  bundle: false,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
});
// The package itself is CommonJS, so the ESM output needs its own declaration.
writeFileSync(join(ROOT, 'dist', 'core', 'package.json'), '{ "type": "module" }\n', 'utf8');

await build({
  entryPoints: [join(ROOT, 'src', 'extension.ts')],
  outfile: join(ROOT, 'dist', 'extension.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // `vscode` is provided by the host and must never be bundled.
  external: ['vscode'],
  sourcemap: true,
  // Readable stack traces matter more than a few kilobytes in a tool nobody runs in a hot loop.
  minify: false,
  logLevel: 'info',
  // `import.meta` is empty in a CommonJS bundle. The one place the library reads it is guarded
  // and falls back, and the extension calls setAssetRoot() before anything needs it, so the
  // warning is noise rather than a finding.
  logOverride: { 'empty-import-meta': 'silent' },
});
