import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateDictionaries,
  DEFAULT_DICTIONARY_DIR,
  DEFAULT_RULES_PATH,
  PACKAGE_ROOT,
} from '../scripts/validate-dictionaries.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * Builds a throwaway dictionary directory containing the real reference dictionary plus a
 * deliberately broken Turkish one, so each test isolates exactly one class of defect.
 *
 * @param {(dict: any) => void} mutate applied to the Turkish dictionary
 */
const withBrokenTurkish = (mutate) => {
  const dir = mkdtempSync(join(tmpdir(), 'egehan-dict-'));
  cpSync(join(DEFAULT_DICTIONARY_DIR, 'narratives.en.json'), join(dir, 'narratives.en.json'));
  const tr = readJson(join(DEFAULT_DICTIONARY_DIR, 'narratives.tr.json'));
  mutate(tr);
  writeFileSync(join(dir, 'narratives.tr.json'), JSON.stringify(tr, null, 2), 'utf8');
  return validateDictionaries({ dictionaryDir: dir, rulesPath: DEFAULT_RULES_PATH });
};

const hasProblem = (result, pattern) =>
  result.problems.some((p) => (pattern instanceof RegExp ? pattern.test(p) : p.includes(pattern)));

/* ------------------------------------------------------------------ *
 * The shipped dictionaries
 * ------------------------------------------------------------------ */

test('the shipped dictionaries satisfy the contract with no problems and no warnings', () => {
  const result = validateDictionaries();
  assert.deepEqual(result.problems, [], `unexpected problems:\n${result.problems.join('\n')}`);
  assert.deepEqual(result.warnings, [], `unexpected warnings:\n${result.warnings.join('\n')}`);
  assert.deepEqual(result.languages.sort(), ['en', 'tr']);
});

/* ------------------------------------------------------------------ *
 * The gate must actually close — one negative test per defect class
 * ------------------------------------------------------------------ */

test('rejects a template that interpolates a placeholder the engine does not provide', () => {
  const result = withBrokenTurkish((tr) => {
    tr.categories.birth.entries.poetic[0] = '{date} günü «{subject}» ve {fliesCount} dosya.';
  });
  assert.ok(hasProblem(result, /interpolates \{fliesCount\}/), result.problems.join('\n'));
});

test('rejects a chapter narrative that uses an entry-only placeholder', () => {
  const result = withBrokenTurkish((tr) => {
    tr.categories.evolution.chapterNarratives.minimalist[0] = '{from} – {to}: «{subject}».';
  });
  assert.ok(hasProblem(result, /interpolates \{subject\}/), result.problems.join('\n'));
});

test('rejects an entry template that never mentions the commit subject', () => {
  const result = withBrokenTurkish((tr) => {
    tr.categories.evolution.entries.minimalist[0] = '{date} — {files}, +{insertions}/-{deletions}.';
  });
  assert.ok(hasProblem(result, /never mentions \{subject\}/), result.problems.join('\n'));
});

test('rejects a "requires" entry that the template never interpolates', () => {
  const result = withBrokenTurkish((tr) => {
    tr.categories.milestone.entries.poetic[2] = {
      t: '{date} tarihinde «{subject}» yapıldı.',
      requires: ['tag'],
    };
  });
  assert.ok(hasProblem(result, /requires \{tag\} but never interpolates it/), result.problems.join('\n'));
});

test('rejects a "requires" entry naming a placeholder outside the section contract', () => {
  const result = withBrokenTurkish((tr) => {
    tr.categories.milestone.entries.poetic[2] = {
      t: '{date} tarihinde «{subject}» yapıldı — {commits}.',
      requires: ['commits'],
    };
  });
  assert.ok(
    hasProblem(result, /requires \{commits\}, which is not a placeholder/),
    result.problems.join('\n'),
  );
});

