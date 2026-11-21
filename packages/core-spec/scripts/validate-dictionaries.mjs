#!/usr/bin/env node
/**
 * Validates every narrative dictionary against the Egehan contract.
 *
 * A dictionary is data that both engines interpolate at runtime, which means a typo in a placeholder
 * name does not crash anything — it quietly ships a sentence with a literal `{fliesCount}` in it to a
 * keepsake someone intends to keep for years. That is exactly the class of bug this script exists to
 * make impossible, so it is wired into CI as a hard gate rather than offered as a convenience.
 *
 * Checks performed:
 *   1. Every dictionary parses and declares `language` and `version`.
 *   2. Every dictionary's key structure mirrors the reference dictionary (narratives.en.json).
 *   3. Every category declared in spec/rules.json exists, with all three tones and no empty variant list.
 *   4. Every `{placeholder}` a template interpolates is one the engine actually provides for that section.
 *   5. Every `requires` entry names a placeholder that the same template interpolates.
 *   6. No template is blank, duplicated within its own variant list, or missing its subject reference.
 *
 * Exit code 0 = contract satisfied. Non-zero = CI must fail.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(HERE, '..');
export const DEFAULT_DICTIONARY_DIR = join(PACKAGE_ROOT, 'dictionary');
export const DEFAULT_RULES_PATH = join(PACKAGE_ROOT, 'spec', 'rules.json');
const REFERENCE_LANGUAGE = 'en';

/* ------------------------------------------------------------------ *
 * Placeholder contract — what the engine guarantees, section by section.
 * Keeping this table here rather than in the engines is deliberate: it is
 * part of the contract, and both engines must satisfy it.
 * ------------------------------------------------------------------ */
const ENTRY_PLACEHOLDERS = new Set([
  'author',
  'date',
  'dateShort',
  'time',
  'weekday',
  'month',
  'year',
  'files',
  'filesCount',
  'additions',
  'removals',
  'insertions',
  'deletions',
  'changedLines',
  'subject',
  'scope',
  'tag',
  'flavorSubject',
  'flavorArtifact',
  'flavorLayer',
  'flavorDomain',
]);

const CHAPTER_PLACEHOLDERS = new Set([
  'commits',
  'commitsCount',
  'span',
  'from',
  'to',
  'range',
  'period',
  'authorsCount',
  'files',
  'filesCount',
  'additions',
  'removals',
  'insertions',
  'deletions',
  'changedLines',
  'flavorSubject',
  'flavorArtifact',
  'flavorLayer',
  'flavorDomain',
]);

/** section path prefix -> allowed placeholder set */
const SECTION_CONTRACT = [
  {
    match: /^categories\.[^.]+\.entries\./,
    allowed: ENTRY_PLACEHOLDERS,
    label: 'entry template',
    unitBearing: true,
  },
  {
    match: /^categories\.[^.]+\.chapterNarratives\./,
    allowed: CHAPTER_PLACEHOLDERS,
    label: 'chapter narrative',
    unitBearing: true,
  },
  { match: /^categories\.[^.]+\.chapterTitles\./, allowed: new Set(), label: 'chapter title' },
  { match: /^modifiers\./, allowed: ENTRY_PLACEHOLDERS, label: 'modifier clause', unitBearing: true },
  {
    match: /^pulse\.chronotypes\.[^.]+\.narratives\./,
    allowed: new Set(['busiestHour', 'busiestWeekday', 'commits']),
    label: 'chronotype narrative',
  },
  { match: /^pulse\.creation\./, allowed: new Set(['creationPercent']), label: 'creation summary' },
  { match: /^pulse\.streak\./, allowed: new Set(['streakDays', 'from', 'to']), label: 'streak summary' },
  { match: /^milestones\./, allowed: new Set(['value']), label: 'milestone label' },
  {
    match: /^locale\./,
    allowed: new Set(['day', 'month', 'year', 'hour', 'minute', 'from', 'to']),
    label: 'locale format',
  },
  { match: /^units\./, allowed: new Set(['n', 'unit']), label: 'unit format' },
  {
    match: /^ui\./,
    allowed: new Set([
      'project',
      'days',
      'commits',
      'version',
      'date',
      'unlockDate',
      'hours',
      'minutes',
      'hint',
      'author',
    ]),
    label: 'ui string',
  },
];

