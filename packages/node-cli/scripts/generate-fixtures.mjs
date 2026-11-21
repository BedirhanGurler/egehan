#!/usr/bin/env node
/**
 * Generates the expected reports for every conformance fixture in @egehan/core-spec.
 *
 * These files are the contract the .NET engine will be held to, so they are produced by the
 * reference engine and then *reviewed by a human* — never hand-written. A hand-written expectation
 * is a second implementation with no tests of its own.
 *
 * `--check` regenerates in memory and reports differences without writing, which is what CI runs:
 * a rules or dictionary change that moves these files must move them in a reviewed commit, not
 * silently during a test run.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReport } from '../dist/engine/buildReport.js';
import { renderHtml } from '../dist/renderers/html.js';
import { renderMarkdown } from '../dist/renderers/markdown.js';
import { loadDictionary } from '../dist/spec/dictionary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'core-spec', 'fixtures');
const REPO_ROOT = join(HERE, '..', '..', '..');

/**
 * A rendered example, committed on purpose.
 *
 * The expected JSON reports prove the engine is consistent; they do not tell a reviewer whether the
 * prose reads well. This file does, and keeping it generated means a dictionary change shows up in
 * the diff as the sentences a reader would actually see.
 */
const EXAMPLE = {
  fixture: '01-frontend-saas',
  language: 'tr',
  tone: 'poetic',
  path: join(REPO_ROOT, 'docs', 'example-chronicle.md'),
};

/** Fixed so the output is reproducible; conformance comparisons exclude this field anyway. */
const GENERATED_AT = '2026-01-01T00:00:00+00:00';
const VERSION = '0.0.0-fixture';

const COMBINATIONS = [
  { language: 'tr', tone: 'poetic' },
  { language: 'tr', tone: 'minimalist' },
  { language: 'tr', tone: 'humorous' },
  { language: 'en', tone: 'poetic' },
  { language: 'en', tone: 'minimalist' },
  { language: 'en', tone: 'humorous' },
];

const checkOnly = process.argv.includes('--check');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const fixtures = readdirSync(FIXTURES).filter(
  (name) => statSync(join(FIXTURES, name)).isDirectory() && existsSync(join(FIXTURES, name, 'input.json')),
);

let written = 0;
const drifted = [];

for (const fixture of fixtures) {
  const input = readJson(join(FIXTURES, fixture, 'input.json'));

  for (const { language, tone } of COMBINATIONS) {
    const report = buildReport({
      commits: input.commits,
      // Built field by field in the schema's own order, not by spreading: a spread would put
      // `dedication` last, and the embedded JSON in the HTML is compared byte for byte against
      // the .NET engine, which follows the schema.
      project: {
        name: input.project.name,
        dedication: null,
        detectedTypes: input.project.detectedTypes,
        flavor: input.project.flavor,
        defaultBranch: input.project.defaultBranch ?? null,
        remoteHost: input.project.remoteHost ?? null,
      },
      config: {
        ...input.config,
        language,
        tone,
        includeMergeCommits: input.config.includeMergeCommits ?? false,
        theme: input.config.theme ?? 'auto',
      },
      range: { since: null, until: null, truncated: false },
      generator: { version: VERSION, generatedAt: GENERATED_AT },
      capsule: null,
    });

    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    const path = join(FIXTURES, fixture, `expected.${language}.${tone}.json`);

    // The rendered page is a conformance artifact too, and for one combination the whole file is
    // kept rather than a hash: the .NET engine must produce it byte for byte, and when that ever
    // fails the person fixing it needs a diff, not a mismatched digest.
    const artifacts = [[path, serialized]];
    if (language === 'tr' && tone === 'poetic') {
      artifacts.push([
        join(FIXTURES, fixture, `expected.${language}.${tone}.html`),
        renderHtml(report, loadDictionary(language)),
      ]);
    }

    if (checkOnly) {
      for (const [file, content] of artifacts) {
        if (!existsSync(file) || readFileSync(file, 'utf8') !== content) {
          drifted.push(`${fixture}/${file.split('/').pop()}`);
        }
      }
      continue;
    }

    for (const [file, content] of artifacts) writeFileSync(file, content, 'utf8');
    written += artifacts.length;
  }
}

{
  const input = readJson(join(FIXTURES, EXAMPLE.fixture, 'input.json'));
  const report = buildReport({
    commits: input.commits,
    project: { ...input.project, dedication: null },
    config: {
      ...input.config,
      language: EXAMPLE.language,
      tone: EXAMPLE.tone,
      includeMergeCommits: false,
      theme: 'auto',
    },
    range: { since: null, until: null, truncated: false },
    generator: { version: VERSION, generatedAt: GENERATED_AT },
    capsule: null,
  });

  const markdown = renderMarkdown(report, loadDictionary(EXAMPLE.language));

  if (checkOnly) {
    if (!existsSync(EXAMPLE.path) || readFileSync(EXAMPLE.path, 'utf8') !== markdown) {
      drifted.push('docs/example-chronicle.md');
    }
  } else {
    writeFileSync(EXAMPLE.path, markdown, 'utf8');
  }
}

if (checkOnly) {
  if (drifted.length > 0) {
    console.error('The expected reports no longer match what the engine produces:\n');
    for (const file of drifted) console.error(`  ${file}`);
    console.error(
      '\nIf the change was intended, run `npm run fixtures:generate -w egehan` and review the diff\n' +
        'sentence by sentence before committing it.\n',
    );
    process.exit(1);
  }
  console.log(`✔ expected reports match the engine (${fixtures.length} fixture(s))`);
} else {
  console.log(`✔ wrote ${written} expected report(s) across ${fixtures.length} fixture(s)`);
}
