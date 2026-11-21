import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  defaultConfig,
  loadConfig,
  mergeConfig,
  serializeConfig,
  ConfigError,
} from '../dist/config/config.js';
import { loadRules } from '../dist/spec/rules.js';
import { availableLanguages } from '../dist/spec/dictionary.js';

const rules = loadRules();
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'cli', 'main.js');

let root;

const git = (args, env = {}) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });

/** Both streams, for the cases where the interesting output is a warning. */
const cliStreams = (args, options = {}) => {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
};

const cli = (args, options = {}) =>
  execFileSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });

before(() => {
  root = mkdtempSync(join(tmpdir(), 'egehan-cli-'));
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Ada Yılmaz']);
  git(['config', 'user.email', 'ada@example.com']);
  writeFileSync(join(root, 'package.json'), '{"name":"demo"}\n', 'utf8');
  git(['add', '-A']);
  git(['commit', '-m', 'chore: ilk commit'], {
    GIT_AUTHOR_DATE: '2026-02-01T22:10:00+03:00',
    GIT_COMMITTER_DATE: '2026-02-01T22:10:00+03:00',
  });
});

after(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * configuration
 * ------------------------------------------------------------------ */

test('the privacy default comes from the rules file, not from code', () => {
  assert.equal(defaultConfig(rules).redactEmails, rules.privacy.redactEmailsByDefault);
  assert.equal(defaultConfig(rules).redactEmails, true);
});

test('a config file is merged over the defaults', () => {
  const path = join(root, rules.output.configFileName);
  writeFileSync(path, JSON.stringify({ language: 'tr', tone: 'humorous' }), 'utf8');

  try {
    const config = loadConfig(root, rules);
    assert.equal(config.language, 'tr');
    assert.equal(config.tone, 'humorous');
    assert.equal(config.redactEmails, true, 'unmentioned settings keep their default');
  } finally {
    rmSync(path, { force: true });
  }
});

test('an unknown setting is reported by name, with the known ones listed', () => {
  assert.throws(
    () => mergeConfig(defaultConfig(rules), { langauge: 'tr' }, 'test'),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /unknown setting "langauge"/);
      assert.match(error.message, /language/);
      return true;
    },
  );
});

test('an invalid value says what was expected', () => {
  assert.throws(
    () => mergeConfig(defaultConfig(rules), { tone: 'sarcastic' }, 'test'),
    /poetic, minimalist, humorous/,
  );
  assert.throws(
    () => mergeConfig(defaultConfig(rules), { language: 'de' }, 'test'),
    new RegExp(availableLanguages().join(', ')),
  );
  assert.throws(() => mergeConfig(defaultConfig(rules), { redactEmails: 'yes' }, 'test'), /true or false/);
  assert.throws(() => mergeConfig(defaultConfig(rules), { output: '' }, 'test'), /non-empty string/);
  assert.throws(() => mergeConfig(defaultConfig(rules), [1, 2], 'test'), /JSON object/);
});

test('invalid JSON in the config file names the file', () => {
  const path = join(root, rules.output.configFileName);
  writeFileSync(path, '{ not json', 'utf8');

  try {
    assert.throws(() => loadConfig(root, rules), /\.egehanrc\.json is not valid JSON/);
  } finally {
    rmSync(path, { force: true });
  }
});

test('a $-prefixed key such as $schema is tolerated', () => {
  const config = mergeConfig(
    defaultConfig(rules),
    { $schema: 'https://example.com', tone: 'poetic' },
    'test',
  );
  assert.equal(config.tone, 'poetic');
});

test('a serialized config round-trips', () => {
  const original = { ...defaultConfig(rules), language: 'tr', tone: 'humorous', projectName: 'demo' };
  const parsed = mergeConfig(defaultConfig(rules), JSON.parse(serializeConfig(original)), 'test');
  assert.deepEqual(parsed, original);
});

/* ------------------------------------------------------------------ *
 * the CLI itself
 * ------------------------------------------------------------------ */

test('--version prints the package version', () => {
  const manifest = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
  assert.equal(cli(['--version']).trim(), manifest.version);
});

test('--help lists only commands that exist', () => {
  const help = cli(['--help']);

  for (const command of ['generate', 'stats', 'init', 'capsule']) {
    assert.match(help, new RegExp(command));
  }
});

test('the capsule command never offers a passphrase flag', () => {
  // A secret on the command line lands in the shell history and in the process list. The help
  // text has to say where the passphrase comes from instead of accepting one here.
  const help = cli(['capsule', '--help']);

  assert.doesNotMatch(help, /--passphrase/, 'a passphrase flag must not exist');
  assert.match(help, /never passed as a flag/);
  assert.match(help, /EGEHAN_PASSPHRASE/);
});

test('generate writes the chronicle and is idempotent', () => {
  cli(['generate', '--language', 'tr', '--quiet']);

  const markdown = join(root, rules.output.markdownFileName);
  assert.ok(existsSync(markdown));

  const first = readFileSync(markdown, 'utf8');
  cli(['generate', '--language', 'tr', '--quiet']);
  assert.equal(readFileSync(markdown, 'utf8'), first, 'a second run must not change the file');

  assert.match(first, /Kod Kroniği/);
  assert.equal(first.includes('ada@example.com'), false);

  rmSync(markdown, { force: true });
});