/** Sections whose templates must mention the commit subject, so a sentence is never pure metadata. */
const SUBJECT_REQUIRED = /^categories\.[^.]+\.entries\./;

/**
 * Placeholders that already carry their unit, mapped to the `units` key that supplies the word.
 *
 * `{files}` interpolates "4 dosya" / "4 files", so a template writing `{files} dosyada` produces
 * "4 dosya dosyada". The raw counterparts (`{filesCount}`, `{insertions}`, …) exist precisely so a
 * sentence can inflect the unit itself, and the two are one keystroke apart — which is why this is
 * checked mechanically instead of being left to review. Turkish makes it worse by suffixing the
 * unit ("dosyada", "dosyaya", "dosyayı"), so the check matches on the stem.
 */
const UNIT_BEARING_PLACEHOLDERS = {
  files: 'file',
  additions: 'line',
  removals: 'line',
  commits: 'commit',
  span: 'day',
};

/* ------------------------------------------------------------------ */

/**
 * Validates every dictionary in `dictionaryDir` against the rules in `rulesPath`.
 * Pure with respect to process state: it reads files and returns findings, it never exits.
 *
 * @param {{ dictionaryDir?: string, rulesPath?: string }} [options]
 * @returns {{ problems: string[], warnings: string[], languages: string[], files: string[] }}
 */
