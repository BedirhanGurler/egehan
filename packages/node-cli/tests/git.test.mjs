import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readHistory, readTags } from '../dist/git/logReader.js';
import { isGitRepository, hasAnyCommit, readRepositoryInfo } from '../dist/git/repository.js';
import { loadRules } from '../dist/spec/rules.js';
import { produceReport } from '../dist/pipeline.js';
import { renderMarkdown } from '../dist/renderers/markdown.js';
import { loadDictionary } from '../dist/spec/dictionary.js';

/**
 * Integration tests against a real repository.
 *
 * Everything here is the half of the system that cannot be unit-tested honestly: process spawning,
 * encodings, annotated tags, numstat. The Turkish commit messages and the non-ASCII filename are
 * the point, not decoration — mojibake in a keepsake is the failure this project least wants, and
 * it only ever shows up when a real git actually runs.
 */

const rules = loadRules();
let root;
let context;

const run = (args, env = {}) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

const commit = (message, { at, files }) => {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  run(['add', '-A']);
  run(['commit', '-m', message], {
    GIT_AUTHOR_DATE: at,
    GIT_COMMITTER_DATE: at,
    GIT_AUTHOR_NAME: 'Ada Yılmaz',
    GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_COMMITTER_NAME: 'Ada Yılmaz',
    GIT_COMMITTER_EMAIL: 'ada@example.com',
  });
};

before(() => {
  root = mkdtempSync(join(tmpdir(), 'egehan-git-'));
  context = { cwd: root, rules };

  run(['init', '-b', 'main']);
  run(['config', 'user.name', 'Ada Yılmaz']);
  run(['config', 'user.email', 'ada@example.com']);
  run(['config', 'commit.gpgsign', 'false']);
  run(['config', 'i18n.commitEncoding', 'UTF-8']);

  commit('chore: ilk commit — şöyle böyle ğüşıöç', {
    at: '2026-01-06T21:14:03+03:00',
    files: { 'README.md': '# Başlangıç\n', 'package.json': '{}\n' },
  });

  commit('feat(giriş): oturum açma ekranı eklendi', {
    at: '2026-01-09T11:02:50+03:00',
    files: { 'src/girişler/oturum.ts': 'export const a = 1;\n'.repeat(20) },
  });

  run(['tag', 'v0.1.0']); // lightweight

  commit('fix: token refresh race condition', {
    at: '2026-03-14T03:18:42+03:00',
    files: { 'src/auth.ts': 'export const b = 2;\n'.repeat(12) },
  });

  // An annotated tag: its object name is the tag, not the commit, which is what breaks naive
  // %D-decoration parsing.
  run(['tag', '-a', 'v1.0.0', '-m', 'ilk kararlı sürüm'], {
    GIT_COMMITTER_DATE: '2026-03-14T04:00:00+03:00',
  });

  // A branch and a real merge commit.
  run(['checkout', '-q', '-b', 'feature/billing']);
  commit('feat: faturalama', {
    at: '2026-04-01T12:00:00+03:00',
    files: { 'src/billing.ts': 'export const c = 3;\n'.repeat(30) },
  });
  run(['checkout', '-q', 'main']);
  run(['merge', '--no-ff', '-m', 'Merge branch "feature/billing"', 'feature/billing'], {
    GIT_AUTHOR_DATE: '2026-04-02T09:00:00+03:00',
    GIT_COMMITTER_DATE: '2026-04-02T09:00:00+03:00',
  });
});