test('rejects a duplicated variant inside one list, which would skew the deterministic choice', () => {
  const result = withBrokenTurkish((tr) => {
    tr.categories.birth.entries.humorous[1] = tr.categories.birth.entries.humorous[0];
  });
  assert.ok(hasProblem(result, /duplicates an earlier variant/), result.problems.join('\n'));
});

test('rejects a missing category declared by spec/rules.json', () => {
  const result = withBrokenTurkish((tr) => {
    delete tr.categories['growing-pains'];
  });
  assert.ok(hasProblem(result, /no entry for category "growing-pains"/), result.problems.join('\n'));
});

test('rejects an empty tone variant list', () => {
  const result = withBrokenTurkish((tr) => {
    tr.categories['midnight-oil'].entries.poetic = [];
  });
  assert.ok(
    hasProblem(result, /midnight-oil" → entries → poetic is missing or empty/),
    result.problems.join('\n'),
  );
});

test('rejects a missing chronotype', () => {
  const result = withBrokenTurkish((tr) => {
    delete tr.pulse.chronotypes['balanced-rhythm'];
  });
  assert.ok(hasProblem(result, /chronotype "balanced-rhythm"/), result.problems.join('\n'));
});

test('rejects a language whose key structure diverges from the reference', () => {
  const result = withBrokenTurkish((tr) => {
    tr.ui.somethingNobodyElseHas = 'drift';
    delete tr.ui.noResults;
  });
  assert.ok(hasProblem(result, /declares "ui.somethingNobodyElseHas"/), result.problems.join('\n'));
  assert.ok(hasProblem(result, /missing "ui.noResults"/), result.problems.join('\n'));
});

test('rejects a dictionary whose declared language disagrees with its filename', () => {
  const result = withBrokenTurkish((tr) => {
    tr.language = 'de';
  });
  assert.ok(
    hasProblem(result, /declares language "de" but its filename says "tr"/),
    result.problems.join('\n'),
  );
});

test('rejects a template object carrying an unsupported key', () => {
  const result = withBrokenTurkish((tr) => {
    tr.categories.birth.entries.poetic[0] = {
      t: '{date} — «{subject}».',
      weight: 5,
    };
  });
  assert.ok(hasProblem(result, /unsupported key\(s\): weight/), result.problems.join('\n'));
});

test('warns, but does not fail, when a translation has fewer variants than the reference', () => {
  const result = withBrokenTurkish((tr) => {
    tr.categories.evolution.entries.humorous = tr.categories.evolution.entries.humorous.slice(0, 2);
  });
  assert.deepEqual(result.problems, [], result.problems.join('\n'));
  assert.ok(
    result.warnings.some((w) => /categories\.evolution\.entries\.humorous has 2 variant\(s\)/.test(w)),
    result.warnings.join('\n'),
  );
});

/* ------------------------------------------------------------------ *
 * spec/rules.json must be internally consistent
 * ------------------------------------------------------------------ */

test('rules.json: every category is covered by the evaluation order, exactly once', () => {
  const rules = readJson(DEFAULT_RULES_PATH);
  const declared = Object.keys(rules.classification.categories).sort();
  const ordered = [...rules.classification.evaluationOrder].sort();
  assert.deepEqual(ordered, declared);
  assert.equal(
    new Set(rules.classification.evaluationOrder).size,
    rules.classification.evaluationOrder.length,
    'evaluationOrder must not repeat a category',
  );
});

test('rules.json: exactly one category is the fallback, and it is last in the evaluation order', () => {
  const rules = readJson(DEFAULT_RULES_PATH);
  const fallbacks = Object.entries(rules.classification.categories)
    .filter(([, c]) => c.isFallback === true)
    .map(([id]) => id);
  assert.deepEqual(fallbacks, ['evolution']);
  assert.equal(rules.classification.evaluationOrder.at(-1), 'evolution');
});

test('rules.json: modifier categories are real categories', () => {
  const rules = readJson(DEFAULT_RULES_PATH);
  for (const modifier of rules.classification.modifierCategories) {
    assert.ok(
      Object.hasOwn(rules.classification.categories, modifier),
      `modifierCategories names "${modifier}", which is not a category`,
    );
  }
});

test('rules.json: chronotype hours are valid, unique per chronotype, and ids are distinct', () => {
  const rules = readJson(DEFAULT_RULES_PATH);
  const ids = rules.pulse.chronotypes.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'chronotype ids must be distinct');
  assert.ok(
    !ids.includes(rules.pulse.fallbackChronotype),
    'the fallback must not also be a detected chronotype',
  );
  for (const chronotype of rules.pulse.chronotypes) {
    assert.equal(new Set(chronotype.hours).size, chronotype.hours.length, `${chronotype.id} repeats an hour`);
    for (const hour of chronotype.hours) {
      assert.ok(
        Number.isInteger(hour) && hour >= 0 && hour <= 23,
        `${chronotype.id} has an invalid hour: ${hour}`,
      );
    }
    assert.ok(
      chronotype.minShare > 0 && chronotype.minShare <= 1,
      `${chronotype.id} has an invalid minShare`,
    );
  }
});