test('generate --format json writes a schema-shaped report', () => {
  cli(['generate', '--format', 'json', '--quiet']);

  const path = join(root, rules.output.reportFileName);
  const report = JSON.parse(readFileSync(path, 'utf8'));

  assert.equal(report.schemaVersion, rules.schemaVersion);
  assert.equal(report.generator.platform, 'node');
  assert.equal(report.totals.commits, 1);

  rmSync(path, { force: true });
});

test('generate --format html writes a self-contained chronicle', () => {
  cli(['generate', '--format', 'html', '--language', 'tr', '--quiet']);

  const path = join(root, rules.output.htmlFileName);
  const html = readFileSync(path, 'utf8');

  assert.match(html, /^<!doctype html>/i);
  assert.doesNotMatch(html, /__EGEHAN_[A-Z_]+__/);
  assert.ok(html.length > 20000, 'the template should be substantially larger than this');
  assert.equal(html.includes('ada@example.com'), false);

  rmSync(path, { force: true });
});

test('generate --format both writes the Markdown and the HTML, but not the JSON', () => {
  cli(['generate', '--format', 'both', '--quiet']);

  assert.ok(existsSync(join(root, rules.output.markdownFileName)));
  assert.ok(existsSync(join(root, rules.output.htmlFileName)));
  assert.equal(
    existsSync(join(root, rules.output.reportFileName)),
    false,
    'the JSON report is the machine format and stays opt-in',
  );

  rmSync(join(root, rules.output.markdownFileName), { force: true });
  rmSync(join(root, rules.output.htmlFileName), { force: true });
});

test('generate --output writes somewhere else and creates it', () => {
  cli(['generate', '--output', 'docs/chronicle', '--quiet']);
  assert.ok(existsSync(join(root, 'docs', 'chronicle', rules.output.markdownFileName)));
  rmSync(join(root, 'docs'), { recursive: true, force: true });
});

test('stats writes no files', () => {
  const output = cli(['stats', '--language', 'tr']);
  assert.match(output, /Geliştirici Nabzı/);
  assert.equal(existsSync(join(root, rules.output.markdownFileName)), false);
});

test('an invalid --format is rejected before anything is written', () => {
  assert.throws(
    () => cli(['generate', '--format', 'pdf']),
    (error) => {
      assert.match(error.stderr ?? '', /md, html, json, both, all/);
      return true;
    },
  );
});

test('init --yes writes a config without asking anything', () => {
  const path = join(root, rules.output.configFileName);
  rmSync(path, { force: true });

  cli(['init', '--yes']);
  const config = JSON.parse(readFileSync(path, 'utf8'));

  assert.match(config.projectName, /^egehan-cli-/, 'the project name defaults to the repository folder');
  assert.equal(config.redactEmails, true);
  assert.equal(config.dedication, null, 'a dedication is never generated');

  // And it refuses to overwrite what somebody may have agreed on as a team. Exiting 0 is
  // deliberate: a second `init` is a no-op, the way `mkdir -p` is, so it must not fail a script.
  const second = cliStreams(['init', '--yes']);
  assert.match(second.stderr, /already exists/);
  assert.equal(second.status, 0);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).projectName, config.projectName);

  rmSync(path, { force: true });
});

test('running outside a repository explains itself in one sentence', () => {
  const empty = mkdtempSync(join(tmpdir(), 'egehan-outside-'));

  try {
    assert.throws(
      () => cli(['stats'], { cwd: empty }),
      (error) => {
        assert.match(error.stderr ?? '', /not inside a git repository/);
        assert.doesNotMatch(
          error.stderr ?? '',
          /at Object\.|node:internal/,
          'no stack trace for an expected failure',
        );
        return true;
      },
    );
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('the committed chronicle carries no generation timestamp', () => {
  // A regression guard. The timestamp used to be in the footer, which meant a post-commit hook
  // regenerating the file produced a one-line diff on every commit — the exact churn that makes
  // generated artifacts unkeepable in version control.
  cli(['generate', '--language', 'en', '--quiet']);
  const markdown = readFileSync(join(root, rules.output.markdownFileName), 'utf8');

  assert.doesNotMatch(
    markdown,
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    'the rendered chronicle must not embed the moment it was generated',
  );
  assert.equal(rules.output.embedGenerationTimeInArtifacts, false);

  // The machine format is where provenance belongs, and there it must be present.
  cli(['generate', '--format', 'json', '--quiet']);
  const report = JSON.parse(readFileSync(join(root, rules.output.reportFileName), 'utf8'));
  assert.match(report.generator.generatedAt, /^\d{4}-\d{2}-\d{2}T/);

  rmSync(join(root, rules.output.markdownFileName), { force: true });
  rmSync(join(root, rules.output.reportFileName), { force: true });
});