after(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

test('a repository is recognised and reported', () => {
  assert.equal(isGitRepository(context), true);
  assert.equal(hasAnyCommit(context), true);

  const info = readRepositoryInfo(context);
  assert.equal(info.defaultBranch, 'main');
  assert.equal(info.remoteHost, null, 'no remote has been added yet');
});

test('Turkish characters survive the round trip through git', () => {
  const { commits } = readHistory(context, { since: null, until: null }, rules);

  const first = commits[0];
  assert.equal(first.subject, 'chore: ilk commit — şöyle böyle ğüşıöç');
  assert.ok(
    commits.some((entry) => entry.files.some((file) => file.path === 'src/girişler/oturum.ts')),
    'a non-ASCII path must come back unquoted and unescaped',
  );
  assert.equal(JSON.stringify(commits).includes('\\u00c3'), false, 'no mojibake');
});

test('both lightweight and annotated tags land on their commit', () => {
  const tags = readTags(context);
  const all = [...tags.values()].flat();

  assert.ok(all.includes('v0.1.0'), 'lightweight tag missing');
  assert.ok(all.includes('v1.0.0'), 'annotated tag missing — its object name is not the commit');

  const { commits } = readHistory(context, { since: null, until: null }, rules);
  const tagged = commits.filter((entry) => entry.tags.length > 0);
  assert.equal(tagged.length, 2);
  assert.equal(tagged.find((entry) => entry.subject.startsWith('feat(giriş)')).tags[0], 'v0.1.0');
  assert.equal(tagged.find((entry) => entry.subject.startsWith('fix:')).tags[0], 'v1.0.0');
});

test('line statistics and parents are parsed', () => {
  const { commits } = readHistory(context, { since: null, until: null }, rules);

  const screen = commits.find((entry) => entry.subject.startsWith('feat(giriş)'));
  assert.equal(screen.files.length, 1);
  assert.equal(screen.files[0].insertions, 20);
  assert.equal(screen.files[0].deletions, 0);

  assert.deepEqual(commits[0].parents, [], 'the root commit has no parents');

  const merge = commits.find((entry) => entry.parents.length > 1);
  assert.ok(merge, 'the merge commit was not read');
  assert.equal(merge.parents.length, 2);
});

test('history comes back oldest first, in chronological order', () => {
  const { commits } = readHistory(context, { since: null, until: null }, rules);
  const times = commits.map((entry) => Date.parse(entry.authoredAt));

  for (let index = 1; index < times.length; index += 1) {
    assert.ok(times[index] >= times[index - 1], 'history is not chronological');
  }
});

test('--since accepts a tag as readily as a date', () => {
  const sinceTag = readHistory(context, { since: 'v0.1.0', until: null }, rules);
  assert.equal(
    sinceTag.commits.some((entry) => entry.subject.startsWith('chore: ilk')),
    false,
    'a revision range must exclude everything up to the tag',
  );
  assert.ok(sinceTag.commits.some((entry) => entry.subject.startsWith('fix:')));

  const sinceDate = readHistory(context, { since: '2026-03-01', until: null }, rules);
  assert.equal(
    sinceDate.commits.some((entry) => entry.subject.startsWith('feat(giriş)')),
    false,
    'a date must be passed as --since, not as a revision',
  );
});

test('a remote URL carrying a token contributes only its host', () => {
  run(['remote', 'add', 'origin', 'https://x-access-token:ghp_notarealtoken@github.com/owner/repo.git']);

  try {
    const info = readRepositoryInfo(context);
    assert.equal(info.remoteHost, 'github.com');
    assert.equal(JSON.stringify(info).includes('ghp_notarealtoken'), false, 'a token must never be recorded');
  } finally {
    run(['remote', 'remove', 'origin']);
  }
});

test('an SSH remote contributes its host too', () => {
  run(['remote', 'add', 'origin', 'git@gitlab.example.com:group/project.git']);

  try {
    assert.equal(readRepositoryInfo(context).remoteHost, 'gitlab.example.com');
  } finally {
    run(['remote', 'remove', 'origin']);
  }
});

test('the whole pipeline produces a chronicle for a real repository', () => {
  const { report, repositoryRoot } = produceReport({
    cwd: root,
    overrides: { language: 'tr', tone: 'poetic' },
    generatedAt: '2026-05-01T00:00:00+03:00',
  });

  // git resolves symlinks in its answer, and on macOS /var is a symlink to /private/var.
  assert.equal(repositoryRoot, realpathSync(root));
  assert.equal(report.totals.commits, 4, 'the merge commit is excluded by default');
  assert.equal(report.project.flavor, 'frontend', 'package.json makes this a node project');
  assert.ok(report.project.detectedTypes.includes('node'));
  assert.ok(report.entries.length > 0);

  const night = report.entries.find((entry) => entry.subject.startsWith('fix:'));
  assert.equal(night.localHour, 3);
  assert.equal(night.category, 'milestone', 'it carries the v1.0.0 tag, and milestone wins');
  assert.deepEqual([...night.secondaryCategories], ['midnight-oil']);

  const markdown = renderMarkdown(report, loadDictionary('tr'));
  assert.match(markdown, /# .+Kod Kroniği/);
  assert.match(markdown, /Geliştirici Nabzı/);
  assert.doesNotMatch(markdown, /\{[A-Za-z][A-Za-z0-9]*\}/, 'the renderer left a placeholder behind');
  assert.equal(markdown.includes('ada@example.com'), false, 'the chronicle must not carry the address');
  assert.ok(markdown.includes('şöyle böyle ğüşıöç'), 'Turkish text must survive into the output');
});

test('generating twice produces the same bytes', () => {
  const options = { cwd: root, generatedAt: '2026-05-01T00:00:00+03:00' };
  const first = renderMarkdown(produceReport(options).report, loadDictionary('en'));
  const second = renderMarkdown(produceReport(options).report, loadDictionary('en'));

  assert.equal(first, second, 'a hook that runs this after every commit must not churn the diff');
});

test('a directory that is not a repository fails with an explanation, not a stack trace', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'egehan-empty-'));

  try {
    assert.throws(() => produceReport({ cwd: empty }), /not inside a git repository/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('a repository with no commits says so', () => {
  const fresh = mkdtempSync(join(tmpdir(), 'egehan-fresh-'));

  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: fresh, stdio: 'ignore' });
    assert.throws(() => produceReport({ cwd: fresh }), /no commits yet/);
  } finally {
    rmSync(fresh, { recursive: true, force: true });
  }
});