test('rules.json: size buckets ascend and end open-ended', () => {
  const rules = readJson(DEFAULT_RULES_PATH);
  const buckets = rules.pulse.sizeBuckets;
  assert.equal(buckets.at(-1).maxChangedLines, null, 'the last size bucket must be open-ended');
  const bounded = buckets.slice(0, -1).map((b) => b.maxChangedLines);
  for (let i = 1; i < bounded.length; i += 1) {
    assert.ok(bounded[i] > bounded[i - 1], 'size buckets must ascend');
  }
});

test('rules.json: the midnight window is a real window inside a single day', () => {
  const { localHourFrom, localHourTo } =
    readJson(DEFAULT_RULES_PATH).classification.categories['midnight-oil'];
  assert.ok(localHourFrom >= 0 && localHourTo <= 23 && localHourFrom < localHourTo);
});

test('rules.json: the capsule parameters are not weaker than the documented floor', () => {
  const { capsule } = readJson(DEFAULT_RULES_PATH);
  assert.equal(capsule.mode, 'sealed', 'a passphrase-free capsule mode must not exist');
  assert.equal(capsule.kdf, 'PBKDF2');
  assert.equal(capsule.cipher, 'AES-256-GCM');
  assert.ok(capsule.iterations >= 600000, 'PBKDF2 iterations must not drop below the documented floor');
  assert.ok(capsule.saltBytes >= 16 && capsule.ivBytes === 12 && capsule.authTagBits === 128);
  assert.ok(capsule.minPassphraseLength >= 12);
  assert.equal(capsule.trackedByGitByDefault, false, 'capsules must never be git-tracked by default');
});

test('rules.json: privacy defaults protect e-mail addresses out of the box', () => {
  const { privacy } = readJson(DEFAULT_RULES_PATH);
  assert.equal(privacy.redactEmailsByDefault, true);
  assert.equal(privacy.emailHashAlgorithm, 'sha256');
  assert.ok(privacy.emailHashPrefixLength >= 8);
  assert.ok(new RegExp(privacy.emailPattern).test('someone@example.com'));
});

test('rules.json: git invocations always force UTF-8 log output', () => {
  const { git } = readJson(DEFAULT_RULES_PATH);
  const flags = git.mandatoryFlags.join(' ');
  assert.match(flags, /i18n\.logOutputEncoding=UTF-8/);
  assert.match(flags, /core\.quotepath=false/);
  assert.notEqual(git.recordSeparator, git.fieldSeparator);
});

