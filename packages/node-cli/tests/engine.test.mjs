import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTimestamp,
  inclusiveDaySpan,
  hoursBetween,
  formatClock,
  formatDate,
  nowIso,
} from '../dist/engine/datetime.js';
import { parseSubject, cleanSubject } from '../dist/engine/conventional.js';
import { hashIndex, interpolate, selectAndFill } from '../dist/engine/templating.js';
import { buildAuthors, hashEmail, redactEmailsIn } from '../dist/engine/privacy.js';
import { detectProjectTypes, globToRegExp } from '../dist/detect/projectType.js';
import { buildReport } from '../dist/engine/buildReport.js';
import { loadRules } from '../dist/spec/rules.js';
import { loadDictionary } from '../dist/spec/dictionary.js';

const rules = loadRules();

/* ------------------------------------------------------------------ *
 * Fixtures for synthetic histories
 * ------------------------------------------------------------------ */

let counter = 0;
const nextSha = () => (++counter).toString(16).padStart(40, 'c');

const commit = ({ at, subject, insertions = 5, deletions = 1, files = 1, tags = [], body = '', parents }) => {
  const sha = nextSha();
  return {
    sha,
    parents: parents ?? ['0'.repeat(40)],
    authorName: 'Ada Yılmaz',
    authorEmail: 'ada@example.com',
    authoredAt: at,
    committedAt: at,
    subject,
    body,
    tags,
    files: Array.from({ length: files }, (_, index) => ({
      path: `src/file-${index}.ts`,
      insertions: index === 0 ? insertions : 0,
      deletions: index === 0 ? deletions : 0,
    })),
  };
};

const reportFrom = (commits, overrides = {}) =>
  buildReport({
    commits,
    project: {
      name: 'test',
      dedication: null,
      detectedTypes: ['node'],
      flavor: 'frontend',
      defaultBranch: 'main',
      remoteHost: null,
    },
    config: {
      language: 'tr',
      tone: 'minimalist',
      redactEmails: true,
      anonymizeAuthors: false,
      includeMergeCommits: false,
      theme: 'auto',
      ...overrides,
    },
    range: { since: null, until: null, truncated: false },
    generator: { version: '0.0.0-test', generatedAt: '2026-01-01T00:00:00+00:00' },
    capsule: null,
  });

const categoryOf = (report, index) => report.entries[index].category;

/* ------------------------------------------------------------------ *
 * datetime — the timezone contract
 * ------------------------------------------------------------------ */

test("parseTimestamp keeps the commit's own wall clock and offset", () => {
  const at = parseTimestamp('2026-03-14T03:18:42+03:00');

  assert.equal(at.hour, 3);
  assert.equal(at.minute, 18);
  assert.equal(at.offsetMinutes, 180);
  assert.equal(at.dayKey, '2026-03-14');
  assert.equal(at.monthKey, '2026-03');
  assert.equal(at.weekday, 5, '14 March 2026 is a Saturday, and 0 means Monday');
});

test('parseTimestamp handles Z and negative offsets', () => {
  assert.equal(parseTimestamp('2026-03-14T03:18:42Z').offsetMinutes, 0);
  assert.equal(parseTimestamp('2026-03-14T23:18:42-08:00').offsetMinutes, -480);
  assert.equal(
    parseTimestamp('2026-03-14T23:18:42-08:00').hour,
    23,
    'the local hour is the one written down',
  );
  assert.equal(parseTimestamp('2026-03-14T03:18:42.123+03:00').second, 42);
});

test('parseTimestamp rejects a timestamp with no offset', () => {
  assert.throws(() => parseTimestamp('2026-03-14 03:18:42'), /ISO-8601/);
  assert.throws(() => parseTimestamp('2026-03-14T03:18:42'), /ISO-8601/);
});

