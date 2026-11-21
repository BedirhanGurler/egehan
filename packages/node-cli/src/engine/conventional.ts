import type { EgehanRules } from '../spec/rules.js';
import type { CommitType, ConventionalInfo, Language, NormalizedCommit } from './types.js';

/**
 * Turns a commit subject into a type, a scope and a sentence fragment a human would want to read.
 *
 * Two design points worth stating, because both are easy to get wrong in a way nobody notices for
 * months:
 *
 * 1. **Repositories that never adopted Conventional Commits still deserve a story.** When no
 *    prefix is present the subject is matched against the keyword lists in `rules.json`, in the
 *    explicitly declared `keywordFallbackOrder` — never in map order, which is not portable across
 *    runtimes.
 * 2. **Lowercasing is invariant, never locale-aware.** `toLocaleLowerCase('tr')` maps `I` to `ı`,
 *    so a Turkish host would classify `FIX: …` differently from an English one. That would make
 *    the output depend on the machine, which is the one thing this engine must never do.
 */

const KNOWN_TYPES = new Set<CommitType>([
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
  'merge',
  'unknown',
]);

export interface ParsedSubject {
  readonly conventional: ConventionalInfo;
  readonly cleanSubject: string;
}

export function parseSubject(
  commit: NormalizedCommit,
  rules: EgehanRules,
  language: Language,
): ParsedSubject {
  const { conventionalCommits: spec } = rules;
  const subject = commit.subject.trim();
  const isMerge = commit.parents.length > 1 || new RegExp(spec.mergePattern).test(subject);

  const explicit = new RegExp(spec.pattern).exec(subject);
  const groups = explicit?.groups;

  if (groups !== undefined) {
    const declared = normalizeType(groups['type'], spec.typeAliases);
    return {
      conventional: {
        type: declared,
        scope: emptyToNull(groups['scope']),
        breaking: groups['breaking'] === '!' || mentionsBreakingChange(commit.body),
        inferred: false,
      },
      cleanSubject: cleanSubject(groups['subject'] ?? subject, rules, language),
    };
  }

  if (isMerge) {
    return {
      conventional: { type: 'merge', scope: null, breaking: false, inferred: true },
      cleanSubject: cleanSubject(subject, rules, language),
    };
  }

  if (new RegExp(spec.revertPattern).test(subject)) {
    return {
      conventional: { type: 'revert', scope: null, breaking: false, inferred: true },
      cleanSubject: cleanSubject(subject, rules, language),
    };
  }

  return {
    conventional: {
      type: inferTypeFromKeywords(subject, rules),
      scope: null,
      breaking: mentionsBreakingChange(commit.body),
      inferred: true,
    },
    cleanSubject: cleanSubject(subject, rules, language),
  };
}

function normalizeType(raw: string | undefined, aliases: Readonly<Record<string, string>>): CommitType {
  if (raw === undefined) return 'unknown';
  const lowered = raw.toLowerCase();
  const canonical = aliases[lowered] ?? lowered;
  return KNOWN_TYPES.has(canonical as CommitType) ? (canonical as CommitType) : 'unknown';
}

/**
 * Keyword fallback. Tokenizes on Unicode letters and digits so that Turkish characters survive —
 * `\w` would split "düzeltme" into fragments and match nothing.
 */
function inferTypeFromKeywords(subject: string, rules: EgehanRules): CommitType {
  const { keywordFallback, keywordFallbackOrder } = rules.conventionalCommits;

  const tokens = subject.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return 'unknown';

  const wordSet = new Set(tokens);
  const joined = tokens.join(' ');

  for (const group of keywordFallbackOrder) {
    const keywords = keywordFallback[group];
    if (keywords === undefined) continue;

    for (const keyword of keywords) {
      const matched = keyword.includes(' ') ? joined.includes(keyword) : wordSet.has(keyword);
      if (matched) {
        return KNOWN_TYPES.has(group as CommitType) ? (group as CommitType) : 'unknown';
      }
    }
  }

  return 'unknown';
}

function mentionsBreakingChange(body: string): boolean {
  return /^BREAKING[ -]CHANGE:/m.test(body);
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * `fix(auth): token refresh race condition [EGE-128].` → `Token refresh race condition`
 *
 * Every step is driven by `rules.json` so that the .NET port produces the same string from the
 * same input without anyone having to read this function.
 */
export function cleanSubject(raw: string, rules: EgehanRules, language: Language): string {
  const spec = rules.conventionalCommits.subjectCleanup;
  let text = raw;

  text = text.replace(new RegExp(spec.stripPrefixPattern), '');
  text = text.replace(new RegExp(spec.stripTicketPattern), '');

  if (spec.collapseWhitespace) {
    text = text.replace(/\s+/g, ' ').trim();
  }
  if (spec.stripTrailingPeriod) {
    text = text.replace(/\.+$/, '');
  }
  if (text.length > spec.maxLength) {
    text = text.slice(0, spec.maxLength - spec.ellipsis.length).trimEnd() + spec.ellipsis;
  }
  if (spec.capitalizeFirstLetter && text.length > 0) {
    // The one deliberately locale-aware step in this engine, and only ever with the report's own
    // language tag — never the host locale. Turkish requires it: an invariant upcase would write
    // "Iyileştirme" where the language wants "İyileştirme". Determinism survives because the
    // language is part of the report, so every engine upper-cases with the same tag.
    text = text.charAt(0).toLocaleUpperCase(language) + text.slice(1);
  }

  return text === '' ? raw.trim() : text;
}
