import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_SETTINGS, overridesFrom } from '../dist/core/settings.js';
import { statusBarContent, fill } from '../dist/core/statusBar.js';
import { diffMilestones, milestoneKey, celebrationText } from '../dist/core/milestones.js';
import { hardenForWebview, contentSecurityPolicy } from '../dist/core/webviewHtml.js';

import { buildReport } from 'egehan';
import { loadDictionary } from 'egehan';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ *
 * A small real report to work against
 * ------------------------------------------------------------------ */

let counter = 0;
const nextSha = () => (++counter).toString(16).padStart(40, 'd');

const commit = (subject, at, overrides = {}) => ({
  sha: nextSha(),
  parents: counter === 1 ? [] : ['0'.repeat(40)],
  authorName: 'Ada Yılmaz',
  authorEmail: 'ada@example.com',
  authoredAt: at,
  committedAt: at,
  subject,
  body: '',
  tags: [],
  files: [{ path: 'src/a.ts', insertions: 10, deletions: 2 }],
  ...overrides,
});

const reportFrom = (commits, language = 'tr') =>
  buildReport({
    commits,
    project: {
      name: 'demo',
      dedication: null,
      detectedTypes: ['node'],
      flavor: 'frontend',
      defaultBranch: 'main',
      remoteHost: null,
    },
    config: {
      language,
      tone: 'poetic',
      redactEmails: true,
      anonymizeAuthors: false,
      includeMergeCommits: false,
      theme: 'auto',
    },
    range: { since: null, until: null, truncated: false },
    generator: { version: '0.0.0-test', generatedAt: '2026-05-01T00:00:00+03:00' },
    capsule: null,
  });

const sample = reportFrom([
  commit('chore: ilk commit', '2026-01-01T10:00:00+03:00'),
  commit('feat: bir şey', '2026-01-02T11:00:00+03:00'),
  commit('fix: gece düzeltmesi', '2026-02-01T03:10:00+03:00'),
]);

/* ------------------------------------------------------------------ *
 * settings
 * ------------------------------------------------------------------ */

test('"auto" means the project decides, so nothing is overridden', () => {
  assert.deepEqual(overridesFrom(DEFAULT_SETTINGS), {});
  assert.equal(DEFAULT_SETTINGS.language, 'auto');
  assert.equal(DEFAULT_SETTINGS.tone, 'auto');
});

test('an explicit editor setting overrides the project', () => {
  assert.deepEqual(overridesFrom({ ...DEFAULT_SETTINGS, language: 'en' }), { language: 'en' });
  assert.deepEqual(overridesFrom({ ...DEFAULT_SETTINGS, tone: 'humorous' }), { tone: 'humorous' });
});

/* ------------------------------------------------------------------ *
 * status bar
 * ------------------------------------------------------------------ */

test('the status bar speaks the chronicle’s language', () => {
  const tr = loadDictionary('tr');
  const content = statusBarContent(sample, tr.ui, tr.pulse.labels);

  assert.match(content.text, /Egehan/);
  assert.match(content.text, new RegExp(String(sample.totals.commits)));
  assert.match(content.text, new RegExp(String(sample.range.days)));
  assert.doesNotMatch(content.text, /\{[A-Za-z]+\}/, 'a placeholder survived into the status bar');

  const en = loadDictionary('en');
  const english = statusBarContent(
    reportFrom([commit('chore: init', '2026-01-01T10:00:00+03:00')], 'en'),
    en.ui,
    en.pulse.labels,
  );
  assert.match(english.text, /Day/);
  assert.notEqual(english.text, content.text);
});

test('the tooltip carries the pulse, and no unfilled placeholders', () => {
  const tr = loadDictionary('tr');
  const { tooltip } = statusBarContent(sample, tr.ui, tr.pulse.labels);

  assert.match(tooltip, /demo/);
  assert.match(tooltip, new RegExp(sample.pulse.chronotypeLabel));
  assert.doesNotMatch(tooltip, /\{[A-Za-z]+\}/);
});

test('fill leaves an unknown placeholder visible rather than blanking it', () => {
  assert.equal(fill('{a} and {b}', { a: '1' }), '1 and {b}');
  assert.equal(fill(undefined, {}), '');
});

/* ------------------------------------------------------------------ *
 * milestones
 * ------------------------------------------------------------------ */

test('the first run records history silently', () => {
  // The single most annoying thing this extension could do is announce four years of milestones
  // the moment it is installed.
  const diff = diffMilestones(sample, undefined);

  assert.equal(diff.seeded, true);
  assert.deepEqual(diff.announce, []);
  assert.equal(diff.seen.length, sample.milestones.length);
  assert.ok(diff.seen.length > 0, 'the sample should have milestones to record');
});