test('rules.json: the conventional-commit pattern and its aliases behave as documented', () => {
  const { conventionalCommits } = readJson(DEFAULT_RULES_PATH);
  const pattern = new RegExp(conventionalCommits.pattern);

  const parsed = pattern.exec('fix(auth)!: token refresh race condition');
  assert.ok(parsed, 'a full conventional subject must match');
  assert.equal(parsed.groups.type, 'fix');
  assert.equal(parsed.groups.scope, 'auth');
  assert.equal(parsed.groups.breaking, '!');
  assert.equal(parsed.groups.subject, 'token refresh race condition');

  assert.ok(pattern.exec('feat: yeni özellik'), 'a scope-free subject must match');
  assert.equal(
    pattern.exec('merged the branch'),
    null,
    'prose must not be mistaken for a conventional subject',
  );

  for (const [alias, canonical] of Object.entries(conventionalCommits.typeAliases)) {
    assert.notEqual(alias, canonical, `alias "${alias}" maps to itself, which is noise`);
  }
});

test('rules.json: subject cleanup strips prefixes and trailing ticket references', () => {
  const { subjectCleanup } = readJson(DEFAULT_RULES_PATH).conventionalCommits;
  const stripPrefix = new RegExp(subjectCleanup.stripPrefixPattern);
  const stripTicket = new RegExp(subjectCleanup.stripTicketPattern);

  assert.equal('fix(auth): token refresh'.replace(stripPrefix, ''), 'token refresh');
  assert.equal('feat!: yeni akış'.replace(stripPrefix, ''), 'yeni akış');
  assert.equal('token refresh [EGE-128]'.replace(stripTicket, ''), 'token refresh');
  assert.equal('token refresh (#42)'.replace(stripTicket, ''), 'token refresh');
  assert.equal('see https://example.com/x#42'.replace(stripTicket, ''), 'see https://example.com/x#42');
});

test('rules.json: project-type detectors have distinct ids and known flavors', () => {
  const rules = readJson(DEFAULT_RULES_PATH);
  const flavors = new Set(['frontend', 'mobile', 'backend', 'systems', 'library']);
  const ids = rules.projectTypes.detectors.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'detector ids must be distinct');
  for (const detector of rules.projectTypes.detectors) {
    assert.ok(flavors.has(detector.flavor), `detector "${detector.id}" has an unknown flavor`);
    assert.ok(Number.isFinite(detector.priority), `detector "${detector.id}" has no priority`);
    assert.ok(
      detector.anyFile || detector.anyGlob || detector.allDirs,
      `detector "${detector.id}" declares no markers`,
    );
  }
  assert.ok(flavors.has(rules.projectTypes.fallbackFlavor));
});

test('rules.json: every flavor used by detectors has narrative vocabulary in every dictionary', () => {
  const rules = readJson(DEFAULT_RULES_PATH);
  const used = new Set(
    rules.projectTypes.detectors.map((d) => d.flavor).concat(rules.projectTypes.fallbackFlavor),
  );
  for (const language of ['tr', 'en']) {
    const dict = readJson(join(DEFAULT_DICTIONARY_DIR, `narratives.${language}.json`));
    for (const flavor of used) {
      const vocabulary = dict.flavors[flavor];
      assert.ok(vocabulary, `narratives.${language}.json has no vocabulary for flavor "${flavor}"`);
      for (const slot of ['subject', 'artifact', 'layer', 'domain']) {
        assert.ok(vocabulary[slot], `narratives.${language}.json → flavors.${flavor}.${slot} is missing`);
      }
    }
  }
});

/* ------------------------------------------------------------------ *
 * The determinism contract
 * ------------------------------------------------------------------ */