export function validateDictionaries(options = {}) {
  const DICT_DIR = options.dictionaryDir ?? DEFAULT_DICTIONARY_DIR;
  const RULES_PATH = options.rulesPath ?? DEFAULT_RULES_PATH;

  const problems = [];
  const warnings = [];

  const fail = (where, message) => problems.push(`${where}: ${message}`);
  const warn = (where, message) => warnings.push(`${where}: ${message}`);

  const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

  const rules = readJson(RULES_PATH);
  const expectedCategories = Object.keys(rules.classification.categories);
  const expectedModifiers = rules.classification.modifierCategories;
  const expectedTones = ['poetic', 'minimalist', 'humorous'];

  const dictionaryFiles = readdirSync(DICT_DIR)
    .filter((f) => /^narratives\.[a-z]{2}(?:-[A-Za-z0-9]+)?\.json$/.test(f))
    .sort();

  if (dictionaryFiles.length === 0) {
    return { problems: [`No dictionary files found in ${DICT_DIR}`], warnings, languages: [], files: [] };
  }

  const referenceFile = `narratives.${REFERENCE_LANGUAGE}.json`;
  if (!dictionaryFiles.includes(referenceFile)) {
    return {
      problems: [`Reference dictionary ${referenceFile} is missing; structural comparison is impossible.`],
      warnings,
      languages: [],
      files: dictionaryFiles,
    };
  }

  /** Collects the key structure of an object, ignoring $-prefixed metadata keys and array contents. */
  const keyShape = (value, path = '', out = new Set()) => {
    if (Array.isArray(value)) {
      out.add(`${path}[]`);
      return out;
    }
    if (value === null || typeof value !== 'object') {
      out.add(path);
      return out;
    }
    for (const key of Object.keys(value)) {
      if (key.startsWith('$')) continue;
      keyShape(value[key], path ? `${path}.${key}` : key, out);
    }
    return out;
  };

  /** Walks every template string in a dictionary, yielding [dottedPath, index, templateObject]. */
  const walkTemplates = (node, path, visit) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        const normalized = typeof item === 'string' ? { t: item } : item;
        visit(path, index, normalized, item);
      });
      return;
    }
    if (node === null || typeof node !== 'object') {
      if (typeof node === 'string') visit(path, null, { t: node }, node);
      return;
    }
    for (const key of Object.keys(node)) {
      if (key.startsWith('$')) continue;
      walkTemplates(node[key], path ? `${path}.${key}` : key, visit);
    }
  };

  const extractPlaceholders = (text) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]);

  const contractFor = (path) => SECTION_CONTRACT.find((c) => c.match.test(path));

  const shapes = new Map();

  for (const file of dictionaryFiles) {
    const where = file;
    let dict;
    try {
      dict = readJson(join(DICT_DIR, file));
    } catch (error) {
      fail(where, `is not valid JSON — ${error.message}`);
      continue;
    }

    const expectedCode = basename(file, '.json').split('.')[1];
    if (dict.language !== expectedCode) {
      fail(where, `declares language "${dict.language}" but its filename says "${expectedCode}"`);
    }
    if (!/^\d+\.\d+\.\d+$/.test(dict.version ?? '')) {
      fail(where, 'is missing a semver "version" field');
    }

    /* --- categories, tones, variant lists --- */
    for (const category of expectedCategories) {
      const node = dict.categories?.[category];
      if (!node) {
        fail(where, `has no entry for category "${category}" declared in spec/rules.json`);
        continue;
      }
      if (!node.label) fail(where, `category "${category}" has no label`);
      for (const group of ['entries', 'chapterTitles', 'chapterNarratives']) {
        for (const tone of expectedTones) {
          const variants = node[group]?.[tone];
          if (!Array.isArray(variants) || variants.length === 0) {
            fail(where, `category "${category}" → ${group} → ${tone} is missing or empty`);
          }
        }
      }
    }

    for (const modifier of expectedModifiers) {
      for (const tone of expectedTones) {
        const variants = dict.modifiers?.[modifier]?.[tone];
        if (!Array.isArray(variants) || variants.length === 0) {
          fail(where, `modifier "${modifier}" → ${tone} is missing or empty`);
        }
      }
    }

    for (const chronotype of rules.pulse.chronotypes
      .map((c) => c.id)
      .concat(rules.pulse.fallbackChronotype)) {
      const node = dict.pulse?.chronotypes?.[chronotype];
      if (!node) {
        fail(where, `has no pulse text for chronotype "${chronotype}"`);
        continue;
      }
      if (!node.label) fail(where, `chronotype "${chronotype}" has no label`);
      for (const tone of expectedTones) {
        if (!Array.isArray(node.narratives?.[tone]) || node.narratives[tone].length === 0) {
          fail(where, `chronotype "${chronotype}" → ${tone} is missing or empty`);
        }
      }
    }

    /* --- templates: placeholders, requires, duplicates --- */
    const seenPerList = new Map();

    walkTemplates(dict, '', (path, index, template, original) => {
      const at = index === null ? path : `${path}[${index}]`;
      const contract = contractFor(path);
      if (!contract) return; // sections outside the template contract (locale arrays, labels, icons)

      if (typeof template.t !== 'string' || template.t.trim() === '') {
        fail(where, `${at} is blank or has no "t" field`);
        return;
      }
      if (typeof original === 'object' && original !== null) {
        const unknownKeys = Object.keys(original).filter((k) => k !== 't' && k !== 'requires');
        if (unknownKeys.length > 0) {
          fail(where, `${at} has unsupported key(s): ${unknownKeys.join(', ')}`);
        }
        if (original.requires !== undefined && !Array.isArray(original.requires)) {
          fail(where, `${at} has a "requires" field that is not an array`);
        }
      }

      const used = extractPlaceholders(template.t);
      for (const placeholder of used) {
        if (!contract.allowed.has(placeholder)) {
          fail(
            where,
            `${at} (${contract.label}) interpolates {${placeholder}}, which the engine does not provide here. ` +
              `Allowed: ${[...contract.allowed].sort().join(', ') || '(none)'}`,
          );
        }
      }

      for (const required of template.requires ?? []) {
        if (!contract.allowed.has(required)) {
          fail(where, `${at} requires {${required}}, which is not a placeholder of this section`);
        } else if (!used.includes(required)) {
          fail(
            where,
            `${at} requires {${required}} but never interpolates it, so the filter can only ever hide it`,
          );
        }
      }

      // Only the narrative sections interpolate the formatted, unit-bearing values. In `ui` and
      // `pulse` the same names carry raw counts, so applying this check there would be a false alarm.
      for (const [placeholder, unitKey] of contract.unitBearing === true
        ? Object.entries(UNIT_BEARING_PLACEHOLDERS)
        : []) {
        const forms = dict.units?.[unitKey];
        if (forms === undefined) continue;

        const stems = [...new Set([forms.one, forms.other])].filter(
          (word) => typeof word === 'string' && word.length > 2,
        );

        for (const stem of stems) {
          const duplicated = new RegExp(
            `\\{${placeholder}\\}\\s*${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
            'iu',
          );
          if (duplicated.test(template.t)) {
            fail(
              where,
              `${at} writes "{${placeholder}} ${stem}…", but {${placeholder}} already expands to ` +
                `"4 ${forms.other}". Use {${placeholder === 'files' ? 'filesCount' : placeholder === 'commits' ? 'commitsCount' : 'insertions/deletions'}} ` +
                'when the sentence needs to inflect the unit itself.',
            );
          }
        }
      }

      if (SUBJECT_REQUIRED.test(path) && !used.includes('subject')) {
        fail(
          where,
          `${at} never mentions {subject}; an entry sentence must say what the commit actually did`,
        );
      }

      const listKey = `${where}::${path}`;
      const seen = seenPerList.get(listKey) ?? new Set();
      const normalizedText = template.t.replace(/\s+/g, ' ').trim();
      if (seen.has(normalizedText)) {
        fail(
          where,
          `${at} duplicates an earlier variant in the same list, which skews the deterministic choice`,
        );
      }
      seen.add(normalizedText);
      seenPerList.set(listKey, seen);
    });

    shapes.set(file, keyShape(dict));
  }

  /* --- structural mirror against the reference dictionary --- */
  const referenceShape = shapes.get(referenceFile);
  if (referenceShape) {
    for (const [file, shape] of shapes) {
      if (file === referenceFile) continue;
      const missing = [...referenceShape].filter((k) => !shape.has(k));
      const extra = [...shape].filter((k) => !referenceShape.has(k));
      for (const key of missing) fail(file, `is missing "${key}", which ${referenceFile} declares`);
      for (const key of extra) fail(file, `declares "${key}", which ${referenceFile} does not`);
    }
  }

  /* --- variant-count parity: a warning, not an error, so new languages can land incrementally --- */
  const referenceDict = readJson(join(DICT_DIR, referenceFile));
  const countVariants = (dict) => {
    const counts = new Map();
    walkTemplates(dict, '', (path, index) => {
      if (index === null) return;
      counts.set(path, (counts.get(path) ?? 0) + 1);
    });
    return counts;
  };
  const referenceCounts = countVariants(referenceDict);
  for (const file of dictionaryFiles) {
    if (file === referenceFile) continue;
    const counts = countVariants(readJson(join(DICT_DIR, file)));
    for (const [path, expected] of referenceCounts) {
      const actual = counts.get(path) ?? 0;
      if (actual !== expected) {
        warn(
          file,
          `${path} has ${actual} variant(s) where ${referenceFile} has ${expected} — translation looks incomplete`,
        );
      }
    }
  }

  /* ------------------------------------------------------------------ */

  const languages = dictionaryFiles.map((f) => basename(f, '.json').split('.')[1]);
  return { problems, warnings, languages, files: dictionaryFiles };
}

/* ------------------------------------------------------------------ *
 * CLI shell. Kept deliberately thin: everything worth testing lives in
 * validateDictionaries(), which never touches process state.
 * ------------------------------------------------------------------ */
function main() {
  const { problems, warnings, languages, files } = validateDictionaries();

  for (const message of warnings) console.warn(`  warn  ${message}`);

  if (problems.length > 0) {
    console.error(
      `\n✖ Dictionary contract violated (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n`,
    );
    for (const message of problems) console.error(`  ✖  ${message}`);
    console.error('');
    process.exitCode = 1;
    return;
  }

  console.log(
    `✔ ${files.length} dictionary file(s) satisfy the contract [${languages.join(', ')}]` +
      (warnings.length > 0 ? ` — ${warnings.length} warning(s)` : ''),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