test('day spans are counted on the calendar, not in milliseconds', () => {
  const late = parseTimestamp('2026-03-14T23:50:00+03:00');
  const early = parseTimestamp('2026-03-15T00:10:00+03:00');

  assert.equal(inclusiveDaySpan(late, early), 2, 'twenty minutes apart, but two calendar days');
  assert.ok(hoursBetween(late, early) < 1);
  assert.equal(
    inclusiveDaySpan(parseTimestamp('2026-01-01T12:00:00Z'), parseTimestamp('2026-12-31T12:00:00Z')),
    365,
  );
});

test('date and clock formatting is driven by the dictionary', () => {
  const tr = loadDictionary('tr');
  const en = loadDictionary('en');
  const at = parseTimestamp('2026-03-14T03:18:42+03:00');

  assert.equal(formatClock(at, tr.locale.timeFormat), '03:18');
  assert.equal(formatDate(at, tr.locale.dateFormat, tr.locale.months), '14 Mart 2026');
  assert.equal(formatDate(at, en.locale.dateFormat, en.locale.months), '14 March 2026');
});

test('nowIso records an offset rather than normalizing to UTC', () => {
  assert.match(nowIso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/);
});

/* ------------------------------------------------------------------ *
 * conventional commits
 * ------------------------------------------------------------------ */

const parse = (subject, body = '', parents = ['x']) =>
  parseSubject({ subject, body, parents, files: [] }, rules, 'tr');

test('an explicit conventional prefix is parsed, not guessed', () => {
  const result = parse('fix(auth)!: token refresh race condition');

  assert.equal(result.conventional.type, 'fix');
  assert.equal(result.conventional.scope, 'auth');
  assert.equal(result.conventional.breaking, true);
  assert.equal(result.conventional.inferred, false);
  assert.equal(result.cleanSubject, 'token refresh race condition');
});

test('type aliases are canonicalized', () => {
  assert.equal(parse('hotfix: patch the thing').conventional.type, 'fix');
  assert.equal(parse('feature: shiny').conventional.type, 'feat');
  assert.equal(parse('documentation: readme').conventional.type, 'docs');
});

test('a repository with no conventional commits still gets classified', () => {
  assert.equal(parse('Oturum hatası düzeltme').conventional.type, 'fix');
  assert.equal(parse('yeni ekran ekle').conventional.type, 'feat');
  assert.equal(parse('Add dark mode').conventional.type, 'feat');
  assert.equal(parse('optimize the query').conventional.type, 'perf');
  assert.equal(parse('bump dependencies').conventional.type, 'chore');
  assert.equal(parse('asdfgh qwerty').conventional.type, 'unknown');
  assert.equal(parse('yeni ekran ekle').conventional.inferred, true);
});

test('keyword matching is whole-word and survives Turkish characters', () => {
  // "prefix" contains "fix" as a substring; a substring match would classify it as a fix.
  assert.notEqual(parse('rename prefix handling').conventional.type, 'fix');
  assert.equal(parse('düzeltme yapıldı').conventional.type, 'fix');
});

test('keyword classification does not depend on the host locale', () => {
  // A Turkish-locale lowercase maps I to ı, which would stop "FIX" matching "fix".
  assert.equal(parse('FIX the session').conventional.type, 'fix');
  assert.equal(parse('FIXED the session').conventional.type, 'fix');
});

test('merges and reverts are recognised', () => {
  assert.equal(parse('Merge branch "x" into main', '', ['a', 'b']).conventional.type, 'merge');
  assert.equal(parse('Merge pull request #12', '', ['a']).conventional.type, 'merge');
  assert.equal(parse('Revert "feat: thing"', '', ['a']).conventional.type, 'revert');
});

test('BREAKING CHANGE in the body marks a commit as breaking', () => {
  assert.equal(parse('feat: new billing', 'BREAKING CHANGE: endpoints moved').conventional.breaking, true);
  assert.equal(parse('feat: new billing', 'a normal body').conventional.breaking, false);
});