test('only genuinely new milestones are announced', () => {
  const first = diffMilestones(sample, undefined);

  const grown = reportFrom([
    commit('chore: ilk commit', '2026-01-01T10:00:00+03:00'),
    commit('feat: bir şey', '2026-01-02T11:00:00+03:00'),
    commit('fix: gece düzeltmesi', '2026-02-01T03:10:00+03:00'),
    commit('chore(release): v1.0.0', '2026-03-01T12:00:00+03:00', { tags: ['v1.0.0'] }),
  ]);

  const second = diffMilestones(grown, first.seen);

  assert.equal(second.seeded, false);
  assert.ok(second.announce.length > 0, 'a new release tag must be announced');
  assert.ok(second.announce.every((milestone) => milestone.kind !== 'first-commit'));

  // And announcing is not repeated.
  assert.deepEqual(diffMilestones(grown, second.seen).announce, []);
});

test('a milestone survives a rebase without being announced again', () => {
  // The same story with every sha rewritten, which is what a rebase or a squash produces. If the
  // key depended on the sha, the first rebase of a long-lived branch would replay the project's
  // entire history as notifications.
  const rebased = reportFrom([
    commit('chore: ilk commit', '2026-01-01T10:00:00+03:00'),
    commit('feat: bir şey', '2026-01-02T11:00:00+03:00'),
    commit('fix: gece düzeltmesi', '2026-02-01T03:10:00+03:00'),
  ]);

  assert.notDeepEqual(
    rebased.milestones.map((milestone) => milestone.sha),
    sample.milestones.map((milestone) => milestone.sha),
    'the fixture should have produced different shas',
  );
  assert.deepEqual(rebased.milestones.map(milestoneKey), sample.milestones.map(milestoneKey));

  const seen = diffMilestones(sample, undefined).seen;
  assert.deepEqual(diffMilestones(rebased, seen).announce, []);

  const keys = sample.milestones.map(milestoneKey);
  assert.equal(new Set(keys).size, keys.length, 'milestone keys must be unique within a report');
});

test('several milestones at once produce one notification, not three', () => {
  const tr = loadDictionary('tr');
  const many = sample.milestones.slice(0, 3);

  const text = celebrationText(many, tr.milestones.celebration.title);
  assert.ok(text !== null);
  assert.equal(text.headline, tr.milestones.celebration.title);
  assert.match(text.detail, /\(\+2\)$/);

  assert.equal(celebrationText([], tr.milestones.celebration.title), null);
  assert.doesNotMatch(celebrationText([many[0]], 'x').detail, /\+/);
});

/* ------------------------------------------------------------------ *
 * webview hardening
 * ------------------------------------------------------------------ */

const templatePath = join(HERE, '..', 'assets', 'templates', 'egehan-book.html');
const template = readFileSync(templatePath, 'utf8');
const NONCE = 'abcdef0123456789abcdef';

test('the policy allows exactly what the page needs and no network at all', () => {
  const policy = contentSecurityPolicy(NONCE);

  assert.match(policy, /default-src 'none'/);
  assert.match(policy, new RegExp(`script-src 'nonce-${NONCE}'`));
  assert.match(policy, new RegExp(`style-src 'nonce-${NONCE}'`));
  assert.match(policy, /connect-src 'none'/);
  assert.doesNotMatch(policy, /unsafe-inline/, 'the page must not need unsafe-inline');
  assert.doesNotMatch(policy, /unsafe-eval/);
});

test('every script and style element carries the nonce', () => {
  const hardened = hardenForWebview(template, NONCE);

  const scripts = hardened.match(/<script\b[^>]*>/g) ?? [];
  const styles = hardened.match(/<style\b[^>]*>/g) ?? [];

  assert.ok(scripts.length >= 3, 'the page should have its data blocks and its app script');
  assert.ok(styles.length >= 1);
  for (const tag of [...scripts, ...styles]) {
    assert.ok(tag.includes(`nonce="${NONCE}"`), `missing nonce: ${tag}`);
  }
  assert.match(hardened, /<meta http-equiv="Content-Security-Policy"/);
});

test('the page carries no inline style attribute, which the policy would block', () => {
  // `style-src 'nonce-…'` blocks style attributes in markup. Scripted element.style is fine.
  assert.doesNotMatch(template, /<[^>]+\sstyle="/);
});

test('hardening is idempotent and does not double the nonce', () => {
  const once = hardenForWebview(template, NONCE);
  const twice = hardenForWebview(once, NONCE);

  assert.equal(
    (twice.match(new RegExp(`nonce="${NONCE}"`, 'g')) ?? []).length,
    (once.match(new RegExp(`nonce="${NONCE}"`, 'g')) ?? []).length,
  );
});

test('inside the editor the page follows the editor theme', () => {
  const page = template.replace('data-theme="__EGEHAN_THEME__"', 'data-theme="dark"');
  assert.match(hardenForWebview(page, NONCE), /<html[^>]*data-theme="auto"/);
  assert.match(hardenForWebview(page, NONCE, { followEditorTheme: false }), /<html[^>]*data-theme="dark"/);
});

test('a weak nonce or a foreign page is refused', () => {
  assert.throws(() => hardenForWebview(template, 'short'), /at least 16/);
  assert.throws(() => hardenForWebview('<html></html>', NONCE), /does not look like an Egehan page/);
});
