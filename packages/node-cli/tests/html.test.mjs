import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderHtml, readTemplate } from '../dist/renderers/html.js';
import { buildReport } from '../dist/engine/buildReport.js';
import { sealCapsule } from '../dist/capsule/capsule.js';
import { loadDictionary } from '../dist/spec/dictionary.js';
import { loadRules } from '../dist/spec/rules.js';

const rules = loadRules();

let counter = 0;
const nextSha = () => (++counter).toString(16).padStart(40, 'e');

const commit = (subject, extra = {}) => ({
  sha: nextSha(),
  parents: counter === 1 ? [] : ['0'.repeat(40)],
  authorName: 'Ada Yılmaz',
  authorEmail: 'ada@example.com',
  authoredAt: '2026-02-01T22:10:00+03:00',
  committedAt: '2026-02-01T22:10:00+03:00',
  subject,
  body: '',
  tags: [],
  files: [{ path: 'src/a.ts', insertions: 10, deletions: 2 }],
  ...extra,
});

const reportFrom = (commits, capsule = null) =>
  buildReport({
    commits,
    project: {
      name: 'demo',
      dedication: null,
      detectedTypes: ['node'],
      flavor: 'frontend',
      defaultBranch: 'main',
      remoteHost: 'github.com',
    },
    config: {
      language: 'tr',
      tone: 'poetic',
      redactEmails: true,
      anonymizeAuthors: false,
      includeMergeCommits: false,
      theme: 'auto',
    },
    range: { since: null, until: null, truncated: false },
    generator: { version: '0.0.0-test', generatedAt: '2026-05-01T12:00:00+03:00' },
    capsule,
  });

const render = (commits, capsule = null) =>
  renderHtml(reportFrom(commits, capsule), loadDictionary('tr'), rules);

const embedded = (html, id) => {
  const match = new RegExp(`id="${id}" type="application/json">([\\s\\S]*?)</script>`).exec(html);
  assert.ok(match !== null, `the ${id} block is missing`);
  return JSON.parse(match[1]);
};

/* ------------------------------------------------------------------ *
 * The template contract
 * ------------------------------------------------------------------ */

test('every template marker is filled in', () => {
  const html = render([commit('chore: ilk commit')]);

  assert.doesNotMatch(html, /__EGEHAN_[A-Z_]+__/, 'a marker survived into the output');
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="tr" data-theme="auto">/);
  assert.match(html, /<title>demo — Kod Kroniği<\/title>/);
});

test('the renderer refuses a template whose markers no longer match', () => {
  // A template edit that renames a marker must fail the build, not ship a chronicle with
  // "__EGEHAN_REPORT__" printed in it.
  const template = readTemplate();
  assert.ok(template.includes('__EGEHAN_REPORT__'));

  const counts = [
    '__EGEHAN_LANG__',
    '__EGEHAN_THEME__',
    '__EGEHAN_TITLE__',
    '__EGEHAN_REPORT__',
    '__EGEHAN_STRINGS__',
  ];
  for (const marker of counts) {
    assert.equal(template.split(marker).length - 1, 1, `${marker} must appear exactly once`);
  }
});

test('the embedded report and strings parse, and carry what the page needs', () => {
  const html = render([commit('feat: bir şey ekle'), commit('fix: bir şey düzelt')]);

  const report = embedded(html, 'egehan-report');
  assert.equal(report.totals.commits, 2);
  assert.ok(Array.isArray(report.entries));

  const strings = embedded(html, 'egehan-strings');
  assert.equal(strings.language, 'tr');
  assert.ok(strings.locale.months.length === 12);
  assert.ok(strings.categories.birth.label.length > 0);
  assert.ok(strings.pulse.chronotypes['night-owl'].label.length > 0);
  assert.equal(strings.crypto.additionalDataFormat, rules.capsule.additionalDataFormat);

  // The page never needs the narrative templates, and shipping them would add ~100 kB of
  // sentences nobody reads to every chronicle.
  assert.equal(strings.categories.birth.entries, undefined);
});

/* ------------------------------------------------------------------ *
 * Security: a commit message is untrusted input
 * ------------------------------------------------------------------ */