test('subject cleanup strips prefixes and tickets but spares a URL anchor', () => {
  assert.equal(cleanSubject('fix(auth): token refresh [EGE-128]', rules, 'tr'), 'token refresh');
  assert.equal(cleanSubject('feat: session loader race (#211)', rules, 'tr'), 'session loader race');
  assert.equal(
    cleanSubject('docs: see https://example.com/x#42', rules, 'tr'),
    'see https://example.com/x#42',
  );
  assert.equal(cleanSubject('chore: tidy up.', rules, 'tr'), 'tidy up');
});

test('subject cleanup never returns an empty string', () => {
  assert.equal(cleanSubject('chore:', rules, 'tr'), 'chore:');
  assert.equal(cleanSubject('   ', rules, 'tr'), '');
});

/* ------------------------------------------------------------------ *
 * determinism
 * ------------------------------------------------------------------ */

test('hashIndex implements the documented formula and tolerates upper case', () => {
  const sha = '3f2a1b9c4d5e6f708192a3b4c5d6e7f809a1b2c3';
  assert.equal(hashIndex(sha, 6, rules), 0x3f2a1b9c % 6);
  assert.equal(hashIndex(sha.toUpperCase(), 6, rules), 0x3f2a1b9c % 6);
  assert.throws(() => hashIndex(sha, 0, rules), /empty variant list/);
  assert.throws(() => hashIndex('zzzz', 3, rules), /hex digits/);
});

test('interpolation refuses an unknown placeholder instead of shipping it', () => {
  assert.equal(interpolate('{a} and {b}', { a: '1', b: '2' }, 'test'), '1 and 2');
  assert.throws(() => interpolate('{missing}', {}, 'test'), /does not provide/);
});

test('a template is skipped when the data it requires is absent', () => {
  const templates = [
    { text: 'tagged {tag} {subject}', requires: ['tag'] },
    { text: 'plain {subject}', requires: [] },
  ];
  const sha = 'a'.repeat(40);

  assert.equal(selectAndFill(templates, sha, { tag: '', subject: 's' }, rules, 'x').text, 'plain s');
  assert.match(
    selectAndFill(templates, sha, { tag: 'v1', subject: 's' }, rules, 'x').text,
    /^(tagged|plain)/,
  );
});

test('a zero count counts as absent, so "requires" can mean non-zero', () => {
  const templates = [
    { text: 'deleted {deletions} from {subject}', requires: ['deletions'] },
    { text: 'touched {subject}', requires: [] },
  ];
  const sha = 'b'.repeat(40);
  assert.equal(selectAndFill(templates, sha, { deletions: '0', subject: 's' }, rules, 'x').text, 'touched s');
});

/* ------------------------------------------------------------------ *
 * classification
 * ------------------------------------------------------------------ */

test('the first commit is always a birth, and its setup window follows', () => {
  const report = reportFrom([
    commit({ at: '2026-01-01T10:00:00+03:00', subject: 'chore: initial commit', parents: [] }),
    commit({ at: '2026-01-01T18:00:00+03:00', subject: 'chore: add tooling' }),
    commit({ at: '2026-01-05T18:00:00+03:00', subject: 'chore: more tooling' }),
  ]);

  assert.equal(categoryOf(report, 0), 'birth');
  assert.equal(categoryOf(report, 1), 'birth', 'inside the 24-hour setup window');
  assert.equal(categoryOf(report, 2), 'first-steps', 'outside it, and before any release');
});

test('three fixes inside the window are growing pains; a lone night fix is midnight oil', () => {
  const report = reportFrom([
    commit({ at: '2026-01-01T10:00:00+03:00', subject: 'chore: initial commit', parents: [] }),
    commit({ at: '2026-02-01T10:00:00+03:00', subject: 'fix: one' }),
    commit({ at: '2026-02-01T14:00:00+03:00', subject: 'fix: two' }),
    commit({ at: '2026-02-02T09:00:00+03:00', subject: 'fix: three' }),
    commit({ at: '2026-05-01T03:18:00+03:00', subject: 'fix: lonely night fix' }),
  ]);

  assert.equal(categoryOf(report, 1), 'growing-pains');
  assert.equal(categoryOf(report, 2), 'growing-pains');
  assert.equal(categoryOf(report, 3), 'growing-pains');
  assert.equal(categoryOf(report, 4), 'midnight-oil', 'one fix is not a cluster');
});

