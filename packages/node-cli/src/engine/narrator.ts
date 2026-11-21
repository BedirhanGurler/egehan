import type { Dictionary, FlavorVocabulary, PluralForms } from '../spec/dictionary.js';
import { variantsFor } from '../spec/dictionary.js';
import type { EgehanRules } from '../spec/rules.js';
import { formatClock, formatDate, inclusiveDaySpan, type LocalTimestamp } from './datetime.js';
import type { PreparedCommit } from './prepare.js';
import { selectAndFill, type PlaceholderValues } from './templating.js';
import type { Category, Language, ProjectFlavor, Tone } from './types.js';

/**
 * Turns facts into sentences.
 *
 * The narrator owns exactly one responsibility: assembling the placeholder values a template needs
 * and asking `templating` for the sentence. It contains no classification logic and no statistics
 * — if a number has to be computed, it was computed before this file ran. That separation is what
 * makes the narration portable: a port has to reproduce this value table, not this code.
 */

export interface NarrationContext {
  readonly dictionary: Dictionary;
  readonly rules: EgehanRules;
  readonly tone: Tone;
  readonly language: Language;
  readonly flavor: ProjectFlavor;
}

export interface NarratedEntry {
  readonly narrative: string;
  readonly variantIndex: number;
}

export function createNarrationContext(
  dictionary: Dictionary,
  rules: EgehanRules,
  tone: Tone,
  language: Language,
  flavor: ProjectFlavor,
): NarrationContext {
  return { dictionary, rules, tone, language, flavor };
}

/* ------------------------------------------------------------------ *
 * Entries
 * ------------------------------------------------------------------ */

export function narrateEntry(
  commit: PreparedCommit,
  category: Category,
  secondaryCategories: readonly Category[],
  authorName: string,
  context: NarrationContext,
): NarratedEntry {
  const { dictionary, rules, tone } = context;
  const categoryNarratives = dictionary.categories[category];
  if (categoryNarratives === undefined) {
    throw new Error(`The dictionary has no narratives for category "${category}"`);
  }

  const values = entryPlaceholders(commit, authorName, context);
  const where = `category "${category}" entry (${tone})`;
  const templates = variantsFor(categoryNarratives.entries, tone, where);

  const selection = selectAndFill(templates, commit.source.sha, values, rules, where);
  const modifier = modifierClause(commit, secondaryCategories, values, context);

  const sentence = modifier === null ? selection.text : `${selection.text} ${modifier}`;

  return { narrative: capitalizeSentence(sentence, context), variantIndex: selection.index };
}

/**
 * One extra clause for a secondary category.
 *
 * Capped by `rules.json → classification.maxModifiersPerEntry`, which is 1. A sentence carrying
 * three appended clauses reads like generated text, and the whole point of the dictionary is that
 * it does not.
 */
function modifierClause(
  commit: PreparedCommit,
  secondaryCategories: readonly Category[],
  values: PlaceholderValues,
  context: NarrationContext,
): string | null {
  const { dictionary, rules, tone } = context;
  const limit = rules.classification.maxModifiersPerEntry;
  if (limit < 1 || secondaryCategories.length === 0) return null;

  const category = secondaryCategories[0];
  if (category === undefined) return null;

  const variants = dictionary.modifiers[category];
  if (variants === undefined) return null;

  const where = `modifier "${category}" (${tone})`;
  const selection = selectAndFill(
    variantsFor(variants, tone, where),
    // A different hash source from the main sentence, so a commit does not always pair variant 2
    // with variant 2 — otherwise the two lists would effectively act as one shorter list.
    reverseSha(commit.source.sha),
    values,
    rules,
    where,
  );

  return selection.text;
}

function reverseSha(sha: string): string {
  return [...sha].reverse().join('');
}

export function entryPlaceholders(
  commit: PreparedCommit,
  authorName: string,
  context: NarrationContext,
): PlaceholderValues {
  const { dictionary } = context;
  const flavor = flavorVocabulary(context);
  const at = commit.authoredAt;

  return {
    author: authorName,
    date: formatDate(at, dictionary.locale.dateFormat, dictionary.locale.months),
    dateShort: formatDate(at, dictionary.locale.dateShortFormat, dictionary.locale.months),
    time: formatClock(at, dictionary.locale.timeFormat),
    weekday: weekdayName(at, dictionary),
    month: monthName(at, dictionary),
    year: String(at.year),
    files: formatUnit(commit.filesCount, dictionary.units.file, dictionary),
    filesCount: String(commit.filesCount),
    additions: formatUnit(commit.insertions, dictionary.units.line, dictionary),
    removals: formatUnit(commit.deletions, dictionary.units.line, dictionary),
    insertions: String(commit.insertions),
    deletions: String(commit.deletions),
    changedLines: String(commit.changedLines),
    subject: commit.cleanSubject,
    scope: commit.conventional.scope ?? '',
    tag: commit.releaseTags[0] ?? commit.tags[0] ?? '',
    flavorSubject: flavor.subject,
    flavorArtifact: flavor.artifact,
    flavorLayer: flavor.layer,
    flavorDomain: flavor.domain,
  };
}

/* ------------------------------------------------------------------ *
 * Chapters
 * ------------------------------------------------------------------ */

export interface ChapterFacts {
  readonly category: Category;
  readonly commits: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly filesCount: number;
  readonly authorsCount: number;
  readonly from: LocalTimestamp;
  readonly to: LocalTimestamp;
  /** The sha the deterministic choice is seeded from: the chapter's first commit. */
  readonly seedSha: string;
}

export interface NarratedChapter {
  readonly title: string;
  readonly narrative: string;
}

