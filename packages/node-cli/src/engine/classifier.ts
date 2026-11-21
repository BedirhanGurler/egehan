import type { EgehanRules } from '../spec/rules.js';
import { hoursBetween } from './datetime.js';
import type { PreparedCommit } from './prepare.js';
import type { Category } from './types.js';

/**
 * Places every commit in a chapter of the story.
 *
 * A commit is tested against all six categories. The first match in
 * `rules.json → classification.evaluationOrder` becomes its primary category; the rest become
 * secondary categories, and a secondary that is also a *modifier* category can contribute one
 * extra clause to the sentence. That is how a deletion-heavy 02:41 refactor comes out as growing
 * pains that also happened in the middle of the night, rather than having to choose one truth.
 *
 * Every threshold is read from the rules file. There is no number in this file that an engine in
 * another language could not see.
 */

export interface Classification {
  readonly category: Category;
  readonly secondaryCategories: readonly Category[];
}

export function classifyCommits(
  commits: readonly PreparedCommit[],
  rules: EgehanRules,
): Map<string, Classification> {
  const order = rules.classification.evaluationOrder as readonly Category[];
  const modifiers = new Set(rules.classification.modifierCategories);

  const context = buildContext(commits, rules);
  const result = new Map<string, Classification>();

  for (const commit of commits) {
    const matches = order.filter((category) => matchesCategory(category, commit, context, rules));

    const [primary, ...rest] = matches.length > 0 ? matches : (['evolution'] as Category[]);
    if (primary === undefined) {
      throw new Error(`No category could be assigned to commit ${commit.source.sha}`);
    }

    result.set(commit.source.sha, {
      category: primary,
      // Only modifier categories survive: a secondary nobody can express in a sentence is noise
      // in the report, and the HTML filters read the primary category anyway.
      secondaryCategories: rest.filter((category) => modifiers.has(category)),
    });
  }

  return result;
}

interface ClassificationContext {
  readonly first: PreparedCommit | undefined;
  /** Index of the first commit carrying a release tag; Infinity when the project never tagged. */
  readonly firstReleaseIndex: number;
  readonly clusteredFixShas: ReadonlySet<string>;
}

function buildContext(commits: readonly PreparedCommit[], rules: EgehanRules): ClassificationContext {
  const firstReleaseIndex = commits.findIndex((commit) => commit.releaseTags.length > 0);

  return {
    first: commits[0],
    firstReleaseIndex: firstReleaseIndex === -1 ? Number.POSITIVE_INFINITY : firstReleaseIndex,
    clusteredFixShas: findFixClusters(commits, rules),
  };
}

/**
 * Finds the fix commits that belong to a burst.
 *
 * "At least three fixes inside forty-eight hours" is implemented as a sliding window over the fix
 * commits only: any run of `minFixCommitsInCluster` consecutive fixes whose first and last fall
 * within `clusterWindowHours` marks every fix in that run. Expressing it this way keeps it
 * order-stable and trivially portable — no graph walking, no dates compared across timezones.
 */
function findFixClusters(commits: readonly PreparedCommit[], rules: EgehanRules): Set<string> {
  const spec = rules.classification.categories['growing-pains'];
  const window = spec?.clusterWindowHours;
  const minimum = spec?.minFixCommitsInCluster;
  const fixTypes = new Set(spec?.clusterFixTypes ?? []);

  const clustered = new Set<string>();
  if (window === undefined || minimum === undefined || minimum < 1) return clustered;

  const fixes = commits.filter((commit) => fixTypes.has(commit.conventional.type));

  for (let start = 0; start + minimum - 1 < fixes.length; start += 1) {
    const run = fixes.slice(start, start + minimum);
    const head = run[0];
    const tail = run[run.length - 1];
    if (head === undefined || tail === undefined) continue;

    if (hoursBetween(head.authoredAt, tail.authoredAt) <= window) {
      for (const commit of run) clustered.add(commit.source.sha);
    }
  }

  return clustered;
}

function matchesCategory(
  category: Category,
  commit: PreparedCommit,
  context: ClassificationContext,
  rules: EgehanRules,
): boolean {
  const spec = rules.classification.categories[category];
  if (spec === undefined) return false;

  switch (category) {
    case 'milestone': {
      if (commit.releaseTags.length > 0) return true;
      if (spec.breakingChangeMatches === true && commit.conventional.breaking) return true;
      const threshold = spec.largeInsertionThreshold;
      return threshold !== undefined && commit.insertions >= threshold;
    }

    case 'birth': {
      if (context.first === undefined) return false;
      if (spec.firstCommitAlwaysMatches === true && commit.index === 0) return true;

      const window = spec.setupWindowHours;
      const types = spec.setupWindowAppliesToTypes ?? [];
      if (window === undefined) return false;

      return (
        hoursBetween(context.first.authoredAt, commit.authoredAt) <= window &&
        types.includes(commit.conventional.type)
      );
    }

    case 'growing-pains': {
      if (context.clusteredFixShas.has(commit.source.sha)) return true;

      const ratio = spec.refactorDeletionRatio;
      const minimum = spec.refactorMinChangedLines;
      if (ratio === undefined || minimum === undefined) return false;

      return commit.deletions > commit.insertions * ratio && commit.changedLines >= minimum;
    }

    case 'midnight-oil': {
      const from = spec.localHourFrom;
      const to = spec.localHourTo;
      if (from === undefined || to === undefined) return false;
      return commit.authoredAt.hour >= from && commit.authoredAt.hour <= to;
    }

    case 'first-steps': {
      if (spec.requiresNoReleaseTagBefore === true && commit.index >= context.firstReleaseIndex) {
        return false;
      }
      return (spec.types ?? []).includes(commit.conventional.type);
    }

    case 'evolution': {
      return spec.isFallback === true || (spec.types ?? []).includes(commit.conventional.type);
    }

    default: {
      // Exhaustive by construction; reaching here means a category was added to the rules
      // without teaching the classifier what it means, which must fail loudly rather than
      // silently classify everything as evolution.
      const unreachable: never = category;
      throw new Error(`No classification logic for category "${String(unreachable)}"`);
    }
  }
}