test('a commit subject cannot break out of the embedded JSON', () => {
  const attack = '</script><img src=x onerror="alert(1)"><script>';
  const html = render([commit('feat: ilk'), commit(attack)]);

  assert.equal(html.includes('</script><img'), false, 'the subject closed the data block');
  assert.equal(html.includes('onerror="alert(1)"'), false);
  assert.match(html, /\\u003c\/script\\u003e/, 'the angle brackets must be escaped as \\u003c');

  // And the payload must still survive intact as *data*, so the chronicle tells the truth.
  const report = embedded(html, 'egehan-report');
  const entry = report.entries.find((candidate) => candidate.subject === attack);
  assert.ok(entry !== undefined, 'the subject was mangled instead of escaped');
});

test('a project name cannot inject markup into the title', () => {
  const report = reportFrom([commit('chore: ilk')]);
  const hostile = { ...report, project: { ...report.project, name: '<script>alert(1)</script>' } };
  const html = renderHtml(hostile, loadDictionary('tr'), rules);

  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('a theme value cannot escape its attribute', () => {
  const report = reportFrom([commit('chore: ilk')]);
  const hostile = { ...report, config: { ...report.config, theme: 'dark" onload="alert(1)' } };
  const html = renderHtml(hostile, loadDictionary('tr'), rules);

  assert.equal(html.includes('onload="alert(1)"'), false);
  assert.match(html, /data-theme="dark&quot;/);
});

/* ------------------------------------------------------------------ *
 * The offline promise
 * ------------------------------------------------------------------ */

test('the chronicle references nothing outside itself', () => {
  // Comments are stripped first: the template documents this very attack with a literal
  // `<img onerror=…>` in a comment, and a comment issues no requests.
  const html = render([commit('chore: ilk commit')]).replace(/<!--[\s\S]*?-->/g, '');

  assert.doesNotMatch(html, /<link\b/i, 'a stylesheet or icon link would be a network request');
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/i, 'an external script would break the offline promise');
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /@import/i);
  assert.doesNotMatch(html, /url\(\s*["']?https?:/i);
  assert.doesNotMatch(html, /\bfetch\s*\(/);
  assert.doesNotMatch(html, /XMLHttpRequest|sendBeacon|EventSource|WebSocket/);

  // The only absolute URL allowed is the SVG namespace, which is an identifier, not a request.
  const urls = [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((match) => match[0]);
  for (const url of urls) {
    assert.equal(url, 'http://www.w3.org/2000/svg', `unexpected external URL: ${url}`);
  }
});

/* ------------------------------------------------------------------ *
 * Committability
 * ------------------------------------------------------------------ */

test('the chronicle carries no generation timestamp and is byte-stable', () => {
  const commits = [commit('chore: ilk'), commit('feat: ikinci')];

  const first = render(commits);
  const second = render(commits);
  assert.equal(first, second, 'two runs must produce the same bytes');

  assert.equal(embedded(first, 'egehan-report').generator.generatedAt, '');
  assert.doesNotMatch(first, /2026-05-01T12:00/, 'the generation time leaked into the artifact');
});

/* ------------------------------------------------------------------ *
 * The capsule
 * ------------------------------------------------------------------ */

test('a sealed capsule travels in the chronicle, and its message does not', () => {
  const capsule = sealCapsule(
    {
      message: 'bu-metin-dosyada-gorunmemelidir',
      unlockDate: '2044-02-01',
      passphrase: 'yeterince-uzun-parola',
      authorLabel: 'Demo',
      hint: 'demo ipucu',
      createdAt: '2026-01-01T00:00:00+03:00',
    },
    rules,
  );

  const html = render([commit('chore: ilk')], capsule);
  const report = embedded(html, 'egehan-report');

  assert.equal(report.capsule.mode, 'sealed');
  assert.equal(report.capsule.unlockDate, '2044-02-01');
  assert.equal(report.capsule.algorithm.iterations, rules.capsule.iterations);
  assert.equal(html.includes('bu-metin-dosyada-gorunmemelidir'), false, 'the plaintext shipped');

  // The hint is stored in clear text on purpose, and the CLI warns about exactly that.
  assert.equal(report.capsule.hint, 'demo ipucu');
});

test('a chronicle without a capsule says so explicitly', () => {
  const report = embedded(render([commit('chore: ilk')]), 'egehan-report');
  assert.equal(report.capsule, null);
});