test('two fixes inside the window are not a cluster', () => {
  const report = reportFrom([
    commit({ at: '2026-01-01T10:00:00+03:00', subject: 'chore: initial commit', parents: [] }),
    commit({ at: '2026-02-01T10:00:00+03:00', subject: 'fix: one' }),
    commit({ at: '2026-02-01T14:00:00+03:00', subject: 'fix: two' }),
  ]);

  assert.notEqual(categoryOf(report, 1), 'growing-pains');
  assert.notEqual(categoryOf(report, 2), 'growing-pains');
});

test('a deletion-heavy refactor is growing pains, with midnight as a secondary', () => {
  const report = reportFrom([
    commit({ at: '2026-01-01T10:00:00+03:00', subject: 'chore: initial commit', parents: [] }),
    commit({
      at: '2026-06-15T02:41:00+03:00',
      subject: 'refactor: drop the legacy adapter',
      insertions: 120,
      deletions: 1010,
    }),
  ]);

  assert.equal(categoryOf(report, 1), 'growing-pains');
  assert.deepEqual(report.entries[1].secondaryCategories, ['midnight-oil']);
  assert.match(report.entries[1].narrative, /\S/);
});

test('a tagged release and a large leap are both milestones, and milestone wins the precedence', () => {
  const report = reportFrom([
    commit({ at: '2026-01-01T10:00:00+03:00', subject: 'chore: initial commit', parents: [] }),
    commit({ at: '2026-02-01T03:00:00+03:00', subject: 'chore(release): v1.0.0', tags: ['v1.0.0'] }),
    commit({ at: '2026-03-01T12:00:00+03:00', subject: 'feat: the big one', insertions: 4000 }),
  ]);

  assert.equal(categoryOf(report, 1), 'milestone', 'a night release is still a milestone first');
  assert.deepEqual(report.entries[1].secondaryCategories, ['midnight-oil']);
  assert.equal(categoryOf(report, 2), 'milestone');
});

test('a non-semver tag does not make a milestone', () => {
  const report = reportFrom([
    commit({ at: '2026-01-01T10:00:00+03:00', subject: 'chore: initial commit', parents: [] }),
    commit({ at: '2026-02-01T12:00:00+03:00', subject: 'docs: notes', tags: ['nightly'] }),
  ]);
  assert.equal(categoryOf(report, 1), 'evolution');
});

test('after the first release, foundational work is evolution rather than first steps', () => {
  const report = reportFrom([
    commit({ at: '2026-01-01T10:00:00+03:00', subject: 'chore: initial commit', parents: [] }),
    commit({ at: '2026-01-10T12:00:00+03:00', subject: 'feat: before release' }),
    commit({ at: '2026-02-01T12:00:00+03:00', subject: 'chore(release): v1.0.0', tags: ['v1.0.0'] }),
    commit({ at: '2026-03-01T12:00:00+03:00', subject: 'feat: after release' }),
  ]);

  assert.equal(categoryOf(report, 1), 'first-steps');
  assert.equal(categoryOf(report, 3), 'evolution');
});

test('merge commits are excluded unless asked for', () => {
  const commits = [
    commit({ at: '2026-01-01T10:00:00+03:00', subject: 'chore: initial commit', parents: [] }),
    commit({ at: '2026-01-02T10:00:00+03:00', subject: 'Merge branch "x"', parents: ['a', 'b'], files: 0 }),
  ];

  assert.equal(reportFrom(commits).totals.commits, 1);
  assert.equal(reportFrom(commits, { includeMergeCommits: true }).totals.commits, 2);
});

test('a history of nothing but merges says so instead of crashing', () => {
  assert.throws(
    () => reportFrom([commit({ at: '2026-01-01T10:00:00+03:00', subject: 'Merge', parents: ['a', 'b'] })]),
    /only merge commits/,
  );
});

/* ------------------------------------------------------------------ *
 * privacy
 * ------------------------------------------------------------------ */

