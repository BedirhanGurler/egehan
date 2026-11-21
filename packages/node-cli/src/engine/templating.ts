import type { EgehanRules } from '../spec/rules.js';
import type { Template } from '../spec/dictionary.js';

/**
 * Deterministic template selection and interpolation.
 *
 * The whole promise of the project rests on this file: the same commit must always produce the
 * same sentence, on every machine, in every runtime, for as long as the dictionary version stays
 * the same. So there is no randomness here, no wall clock, no iteration over an unordered map, and
 * no locale-sensitive comparison. The chosen index is a pure function of the commit sha.
 */

export type PlaceholderValues = Readonly<Record<string, string>>;

export interface Selection {
  readonly text: string;
  readonly index: number;
}

/** `parseInt(sha[0..8], 16) % length` — the formula documented in rules.json → determinism. */
export function hashIndex(sha: string, length: number, rules: EgehanRules): number {
  if (length <= 0) {
    throw new Error('Cannot select a template from an empty variant list');
  }

  const { hashPrefixLength, hashRadix } = rules.determinism;
  const prefix = sha.toLowerCase().slice(0, hashPrefixLength);
  const value = Number.parseInt(prefix, hashRadix);

  if (!Number.isFinite(value)) {
    throw new Error(`Commit sha "${sha}" does not start with ${hashPrefixLength} hex digits`);
  }

  return value % length;
}

/**
 * Picks the variant for a commit and fills it in.
 *
 * Templates declaring `requires` are dropped when the data they need is absent — a milestone
 * sentence mentioning `{tag}` is nonsense for an untagged commit. Filtering happens *before*
 * indexing, which keeps selection deterministic while letting the dictionary carry sentences that
 * only some commits can use.
 *
 * If every variant is filtered out the unfiltered list is used instead. A dictionary that cannot
 * narrate a commit is a dictionary bug, but refusing to narrate at all would turn that bug into a
 * missing chapter in somebody's keepsake, which is the worse failure.
 */
export function selectAndFill(
  templates: readonly Template[],
  sha: string,
  values: PlaceholderValues,
  rules: EgehanRules,
  where: string,
): Selection {
  if (templates.length === 0) {
    throw new Error(`The dictionary provides no variants for ${where}`);
  }

  const usable = templates.filter((template) =>
    template.requires.every((placeholder) => isPresent(values[placeholder])),
  );
  const pool = usable.length > 0 ? usable : templates;

  const index = hashIndex(sha, pool.length, rules);
  const chosen = pool[index];
  if (chosen === undefined) {
    throw new Error(`Variant selection produced an out-of-range index for ${where}`);
  }

  return { text: interpolate(chosen.text, values, where), index };
}

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/**
 * Replaces every `{placeholder}`, and throws on an unknown one.
 *
 * Throwing is deliberate. The alternative — leaving `{fliesCount}` in the output — ships a typo
 * into a file somebody intends to keep for years, and does it silently. The dictionary validator
 * in core-spec makes this unreachable for the bundled languages, so in practice this only fires
 * for a custom dictionary that was never validated.
 */
export function interpolate(template: string, values: PlaceholderValues, where: string): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(
        `The template for ${where} interpolates {${name}}, which the engine does not provide. ` +
          'Run `npm run spec:validate` against the dictionary.',
      );
    }
    return value;
  });
}

function isPresent(value: string | undefined): boolean {
  if (value === undefined) return false;
  const trimmed = value.trim();
  return trimmed !== '' && trimmed !== '0';
}
