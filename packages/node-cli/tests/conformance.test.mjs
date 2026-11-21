import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { buildReport } from '../dist/engine/buildReport.js';
import { assetPath } from '../dist/spec/assets.js';

/**
 * The conformance suite.
 *
 * This file is the project's central correctness claim: the engine's output for a known history is
 * fixed, schema-valid, free of unfilled placeholders, and independent of the machine that produced
 * it. When the .NET engine arrives it will be held to exactly these expectations.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'core-spec', 'fixtures');
const GENERATED_AT = '2026-01-01T00:00:00+00:00';
const VERSION = '0.0.0-fixture';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
// A fixture is a directory with an input; `capsule/` holds interop material, not a history.
const fixtures = readdirSync(FIXTURES).filter(
  (name) => statSync(join(FIXTURES, name)).isDirectory() && existsSync(join(FIXTURES, name, 'input.json')),
);

const COMBINATIONS = [
  ['tr', 'poetic'],
  ['tr', 'minimalist'],
  ['tr', 'humorous'],
  ['en', 'poetic'],
  ['en', 'minimalist'],
  ['en', 'humorous'],
];

function reportFor(input, language, tone, generatedAt = GENERATED_AT) {
  return buildReport({
    commits: input.commits,
    project: { ...input.project, dedication: null },
    config: {
      ...input.config,
      language,
      tone,
      includeMergeCommits: input.config.includeMergeCommits ?? false,
      theme: input.config.theme ?? 'auto',
    },
    range: { since: null, until: null, truncated: false },
    generator: { version: VERSION, generatedAt },
    capsule: null,
  });
}

test('every fixture reproduces its expected report exactly', () => {
  for (const fixture of fixtures) {
    const input = readJson(join(FIXTURES, fixture, 'input.json'));

    for (const [language, tone] of COMBINATIONS) {
      const expectedPath = join(FIXTURES, fixture, `expected.${language}.${tone}.json`);
      const expected = readJson(expectedPath);
      const actual = JSON.parse(JSON.stringify(reportFor(input, language, tone)));

      assert.deepEqual(
        actual,
        expected,
        `${fixture} (${language}/${tone}) drifted from its expected report. ` +
          'If the change was intended, run `npm run fixtures:generate -w egehan` and review the diff.',
      );
    }
  }
});

test('every generated report validates against the published schema', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  const validate = ajv.compile(readJson(assetPath('schema', 'egehan-report.schema.json')));

  for (const fixture of fixtures) {
    const input = readJson(join(FIXTURES, fixture, 'input.json'));

    for (const [language, tone] of COMBINATIONS) {
      const report = JSON.parse(JSON.stringify(reportFor(input, language, tone)));
      const ok = validate(report);
      assert.ok(
        ok,
        `${fixture} (${language}/${tone}) produced a report the schema rejects:\n` +
          (validate.errors ?? []).map((e) => `  ${e.instancePath || '/'} ${e.message}`).join('\n'),
      );
    }
  }
});

test('no generated sentence contains an unfilled placeholder', () => {
  // The failure this guards against is silent: a sentence reading "{fliesCount} dosyada" is
  // perfectly valid JSON and ships straight into a file somebody keeps.
  const placeholder = /\{[A-Za-z][A-Za-z0-9]*\}/;

  for (const fixture of fixtures) {
    const input = readJson(join(FIXTURES, fixture, 'input.json'));

    for (const [language, tone] of COMBINATIONS) {
      const report = reportFor(input, language, tone);
      const texts = [
        ...report.entries.map((entry) => entry.narrative),
        ...report.chapters.flatMap((chapter) => [chapter.title, chapter.narrative]),
        ...report.milestones.map((milestone) => `${milestone.label} ${milestone.narrative}`),
        report.pulse.narrative,
        report.pulse.chronotypeLabel,
      ];

      for (const text of texts) {
        assert.doesNotMatch(
          text,
          placeholder,
          `${fixture} (${language}/${tone}) left a placeholder unfilled: "${text}"`,
        );
      }
    }
  }
});

test('narration is stable across repeated runs', () => {
  const input = readJson(join(FIXTURES, fixtures[0], 'input.json'));
  const first = JSON.stringify(reportFor(input, 'tr', 'poetic'));
  const second = JSON.stringify(reportFor(input, 'tr', 'poetic'));
  assert.equal(first, second);
});

test('only generatedAt may differ between two runs at different times', () => {
  const input = readJson(join(FIXTURES, fixtures[0], 'input.json'));

  const a = reportFor(input, 'en', 'poetic', '2026-01-01T00:00:00+00:00');
  const b = reportFor(input, 'en', 'poetic', '2031-07-09T13:45:12+03:00');

  assert.notEqual(a.generator.generatedAt, b.generator.generatedAt);

  const strip = (report) => {
    const copy = JSON.parse(JSON.stringify(report));
    copy.generator.generatedAt = '';
    return copy;
  };
  assert.deepEqual(strip(a), strip(b));
});

/**
 * The host-timezone test, run in child processes.
 *
 * A commit's local hour must come from the commit's own offset, never from the machine reading it.
 * Asserting that inside this process is not convincing — `TZ` is latched early — so the report is
 * built twice in child processes at opposite ends of the planet and compared byte for byte.
 */
test('the report does not depend on the host timezone', () => {
  const inputPath = join(FIXTURES, fixtures[0], 'input.json');
  const buildReportUrl = new URL('../dist/engine/buildReport.js', import.meta.url).href;

  const script = [
    "import { readFileSync } from 'node:fs';",
    `import { buildReport } from ${JSON.stringify(buildReportUrl)};`,
    `const input = JSON.parse(readFileSync(${JSON.stringify(inputPath)}, 'utf8'));`,
    'const report = buildReport({',
    '  commits: input.commits,',
    '  project: { ...input.project, dedication: null },',
    "  config: { ...input.config, language: 'tr', tone: 'poetic', includeMergeCommits: false, theme: 'auto' },",
    '  range: { since: null, until: null, truncated: false },',
    `  generator: { version: ${JSON.stringify(VERSION)}, generatedAt: ${JSON.stringify(GENERATED_AT)} },`,
    '  capsule: null,',
    '});',
    'process.stdout.write(JSON.stringify(report));',
  ].join('\n');

  const run = (timezone) =>
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: timezone },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

  const utc = run('UTC');
  const kiritimati = run('Pacific/Kiritimati'); // UTC+14
  const honolulu = run('Pacific/Honolulu'); // UTC-10

  assert.equal(utc, kiritimati, 'the report changed with the host timezone');
  assert.equal(utc, honolulu, 'the report changed with the host timezone');

  // And the local hour really is the commit's own, not any of those zones.
  const report = JSON.parse(utc);
  const example = report.entries.find((entry) => entry.subject === 'fix: token refresh race condition');
  assert.ok(example, 'the worked example is missing from the fixture');
  assert.equal(example.localHour, 3, 'the 03:18+03:00 commit must read as hour 3');
  assert.equal(example.tzOffsetMinutes, 180);
  assert.equal(example.category, 'midnight-oil');
});
