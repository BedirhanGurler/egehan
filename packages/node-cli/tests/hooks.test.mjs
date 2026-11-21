import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
  realpathSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  hookBlock,
  hasBlock,
  withBlock,
  withoutBlock,
  BEGIN_MARKER,
  END_MARKER,
} from '../dist/hooks/block.js';
import {
  resolveHookTarget,
  installHooks,
  uninstallHooks,
  readHookStatus,
  lefthookSnippet,
  MANAGED_HOOKS,
} from '../dist/hooks/manager.js';
import { loadRules } from '../dist/spec/rules.js';

/**
 * Hook tests.
 *
 * These matter more than most: the failure mode lands in somebody else's repository, where a bad
 * hook can slow every commit, fight a rebase, or quietly delete the linter somebody else
 * installed. Most of what follows checks that Egehan does *not* do something.
 */

const rules = loadRules();
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'cli', 'main.js');
const VERSION = '9.9.9-test';

const temp = () => mkdtempSync(join(tmpdir(), 'egehan-hooks-'));

/**
 * Git runs hooks through its own bundled `sh`, which is not on the PATH of a Windows CI runner.
 * The tests that execute the script are therefore POSIX-only; everything that checks the text of
 * the script, and the install/uninstall file surgery, runs everywhere.
 */
const posixOnly =
  process.platform === 'win32'
    ? { skip: 'git hooks run under git’s own sh, which is not on PATH for the Windows runner' }
    : {};

/** A synchronous pause with no external process, so the tests run on every platform. */
const sleepSync = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

function makeRepository() {
  const root = temp();
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  run(['init', '-b', 'main']);
  run(['config', 'user.name', 'Ada']);
  run(['config', 'user.email', 'ada@example.com']);
  writeFileSync(join(root, 'package.json'), '{"name":"demo"}\n', 'utf8');
  run(['add', '-A']);
  run(['commit', '-m', 'chore: ilk commit']);
  return { root, run, context: { cwd: root, rules } };
}

/* ------------------------------------------------------------------ *
 * The block, as pure text surgery
 * ------------------------------------------------------------------ */