test('the determinism formula is stable, in range, and distributes across variants', () => {
  const { hashPrefixLength, hashRadix } = readJson(DEFAULT_RULES_PATH).determinism;
  const pick = (sha, length) =>
    Number.parseInt(sha.toLowerCase().slice(0, hashPrefixLength), hashRadix) % length;

  // Stability: the documented formula on a known sha must never move.
  assert.equal(pick('3f2a1b9c4d5e6f708192a3b4c5d6e7f809a1b2c3', 6), 0x3f2a1b9c % 6);
  assert.equal(pick('3F2A1B9C4D5E6F708192A3B4C5D6E7F809A1B2C3', 6), 0x3f2a1b9c % 6, 'case must not matter');

  // Every result is a usable index.
  const shas = Array.from({ length: 500 }, (_, i) => i.toString(16).padStart(40, 'a'));
  for (const sha of shas) {
    const index = pick(sha, 6);
    assert.ok(Number.isInteger(index) && index >= 0 && index < 6);
  }

  // And the choice is not degenerate: real shas must reach more than one variant.
  const spread = new Set(
    [
      '0a1b2c3d',
      '1f2e3d4c',
      '2b3c4d5e',
      '3a4b5c6d',
      '4e5f6a7b',
      '5d6e7f80',
      '6c7d8e9f',
      '7b8c9daf',
      '8a9bacbd',
      '9faebdcc',
    ].map((prefix) => pick(prefix.padEnd(40, '0'), 6)),
  );
  assert.ok(spread.size >= 4, `deterministic choice collapsed onto ${spread.size} variant(s)`);
});

test('the report schema declares the same categories and tones as the rules and dictionaries', () => {
  const schema = readJson(join(PACKAGE_ROOT, 'schema', 'egehan-report.schema.json'));
  const rules = readJson(DEFAULT_RULES_PATH);

  assert.deepEqual(
    [...schema.$defs.category.enum].sort(),
    Object.keys(rules.classification.categories).sort(),
  );
  assert.deepEqual([...schema.$defs.tone.enum].sort(), ['humorous', 'minimalist', 'poetic']);
  assert.deepEqual(
    [...schema.$defs.pulse.properties.chronotype.enum].sort(),
    rules.pulse.chronotypes
      .map((c) => c.id)
      .concat(rules.pulse.fallbackChronotype)
      .sort(),
  );
  assert.deepEqual(
    [...schema.$defs.projectFlavor.enum].sort(),
    [...new Set(rules.projectTypes.detectors.map((d) => d.flavor))].sort(),
  );
  assert.equal(schema.properties.schemaVersion.pattern, '^\\d+\\.\\d+\\.\\d+$');
  assert.equal(rules.schemaVersion, '1.0.0');
});

test('the report schema forbids a capsule mode other than sealed', () => {
  const schema = readJson(join(PACKAGE_ROOT, 'schema', 'egehan-report.schema.json'));
  assert.equal(schema.$defs.capsule.properties.mode.const, 'sealed');
  assert.equal(schema.$defs.capsule.properties.algorithm.properties.kdf.const, 'PBKDF2');
  assert.equal(schema.$defs.capsule.properties.algorithm.properties.cipher.const, 'AES-256-GCM');
});

test('the dictionaries carry no personal content — this repository ships no dedication', () => {
  for (const language of ['tr', 'en']) {
    const raw = readFileSync(join(DEFAULT_DICTIONARY_DIR, `narratives.${language}.json`), 'utf8');
    assert.doesNotMatch(raw, /egehan['’]?a|dear son|oğluma|ithaf/i, 'dictionaries must stay impersonal');
  }
});

test('rules.json: the keyword fallback order covers every keyword group exactly once', () => {
  const { keywordFallback, keywordFallbackOrder } = readJson(DEFAULT_RULES_PATH).conventionalCommits;
  const groups = Object.keys(keywordFallback).filter((k) => !k.startsWith('$'));

  assert.deepEqual([...keywordFallbackOrder].sort(), groups.sort());
  assert.equal(
    new Set(keywordFallbackOrder).size,
    keywordFallbackOrder.length,
    'the order must not repeat a group',
  );

  // The order is what makes the fallback portable: an engine iterating the map instead would
  // classify subjects differently wherever map ordering differs, .NET included.
  for (const group of keywordFallbackOrder) {
    assert.ok(keywordFallback[group].length > 0, `keyword group "${group}" is empty`);
    const lowercased = keywordFallback[group].map((k) => k.toLowerCase());
    assert.deepEqual(lowercased, keywordFallback[group], `keyword group "${group}" must be lowercase`);
    assert.equal(new Set(lowercased).size, lowercased.length, `keyword group "${group}" repeats a keyword`);
  }
});