export function narrateChapter(facts: ChapterFacts, context: NarrationContext): NarratedChapter {
  const { dictionary, rules, tone } = context;
  const narratives = dictionary.categories[facts.category];
  if (narratives === undefined) {
    throw new Error(`The dictionary has no narratives for category "${facts.category}"`);
  }

  const values = chapterPlaceholders(facts, context);
  const titleWhere = `category "${facts.category}" chapter title (${tone})`;
  const bodyWhere = `category "${facts.category}" chapter narrative (${tone})`;

  const title = selectAndFill(
    variantsFor(narratives.chapterTitles, tone, titleWhere),
    facts.seedSha,
    values,
    rules,
    titleWhere,
  );
  const body = selectAndFill(
    variantsFor(narratives.chapterNarratives, tone, bodyWhere),
    reverseSha(facts.seedSha),
    values,
    rules,
    bodyWhere,
  );

  return { title: title.text, narrative: capitalizeSentence(body.text, context) };
}

function chapterPlaceholders(facts: ChapterFacts, context: NarrationContext): PlaceholderValues {
  const { dictionary } = context;
  const flavor = flavorVocabulary(context);

  return {
    commits: formatUnit(facts.commits, dictionary.units.commit, dictionary),
    commitsCount: String(facts.commits),
    span: formatUnit(inclusiveDaySpan(facts.from, facts.to), dictionary.units.day, dictionary),
    from: formatDate(facts.from, dictionary.locale.dateShortFormat, dictionary.locale.months),
    to: formatDate(facts.to, dictionary.locale.dateShortFormat, dictionary.locale.months),
    range: formatRange(facts.from, facts.to, dictionary, 'range'),
    period: formatRange(facts.from, facts.to, dictionary, 'period'),
    authorsCount: String(facts.authorsCount),
    files: formatUnit(facts.filesCount, dictionary.units.file, dictionary),
    filesCount: String(facts.filesCount),
    additions: formatUnit(facts.insertions, dictionary.units.line, dictionary),
    removals: formatUnit(facts.deletions, dictionary.units.line, dictionary),
    insertions: String(facts.insertions),
    deletions: String(facts.deletions),
    changedLines: String(facts.insertions + facts.deletions),
    flavorSubject: flavor.subject,
    flavorArtifact: flavor.artifact,
    flavorLayer: flavor.layer,
    flavorDomain: flavor.domain,
  };
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

/**
 * A chapter's time span, in one of two shapes the dictionary provides.
 *
 * `range` is the bare span — "2 Nisan – 20 Nisan", or just "2 Nisan" when the chapter covers one
 * day — for label positions like `{range}: 3 commits`. `period` is the same span as a natural
 * temporal phrase — "2 Nisan – 20 Nisan arasında", "on 30 May" — for prose positions.
 *
 * The split exists because one shape cannot serve both: a single-day chapter rendered with the
 * prose connective baked into the template read "30 Mayıs arasında", which is simply ungrammatical,
 * and English needs the preposition to change with the shape ("between … and …" vs "on …"). Both
 * forms live in the dictionary, where a language can choose its own dash, order and preposition.
 */
export function formatRange(
  from: LocalTimestamp,
  to: LocalTimestamp,
  dictionary: Dictionary,
  shape: 'range' | 'period',
): string {
  const sameDay = from.dayKey === to.dayKey;
  const template =
    shape === 'range'
      ? sameDay
        ? dictionary.locale.rangeSameDayFormat
        : dictionary.locale.rangeFormat
      : sameDay
        ? dictionary.locale.periodSameDayFormat
        : dictionary.locale.periodFormat;

  return template
    .replace('{from}', formatDate(from, dictionary.locale.dateShortFormat, dictionary.locale.months))
    .replace('{to}', formatDate(to, dictionary.locale.dateShortFormat, dictionary.locale.months));
}

/**
 * Upper-cases the first letter of a generated sentence.
 *
 * Only when that first character *is* a letter: a template may open with a date ("6 Ocak 2025
 * günü…") or with the quoted subject («…» eklendi), and touching the latter would rewrite a
 * citation — which is how «initial commit» once became «İnitial commit». Casing uses the report's
 * language tag, so Turkish gets its dotted İ where the text really is Turkish.
 */
export function capitalizeSentence(text: string, context: NarrationContext): string {
  const spec = context.rules.narrative;
  if (!spec.capitalizeFirstLetter || text.length === 0) return text;

  const first = text.charAt(0);
  if (spec.skipWhenFirstCharIsNotALetter && !/\p{L}/u.test(first)) return text;

  return first.toLocaleUpperCase(context.language) + text.slice(1);
}

export function flavorVocabulary(context: NarrationContext): FlavorVocabulary {
  const vocabulary = context.dictionary.flavors[context.flavor];
  if (vocabulary === undefined) {
    throw new Error(`The dictionary has no vocabulary for project flavor "${context.flavor}"`);
  }
  return vocabulary;
}

/** `4 dosya` / `4 files` — pluralization is the dictionary's business, not the engine's. */
export function formatUnit(count: number, forms: PluralForms, dictionary: Dictionary): string {
  const unit = count === 1 ? forms.one : forms.other;
  return dictionary.units.format.replace('{n}', String(count)).replace('{unit}', unit);
}

function weekdayName(at: LocalTimestamp, dictionary: Dictionary): string {
  const name = dictionary.locale.weekdays[at.weekday];
  if (name === undefined) {
    throw new Error(`The dictionary provides no name for weekday index ${at.weekday}`);
  }
  return name;
}

function monthName(at: LocalTimestamp, dictionary: Dictionary): string {
  const name = dictionary.locale.months[at.month - 1];
  if (name === undefined) {
    throw new Error(`The dictionary provides no name for month ${at.month}`);
  }
  return name;
}