test('e-mail addresses are hashed, not published, by default', () => {
  const commits = [commit({ at: '2026-01-01T10:00:00+03:00', subject: 'chore: init', parents: [] })];
  const report = reportFrom(commits);

  assert.equal(report.authors[0].email, null);
  assert.equal(report.authors[0].emailHash, hashEmail('ada@example.com', rules));
  assert.equal(report.authors[0].displayName, 'Ada Yılmaz');
  assert.equal(JSON.stringify(report).includes('ada@example.com'), false);
});

test('the hash is case-insensitive and stable, so one person stays one author', () => {
  assert.equal(hashEmail('Ada@Example.COM', rules), hashEmail(' ada@example.com ', rules));
  assert.equal(hashEmail('ada@example.com', rules).length, rules.privacy.emailHashPrefixLength);
});

test('opting out publishes the address, and anonymizing hides the name too', () => {
  const commits = [commit({ at: '2026-01-01T10:00:00+03:00', subject: 'chore: init', parents: [] })];

  assert.equal(reportFrom(commits, { redactEmails: false }).authors[0].email, 'ada@example.com');

  const anonymous = reportFrom(commits, { anonymizeAuthors: true });
  assert.equal(anonymous.authors[0].displayName, 'Geliştirici #1');
  assert.equal(anonymous.authors[0].email, null, 'anonymizing implies redaction');
});

test('an address inside a commit subject is redacted too', () => {
  assert.equal(
    redactEmailsIn('drop hardcoded admin@example.com from config', rules),
    'drop hardcoded [redacted] from config',
  );

  const report = reportFrom([
    commit({ at: '2026-01-01T10:00:00+03:00', subject: 'fix: drop admin@example.com', parents: [] }),
  ]);
  assert.equal(report.entries[0].cleanSubject.includes('admin@example.com'), false);
  assert.equal(JSON.stringify(report).includes('admin@example.com'), false);
});

test('authors are ordered by commit count with a total tie-break', () => {
  const mk = (email, name, at) => ({
    ...commit({ at, subject: 'feat: work' }),
    authorEmail: email,
    authorName: name,
  });

  const { authors } = buildAuthors(
    [
      mk('b@example.com', 'Beta', '2026-01-01T10:00:00+03:00'),
      mk('a@example.com', 'Alpha', '2026-01-02T10:00:00+03:00'),
      mk('a@example.com', 'Alpha', '2026-01-03T10:00:00+03:00'),
    ],
    rules,
    { redactEmails: true, anonymizeAuthors: false, language: 'en' },
  );

  assert.deepEqual(
    authors.map((author) => author.displayName),
    ['Alpha', 'Beta'],
  );
  assert.equal(authors[0].commits, 2);
});

test('an author who renames themselves keeps their latest spelling', () => {
  const mk = (name, at) => ({ ...commit({ at, subject: 'feat: work' }), authorName: name });

  const { authors } = buildAuthors(
    [mk('ada yilmaz', '2026-01-01T10:00:00+03:00'), mk('Ada Yılmaz', '2026-06-01T10:00:00+03:00')],
    rules,
    { redactEmails: true, anonymizeAuthors: false, language: 'tr' },
  );

  assert.equal(authors[0].displayName, 'Ada Yılmaz');
});

/* ------------------------------------------------------------------ *
 * pulse
 * ------------------------------------------------------------------ */

test('the chronotype follows the hours the work actually happened in', () => {
  const nightly = Array.from({ length: 10 }, (_, index) =>
    commit({ at: `2026-01-${String(index + 1).padStart(2, '0')}T02:30:00+03:00`, subject: 'feat: night' }),
  );
  assert.equal(reportFrom(nightly).pulse.chronotype, 'night-owl');

  const mornings = Array.from({ length: 10 }, (_, index) =>
    commit({ at: `2026-01-${String(index + 1).padStart(2, '0')}T07:30:00+03:00`, subject: 'feat: dawn' }),
  );
  assert.equal(reportFrom(mornings).pulse.chronotype, 'early-architect');
});

