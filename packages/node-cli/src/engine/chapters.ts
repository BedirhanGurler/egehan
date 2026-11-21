import type { EgehanRules } from '../spec/rules.js';
import { hoursBetween } from './datetime.js';
import type { Classification } from './classifier.js';
import type { PreparedCommit } from './prepare.js';
import type { Category } from './types.js';

/**
 * Groups commits into chapters, so the chronicle reads as a story instead of a list.
 *
 * A chapter is a run of consecutive commits sharing a primary category. Two rules break a run
 * early, both from `rules.json → chapters`: a chapter never grows past `maxEntriesPerChapter`
 * (nobody reads a eighty-commit wall of text), and a gap longer than `maxGapHoursWithinChapter`
 * starts a new one — a project that was dormant for three months and then saw more evolution
 * commits lived through two separate periods, not one.
 */

export interface ChapterGroup {
  readonly category: Category;
  readonly commits: readonly PreparedCommit[];
}

export function groupIntoChapters(
  commits: readonly PreparedCommit[],
  classifications: ReadonlyMap<string, Classification>,
  rules: EgehanRules,
): ChapterGroup[] {
  const { maxEntriesPerChapter, maxGapHoursWithinChapter } = rules.chapters;
  const groups: ChapterGroup[] = [];

  let current: { category: Category; commits: PreparedCommit[] } | null = null;

  for (const commit of commits) {
    const category = classificationFor(classifications, commit).category;

    if (current !== null) {
      const previous = current.commits[current.commits.length - 1];
      const continuesChapter =
        current.category === category &&
        current.commits.length < maxEntriesPerChapter &&
        (previous === undefined ||
          hoursBetween(previous.authoredAt, commit.authoredAt) <= maxGapHoursWithinChapter);

      if (continuesChapter) {
        current.commits.push(commit);
        continue;
      }

      groups.push({ category: current.category, commits: current.commits });
    }

    current = { category, commits: [commit] };
  }

  if (current !== null) groups.push({ category: current.category, commits: current.commits });

  return groups;
}

export function classificationFor(
  classifications: ReadonlyMap<string, Classification>,
  commit: PreparedCommit,
): Classification {
  const classification = classifications.get(commit.source.sha);
  if (classification === undefined) {
    throw new Error(`Commit ${commit.source.sha} was never classified`);
  }
  return classification;
}