test('a hook that did not exist becomes a script with a shebang', () => {
  const result = withBlock('', hookBlock('post-commit', VERSION));

  assert.match(result, /^#!\/bin\/sh\n/);
  assert.ok(hasBlock(result));
});

test('installing twice leaves exactly one block', () => {
  const block = hookBlock('post-commit', VERSION);
  const once = withBlock('', block);
  const twice = withBlock(once, block);

  assert.equal(twice.split(BEGIN_MARKER).length - 1, 1);
  assert.equal(twice.split(END_MARKER).length - 1, 1);
  assert.equal(once, twice, 'a second install must be a no-op');
});

test('uninstalling restores somebody else’s hook byte for byte', () => {
  const original = '#!/bin/sh\n# my own hook\nnpm run lint-staged\n';
  const installed = withBlock(original, hookBlock('post-commit', VERSION));

  assert.ok(installed.includes('npm run lint-staged'));
  assert.ok(hasBlock(installed));
  assert.equal(withoutBlock(installed), original);
});

test('a block written by an older version is replaced, not duplicated', () => {
  const old = withBlock('', hookBlock('post-commit', '0.0.1'));
  const fresh = withBlock(old, hookBlock('post-commit', VERSION));

  assert.equal(fresh.split(BEGIN_MARKER).length - 1, 1);
  assert.ok(fresh.includes(VERSION));
  assert.equal(fresh.includes('0.0.1'), false);
});

/* ------------------------------------------------------------------ *
 * The script itself
 * ------------------------------------------------------------------ */

const withoutComments = (script) =>
  script
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

test('the hook script is valid POSIX shell', posixOnly, () => {
  const dir = temp();
  try {
    const path = join(dir, 'post-commit');
    writeFileSync(path, withBlock('', hookBlock('post-commit', VERSION)), 'utf8');

    const check = spawnSync('sh', ['-n', path], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the hook runs no git command that writes', () => {
  // Comments are stripped first: the block documents this promise in a comment that names the
  // very commands it must not run.
  const script = withoutComments(hookBlock('post-commit', VERSION));

  assert.doesNotMatch(script, /\bgit\s+(add|commit|stash|push|reset|checkout|switch|tag|rm)\b/);

  // The two reads it does make are both harmless.
  const reads = [...script.matchAll(/\bgit\s+([a-z-]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(reads)].sort(), ['rev-parse']);
});

test('the hook steps aside during rebase, merge, cherry-pick, revert and bisect', () => {
  const script = withoutComments(hookBlock('post-commit', VERSION));

  for (const state of [
    'rebase-merge',
    'rebase-apply',
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'BISECT_LOG',
  ]) {
    assert.ok(script.includes(state), `the hook does not guard against ${state}`);
  }
});

/* ------------------------------------------------------------------ *
 * Behaviour, by actually running the script
 * ------------------------------------------------------------------ */

/** Builds a stub `egehan` on PATH that records being called. */
function stubCli(dir, body) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const path = join(bin, 'egehan');
  writeFileSync(path, `#!/bin/sh\n${body}\n`, 'utf8');
  chmodSync(path, 0o755);
  return bin;
}

const waitFor = (path, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    // The hook detaches, so polling is the only honest way to observe it.
    sleepSync(50);
  }
  return false;
};

test('the hook invokes the CLI after a commit, in the background', posixOnly, () => {
  const { root, run, context } = makeRepository();

  try {
    installHooks(resolveHookTarget(context, root), VERSION);

    const marker = join(root, 'called.txt');
    // The stub sleeps far longer than any commit should take: if the hook waited for it, the
    // commit below would take five seconds.
    const bin = stubCli(root, `sleep 5\necho called > "${marker}"`);

    const started = Date.now();
    writeFileSync(join(root, 'a.txt'), 'x\n', 'utf8');
    run(['add', '-A']);
    execFileSync('git', ['commit', '-m', 'feat: ikinci'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 3000, `committing waited ${elapsed}ms for the hook`);
    assert.ok(waitFor(marker, 10000), 'the hook never invoked the CLI');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the hook does nothing while a rebase is in progress', posixOnly, () => {
  const { root, context } = makeRepository();

  try {
    const target = resolveHookTarget(context, root);
    installHooks(target, VERSION);

    const marker = join(root, 'called.txt');
    const bin = stubCli(root, `echo called > "${marker}"`);
    mkdirSync(join(root, '.git', 'rebase-merge'), { recursive: true });

    const result = spawnSync('sh', [join(target.directory, 'post-commit')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });

    assert.equal(result.status, 0);
    sleepSync(400);
    assert.equal(existsSync(marker), false, 'the hook ran during a rebase');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('EGEHAN_SKIP_HOOK switches the hook off for one command', posixOnly, () => {
  const { root, context } = makeRepository();

  try {
    const target = resolveHookTarget(context, root);
    installHooks(target, VERSION);

    const marker = join(root, 'called.txt');
    const bin = stubCli(root, `echo called > "${marker}"`);

    const result = spawnSync('sh', [join(target.directory, 'post-commit')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, EGEHAN_SKIP_HOOK: '1' },
    });

    assert.equal(result.status, 0);
    sleepSync(400);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the hook succeeds silently on a machine where the CLI is not installed', posixOnly, () => {
  const { root, context } = makeRepository();

  try {
    const target = resolveHookTarget(context, root);
    installHooks(target, VERSION);

    const empty = join(root, 'empty-bin');
    mkdirSync(empty, { recursive: true });

    const result = spawnSync('sh', [join(target.directory, 'post-commit')], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: `${empty}:/usr/bin:/bin`, HOME: root },
    });

    assert.equal(result.status, 0, 'a missing CLI must not fail somebody’s commit');
    assert.equal(result.stderr.trim(), '', 'a missing CLI must not nag on every commit');
    assert.equal(result.stdout.trim(), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * Installing without trampling anyone
 * ------------------------------------------------------------------ */

test('install writes both hooks and makes them executable', () => {
  const { root, context } = makeRepository();

  try {
    const target = resolveHookTarget(context, root);

    // The directory must come from the repository being operated on, not from wherever the
    // process happens to be running. Getting this wrong once installed the hook into the tool's
    // own checkout instead of the user's.
    // realpath, because git resolves symlinks and on macOS /var is a link to /private/var.
    assert.ok(
      target.directory.startsWith(realpathSync(root)),
      `hooks resolved outside the repository: ${target.directory}`,
    );

    const results = installHooks(target, VERSION);

    assert.deepEqual(
      results.map((result) => result.action),
      ['created', 'created'],
    );

    for (const hook of MANAGED_HOOKS) {
      const path = join(target.directory, hook);
      assert.ok(existsSync(path));
      assert.ok((statSync(path).mode & 0o111) !== 0, `${hook} is not executable`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('install is idempotent and reports it', () => {
  const { root, context } = makeRepository();

  try {
    const target = resolveHookTarget(context, root);
    installHooks(target, VERSION);
    const again = installHooks(target, VERSION);

    assert.deepEqual(
      again.map((result) => result.action),
      ['unchanged', 'unchanged'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an existing hook survives install and is restored exactly by uninstall', () => {
  const { root, context } = makeRepository();

  try {
    const target = resolveHookTarget(context, root);
    const path = join(target.directory, 'post-commit');
    const original = '#!/bin/sh\n# somebody else got here first\nnpm run lint-staged\n';
    writeFileSync(path, original, 'utf8');

    installHooks(target, VERSION);
    const installed = readFileSync(path, 'utf8');
    assert.ok(installed.includes('npm run lint-staged'), 'the existing hook was overwritten');
    assert.ok(hasBlock(installed));

    uninstallHooks(target);
    assert.equal(readFileSync(path, 'utf8'), original, 'uninstall did not restore the original');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uninstall deletes a hook file that was only ever ours', () => {
  const { root, context } = makeRepository();

  try {
    const target = resolveHookTarget(context, root);
    installHooks(target, VERSION);
    const results = uninstallHooks(target);

    assert.deepEqual(
      results.map((result) => result.action),
      ['removed', 'removed'],
    );
    for (const hook of MANAGED_HOOKS) {
      assert.equal(existsSync(join(target.directory, hook)), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uninstalling what was never installed changes nothing', () => {
  const { root, context } = makeRepository();

  try {
    const results = uninstallHooks(resolveHookTarget(context, root));
    assert.deepEqual(
      results.map((result) => result.action),
      ['absent', 'absent'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * Other hook managers
 * ------------------------------------------------------------------ */

test('Husky keeps its hooks, and Egehan installs beside them', () => {
  const { root, run, context } = makeRepository();

  try {
    mkdirSync(join(root, '.husky', '_'), { recursive: true });
    run(['config', 'core.hooksPath', '.husky/_']);

    const target = resolveHookTarget(context, root);
    assert.equal(target.owner, 'husky');
    assert.equal(target.directory, join(root, '.husky'));

    installHooks(target, VERSION);
    assert.ok(existsSync(join(root, '.husky', 'post-commit')));
    assert.equal(
      existsSync(join(root, '.husky', '_', 'post-commit')),
      false,
      'Egehan must not write into the directory Husky regenerates',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Lefthook is left alone, with the configuration to add printed instead', () => {
  const { root, context } = makeRepository();

  try {
    writeFileSync(join(root, 'lefthook.yml'), 'pre-commit:\n  commands: {}\n', 'utf8');

    const target = resolveHookTarget(context, root);
    assert.equal(target.owner, 'lefthook');

    const results = installHooks(target, VERSION);
    assert.deepEqual(
      results.map((result) => result.action),
      ['skipped', 'skipped'],
    );
    assert.equal(existsSync(join(root, '.git', 'hooks', 'post-commit')), false);

    assert.match(lefthookSnippet(), /post-commit:/);
    assert.match(lefthookSnippet(), /egehan generate --quiet/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('core.hooksPath is honoured, or the hook is written where git never looks', () => {
  const { root, run, context } = makeRepository();

  try {
    run(['config', 'core.hooksPath', 'tooling/githooks']);

    const target = resolveHookTarget(context, root);
    assert.equal(target.owner, 'git');
    assert.equal(target.directory, join(root, 'tooling', 'githooks'));

    installHooks(target, VERSION);
    assert.ok(existsSync(join(root, 'tooling', 'githooks', 'post-commit')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * status
 * ------------------------------------------------------------------ */

test('status distinguishes installed, shared and absent', () => {
  const { root, context } = makeRepository();

  try {
    const target = resolveHookTarget(context, root);

    assert.deepEqual(
      readHookStatus(target).map((entry) => entry.installed),
      [false, false],
    );

    writeFileSync(join(target.directory, 'post-commit'), '#!/bin/sh\nnpm run lint\n', 'utf8');
    installHooks(target, VERSION);

    const status = readHookStatus(target);
    const postCommit = status.find((entry) => entry.hook === 'post-commit');
    const postMerge = status.find((entry) => entry.hook === 'post-merge');

    assert.equal(postCommit.installed, true);
    assert.equal(postCommit.sharedWithOtherHooks, true);
    assert.equal(postMerge.installed, true);
    assert.equal(postMerge.sharedWithOtherHooks, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * Through the CLI
 * ------------------------------------------------------------------ */

test('the CLI installs, reports and removes the hooks', () => {
  const { root } = makeRepository();
  const cli = (args) =>
    execFileSync(process.execPath, [CLI, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });

  try {
    assert.match(cli(['hook', 'status']), /not installed/);

    const installed = cli(['hook', 'install']);
    assert.match(installed, /post-commit/);
    assert.match(installed, /never stages or commits anything/);
    assert.ok(existsSync(join(root, '.git', 'hooks', 'post-commit')));

    assert.match(cli(['hook', 'status']), /installed/);

    cli(['hook', 'uninstall']);
    assert.equal(existsSync(join(root, '.git', 'hooks', 'post-commit')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unknown hook action is rejected', () => {
  const { root } = makeRepository();

  try {
    assert.throws(
      () =>
        execFileSync(process.execPath, [CLI, 'hook', 'enable'], {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, NO_COLOR: '1' },
        }),
      (error) => {
        assert.match(error.stderr ?? '', /install, uninstall, status/);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