test('the busiest hour is the busiest period, not an arbitrary tie', () => {
  // One commit at each of 14 different hours: every raw count ties at one.
  const hours = [21, 22, 11, 16, 10, 14, 9, 18, 3, 13, 15, 23, 2, 12];
  const report = reportFrom(
    hours.map((hour, index) =>
      commit({
        at: `2026-01-${String(index + 1).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+03:00`,
        subject: 'feat: work',
      }),
    ),
  );

  assert.ok(
    report.pulse.busiestHour >= 9 && report.pulse.busiestHour <= 16,
    `smoothing should land in the daytime cluster, got ${report.pulse.busiestHour}`,
  );
});

test('streaks count calendar days and ignore today', () => {
  const report = reportFrom([
    commit({ at: '2026-01-01T10:00:00+03:00', subject: 'chore: init', parents: [] }),
    commit({ at: '2026-01-02T10:00:00+03:00', subject: 'feat: two' }),
    commit({ at: '2026-01-03T10:00:00+03:00', subject: 'feat: three' }),
    commit({ at: '2026-03-01T10:00:00+03:00', subject: 'feat: much later' }),
  ]);

  assert.equal(report.pulse.longestStreak.days, 3);
  assert.equal(report.pulse.longestStreak.from, '2026-01-01');
  assert.equal(report.pulse.longestStreak.to, '2026-01-03');
  assert.equal(report.pulse.currentStreak.days, 0, 'a single final day is below the reporting threshold');
});

test('ratios and averages are rounded to the precision the contract fixes', () => {
  const report = reportFrom([
    commit({
      at: '2026-01-01T10:00:00+03:00',
      subject: 'chore: init',
      insertions: 2,
      deletions: 1,
      parents: [],
    }),
  ]);

  const ratioDecimals = String(report.pulse.creationRatio).split('.')[1]?.length ?? 0;
  assert.ok(ratioDecimals <= rules.pulse.rounding.ratioDecimals);
  assert.equal(report.pulse.creationRatio, 0.6667);
});

/* ------------------------------------------------------------------ *
 * project type detection
 * ------------------------------------------------------------------ */

test('globs match within a segment, and ** crosses segments', () => {
  assert.ok(globToRegExp('*.csproj').test('Api.csproj'));
  assert.ok(!globToRegExp('*.csproj').test('src/Api.csproj'));
  assert.ok(globToRegExp('**/*.csproj').test('src/nested/Api.csproj'));
  assert.ok(globToRegExp('**/*.csproj').test('Api.csproj'), '** may match zero directories');
  assert.ok(globToRegExp('src/*.csproj').test('src/Api.csproj'));
});

test('the strongest detector decides the narrative flavour', () => {
  const flutter = detectProjectTypes({ files: ['pubspec.yaml', 'package.json'], directories: [] }, rules);
  assert.equal(flutter.flavor, 'mobile');
  assert.equal(flutter.detectedTypes[0], 'flutter');

  const dotnet = detectProjectTypes({ files: ['Api.csproj'], directories: [] }, rules);
  assert.equal(dotnet.flavor, 'backend');

  const next = detectProjectTypes({ files: ['next.config.js', 'package.json'], directories: [] }, rules);
  assert.equal(next.flavor, 'frontend');
  assert.deepEqual([...next.detectedTypes], ['frontend', 'node']);

  const nativeMobile = detectProjectTypes({ files: [], directories: ['ios', 'android'] }, rules);
  assert.equal(nativeMobile.flavor, 'mobile');

  const nothing = detectProjectTypes({ files: ['notes.txt'], directories: [] }, rules);
  assert.deepEqual([...nothing.detectedTypes], []);
  assert.equal(nothing.flavor, rules.projectTypes.fallbackFlavor);
});

test('a detector needing several directories is not satisfied by one', () => {
  const partial = detectProjectTypes({ files: [], directories: ['ios'] }, rules);
  assert.equal(partial.detectedTypes.includes('native-mobile'), false);
});
