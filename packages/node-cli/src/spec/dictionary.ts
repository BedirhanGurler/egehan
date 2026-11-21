import { readdirSync } from 'node:fs';
import { assetPath, readAssetJson } from './assets.js';
import type { Category, Chronotype, Language, MilestoneKind, ProjectFlavor, Tone } from '../engine/types.js';

/**
 * The typed view of `core-spec/dictionary/narratives.<language>.json`.
 *
 * A template is either a plain string or `{ t, requires }`. The object form exists so that a
 * sentence can declare the data it needs — a milestone template mentioning `{tag}` is useless for
 * an untagged commit — and the engine filters on that before making its deterministic choice.
 * Keeping the common case a plain string keeps the dictionaries readable for translators, who are
 * the people most likely to contribute and least likely to want to read a schema first.
 */

export type RawTemplate = string | { readonly t: string; readonly requires?: readonly string[] };

export interface Template {
  readonly text: string;
  readonly requires: readonly string[];
}

export type ToneVariants = Readonly<Record<Tone, readonly RawTemplate[]>>;

export interface FlavorVocabulary {
  readonly subject: string;
  readonly artifact: string;
  readonly layer: string;
  readonly domain: string;
}

export interface CategoryNarratives {
  readonly label: string;
  readonly icon: string;
  readonly chapterTitles: ToneVariants;
  readonly chapterNarratives: ToneVariants;
  readonly entries: ToneVariants;
}

export interface ChronotypeNarratives {
  readonly label: string;
  readonly icon: string;
  readonly narratives: ToneVariants;
}

export interface Dictionary {
  readonly language: Language;
  readonly version: string;
  readonly locale: {
    readonly months: readonly string[];
    readonly weekdays: readonly string[];
    readonly weekdaysShort: readonly string[];
    readonly dateFormat: string;
    readonly dateShortFormat: string;
    readonly timeFormat: string;
    readonly rangeFormat: string;
    readonly rangeSameDayFormat: string;
    readonly periodFormat: string;
    readonly periodSameDayFormat: string;
    readonly listSeparator: string;
    readonly listLastSeparator: string;
  };
  readonly units: {
    readonly file: PluralForms;
    readonly line: PluralForms;
    readonly commit: PluralForms;
    readonly day: PluralForms;
    readonly author: PluralForms;
    readonly format: string;
  };
  readonly flavors: Readonly<Record<ProjectFlavor, FlavorVocabulary>>;
  readonly categories: Readonly<Record<Category, CategoryNarratives>>;
  readonly modifiers: Readonly<Record<string, ToneVariants>>;
  readonly pulse: {
    readonly title: string;
    readonly chronotypes: Readonly<Record<Chronotype, ChronotypeNarratives>>;
    readonly creation: {
      readonly building: string;
      readonly refining: string;
      readonly balanced: string;
    };
    readonly streak: {
      readonly longest: string;
      readonly current: string;
      readonly none: string;
    };
    readonly labels: Readonly<Record<string, string>>;
  };
  readonly milestones: Readonly<Record<MilestoneKind, string>> & {
    readonly celebration: { readonly title: string; readonly action: string };
  };
  readonly ui: Readonly<Record<string, string>>;
}

export interface PluralForms {
  readonly one: string;
  readonly other: string;
}

const DICTIONARY_FILE = /^narratives\.([a-z]{2}(?:-[A-Za-z0-9]+)?)\.json$/;

const cache = new Map<string, Dictionary>();

/** Every language the installed spec assets provide, sorted. */
export function availableLanguages(): string[] {
  return readdirSync(assetPath('dictionary'))
    .map((file) => DICTIONARY_FILE.exec(file)?.[1])
    .filter((code): code is string => code !== undefined)
    .sort();
}

export function loadDictionary(language: string): Dictionary {
  const cached = cache.get(language);
  if (cached !== undefined) return cached;

  const available = availableLanguages();
  if (!available.includes(language)) {
    throw new Error(
      `No dictionary for language "${language}". Available: ${available.join(', ')}. ` +
        'Adding one means adding a JSON file — see CONTRIBUTING.md.',
    );
  }

  const dictionary = readAssetJson<Dictionary>('dictionary', `narratives.${language}.json`);
  cache.set(language, dictionary);
  return dictionary;
}

/** Collapses both template forms into one shape, so callers never branch on it. */
export function normalizeTemplates(raw: readonly RawTemplate[]): Template[] {
  return raw.map((entry) =>
    typeof entry === 'string'
      ? { text: entry, requires: [] }
      : { text: entry.t, requires: entry.requires ?? [] },
  );
}

/** Reads a tone's variants, failing loudly rather than narrating with an empty list. */
export function variantsFor(variants: ToneVariants, tone: Tone, where: string): Template[] {
  const raw = variants[tone];
  if (raw === undefined || raw.length === 0) {
    throw new Error(`The dictionary has no "${tone}" variants for ${where}`);
  }
  return normalizeTemplates(raw);
}
