import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Smoke-testing the packaged bundle.
 *
 * VS Code cannot be run here, so this is as close as the suite gets to the real thing: load the
 * exact CommonJS file the extension host would load, with `vscode` stubbed, and check it
 * initialises and exports what the manifest promises.
 *
 * It exists because of a real failure. The library resolved its own location through
 * `import.meta.url`, which esbuild leaves as an empty object in a CommonJS bundle — so the
 * extension threw while its modules were still initialising, long before any test of the source
 * would have noticed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BUNDLE = join(ROOT, 'dist', 'extension.cjs');

/** Loads the bundle with a stub standing in for the editor API. */
function loadBundle(stub = {}) {
  const require = createRequire(import.meta.url);
  const loader = Module;
  const original = loader._load;

  loader._load = function patched(request, parent, isMain) {
    if (request === 'vscode') return stub;
    return original.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve(BUNDLE)];
    return require(BUNDLE);
  } finally {
    loader._load = original;
  }
}

test('the bundle exists and was built from the current source', () => {
  assert.ok(existsSync(BUNDLE), 'run `npm run build` first');
  assert.ok(existsSync(join(ROOT, 'assets', 'spec', 'rules.json')), 'the spec assets were not copied');
  assert.ok(existsSync(join(ROOT, 'assets', 'templates', 'egehan-book.html')));
});

test('the bundle loads without throwing, and exports the entry points', () => {
  const extension = loadBundle();

  assert.equal(typeof extension.activate, 'function');
  assert.equal(typeof extension.deactivate, 'function');
});

test('deactivate is safe to call before activate', () => {
  // VS Code calls deactivate on shutdown whatever happened during activation, including a
  // failure, so it must not assume anything was set up.
  const extension = loadBundle();
  assert.doesNotThrow(() => extension.deactivate());
});

test('only the editor API is left external; the library is inlined', () => {
  const source = readFileSync(BUNDLE, 'utf8');

  const requires = [...source.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1]);
  const bare = [...new Set(requires.filter((name) => !name.startsWith('.') && !name.startsWith('/')))];

  for (const name of bare) {
    const allowed = name === 'vscode' || name.startsWith('node:');
    assert.ok(allowed, `the bundle requires "${name}", which a VSIX would not ship`);
  }
  assert.ok(bare.includes('vscode'));
  assert.equal(bare.includes('egehan'), false, 'the library must be bundled, not required');
  assert.equal(bare.includes('commander'), false, 'the CLI’s argument parser has no business here');
});

test('the manifest and the bundle agree about the entry point and the commands', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const source = readFileSync(BUNDLE, 'utf8');

  assert.equal(manifest.main, './dist/extension.cjs');

  for (const command of manifest.contributes.commands) {
    assert.ok(
      source.includes(`"${command.command}"`),
      `the manifest contributes ${command.command}, which the bundle never registers`,
    );
  }

  // Every setting the manifest advertises must actually be read.
  const settings = Object.keys(manifest.contributes.configuration.properties).map((key) =>
    key.replace(/^egehan\./, ''),
  );
  for (const setting of settings) {
    assert.ok(source.includes(`"${setting}"`), `the manifest advertises ${setting}, which nothing reads`);
  }
});

test('the extension declares what it cannot do in an untrusted or virtual workspace', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  // Running git and reading a project's config is not something to do in a folder the user has
  // not trusted.
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported, false);
  assert.equal(manifest.capabilities.virtualWorkspaces.supported, false);
  assert.ok(manifest.capabilities.untrustedWorkspaces.description.length > 20);
});

test('the icon is a real PNG of the size the marketplace expects', () => {
  const icon = readFileSync(join(ROOT, 'media', 'icon.png'));

  assert.deepEqual([...icon.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(icon.readUInt32BE(16), 128, 'the marketplace wants at least 128×128');
  assert.equal(icon.readUInt32BE(20), 128);
});
