import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FIXTURES = join(ROOT, 'fixtures');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

// Strict everywhere except union types: `milestone.value` is legitimately a number (a commit
// count), a string (a version tag) or null, and expressing that as a type array keeps the schema
// readable for the .NET and future ports that also consume it.
const newAjv = () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  return ajv;
};

// A fixture is a directory with an input; `capsule/` holds interop material, not a history.
const fixtureDirs = readdirSync(FIXTURES).filter(
  (name) => statSync(join(FIXTURES, name)).isDirectory() && existsSync(join(FIXTURES, name, 'input.json')),
);

test('the report schema compiles as a strict JSON Schema 2020-12 document', () => {
  const schema = readJson(join(ROOT, 'schema', 'egehan-report.schema.json'));
  assert.doesNotThrow(() => newAjv().compile(schema));
});

test('the fixture input schema compiles as a strict JSON Schema 2020-12 document', () => {
  const schema = readJson(join(FIXTURES, 'fixture-input.schema.json'));
  assert.doesNotThrow(() => newAjv().compile(schema));
});

test('at least one conformance fixture exists', () => {
  assert.ok(fixtureDirs.length > 0, 'fixtures/ holds no fixture directories');
});

test('every fixture input satisfies the fixture input schema', () => {
  const validate = newAjv().compile(readJson(join(FIXTURES, 'fixture-input.schema.json')));
  for (const name of fixtureDirs) {
    const input = readJson(join(FIXTURES, name, 'input.json'));
    const ok = validate(input);
    assert.ok(
      ok,
      `fixture "${name}" violates the input schema:\n${(validate.errors ?? [])
        .map((e) => `  ${e.instancePath || '/'} ${e.message}`)
        .join('\n')}`,
    );
    assert.equal(input.fixture, name, `fixture "${name}" declares a different id: "${input.fixture}"`);
  }
});

test('every fixture history is internally coherent', () => {
  for (const name of fixtureDirs) {
    const { commits } = readJson(join(FIXTURES, name, 'input.json'));

    const seen = new Set();
    let previous = null;

    for (const [index, commit] of commits.entries()) {
      const at = `fixture "${name}" commit #${index + 1} (${commit.sha.slice(0, 7)})`;

      assert.ok(!seen.has(commit.sha), `${at}: duplicate sha`);
      seen.add(commit.sha);

      for (const parent of commit.parents) {
        assert.ok(
          seen.has(parent),
          `${at}: parent ${parent.slice(0, 7)} does not appear earlier in the history`,
        );
      }

      const authored = Date.parse(commit.authoredAt);
      assert.ok(Number.isFinite(authored), `${at}: unparseable authoredAt`);
      if (previous !== null) {
        assert.ok(authored >= previous, `${at}: history is not in chronological order`);
      }
      previous = authored;

      assert.ok(Date.parse(commit.committedAt) >= authored, `${at}: committedAt precedes authoredAt`);

      const paths = commit.files.map((f) => f.path);
      assert.equal(new Set(paths).size, paths.length, `${at}: the same path appears twice`);
    }

    assert.equal(commits[0].parents.length, 0, `fixture "${name}": the first commit must be a root commit`);
  }
});

test('fixture 01-frontend-saas reproduces the worked example from the specification', () => {
  const { commits } = readJson(join(FIXTURES, '01-frontend-saas', 'input.json'));
  const example = commits.find((c) => c.subject === 'fix: token refresh race condition');

  assert.ok(example, 'the worked example commit is missing');
  assert.equal(example.authoredAt, '2025-03-14T03:18:42+03:00');
  assert.equal(example.files.length, 4, 'the worked example must touch 4 files');
  assert.equal(
    example.files.reduce((sum, f) => sum + f.insertions, 0),
    85,
  );
  assert.equal(
    example.files.reduce((sum, f) => sum + f.deletions, 0),
    42,
  );
});

test('fixture 01-frontend-saas exercises every classification rule', () => {
  const rules = readJson(join(ROOT, 'spec', 'rules.json'));
  const { commits } = readJson(join(FIXTURES, '01-frontend-saas', 'input.json'));

  const localHour = (iso) => Number.parseInt(iso.slice(11, 13), 10);
  const { localHourFrom, localHourTo } = rules.classification.categories['midnight-oil'];
  const { refactorDeletionRatio, refactorMinChangedLines, minFixCommitsInCluster, clusterWindowHours } =
    rules.classification.categories['growing-pains'];
  const { largeInsertionThreshold, tagPattern } = rules.classification.categories.milestone;

  const stats = (c) => ({
    insertions: c.files.reduce((s, f) => s + f.insertions, 0),
    deletions: c.files.reduce((s, f) => s + f.deletions, 0),
  });

  // birth: a root commit exists
  assert.equal(commits[0].parents.length, 0);

  // birth setup window: a second commit lands inside the documented window
  const hoursBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 3_600_000;
  assert.ok(
    hoursBetween(commits[0].authoredAt, commits[1].authoredAt) <
      rules.classification.categories.birth.setupWindowHours,
  );

  // midnight-oil: at least one commit inside the local small hours
  assert.ok(
    commits.some((c) => {
      const hour = localHour(c.authoredAt);
      return hour >= localHourFrom && hour <= localHourTo;
    }),
    'no commit falls inside the midnight window',
  );

  // growing-pains, cluster branch: enough fixes inside the window
  const fixes = commits.filter((c) => /^fix(\(|!|:)/.test(c.subject));
  assert.ok(fixes.length >= minFixCommitsInCluster, 'not enough fix commits for a cluster');
  const clustered = fixes.filter(
    (c, i, all) =>
      i >= minFixCommitsInCluster - 1 &&
      hoursBetween(all[i - (minFixCommitsInCluster - 1)].authoredAt, c.authoredAt) <= clusterWindowHours,
  );
  assert.ok(clustered.length > 0, 'the fix commits never fall inside one cluster window');

  // growing-pains, refactor branch: a deletion-heavy commit
  assert.ok(
    commits.some((c) => {
      const { insertions, deletions } = stats(c);
      return (
        deletions > insertions * refactorDeletionRatio && insertions + deletions >= refactorMinChangedLines
      );
    }),
    'no deletion-heavy refactor commit',
  );

  // milestone: a semver tag and an architectural leap
  const tagged = commits.filter((c) => (c.tags ?? []).some((t) => new RegExp(tagPattern).test(t)));
  assert.ok(tagged.length >= 2, 'fewer than two tagged releases');
  assert.ok(
    commits.some((c) => stats(c).insertions >= largeInsertionThreshold),
    'no commit crosses the architectural-leap threshold',
  );

  // evolution: perf, test and docs commits all present
  for (const prefix of ['perf:', 'test:', 'docs:']) {
    assert.ok(
      commits.some((c) => c.subject.startsWith(prefix)),
      `no ${prefix} commit`,
    );
  }

  // a merge commit, so merge handling is covered
  assert.ok(
    commits.some((c) => c.parents.length > 1),
    'no merge commit',
  );

  // more than one author, so author aggregation is covered
  assert.ok(new Set(commits.map((c) => c.authorEmail)).size > 1, 'only one author');
});
