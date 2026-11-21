import type { Dictionary } from '../spec/dictionary.js';
import type { EgehanRules } from '../spec/rules.js';
import { inclusiveDaySpan } from './datetime.js';
import { formatUnit, type NarrationContext } from './narrator.js';
import type { PreparedCommit } from './prepare.js';
import type { Milestone, MilestoneKind, Pulse } from './types.js';

/**
 * The moments worth remembering.
 *
 * Restraint matters more than completeness here. A milestone strip that lists two hundred entries
 * is not a milestone strip, so the thresholds live in `rules.json` and the one potentially
 * repetitive event — a fix in the small hours — is recorded only the first time it happens.
 */

const KIND_ORDER: readonly MilestoneKind[] = [
  'first-commit',
  'release-tag',
  'architectural-leap',
  'commit-count',
  'anniversary',
  'streak',
  'midnight-fix',
];

export function computeMilestones(
  commits: readonly PreparedCommit[],
  pulse: Pulse,
  rules: EgehanRules,
  context: NarrationContext,
): Milestone[] {
  const first = commits[0];
  if (first === undefined) return [];

  const spec = rules.milestoneCelebrations;
  const milestones: Milestone[] = [];
  const { dictionary } = context;

  const push = (
    kind: MilestoneKind,
    at: string,
    value: number | string | null,
    sha: string | null,
    label: string,
  ): void => {
    milestones.push({ kind, at, label, value, sha, narrative: narrate(kind, value, dictionary) });
  };

  push('first-commit', first.source.authoredAt, null, first.source.sha, categoryLabel(dictionary, 'birth'));

  for (const threshold of spec.commitCounts) {
    if (threshold === 1 || threshold > commits.length) continue;
    const commit = commits[threshold - 1];
    if (commit === undefined) continue;
    push(
      'commit-count',
      commit.source.authoredAt,
      threshold,
      commit.source.sha,
      formatUnit(threshold, dictionary.units.commit, dictionary),
    );
  }

  if (spec.onReleaseTag) {
    for (const commit of commits) {
      for (const tag of commit.releaseTags) {
        push('release-tag', commit.source.authoredAt, tag, commit.source.sha, tag);
      }
    }
  }

  const leapThreshold = rules.classification.categories['milestone']?.largeInsertionThreshold;
  if (leapThreshold !== undefined) {
    for (const commit of commits) {
      if (commit.insertions >= leapThreshold) {
        push(
          'architectural-leap',
          commit.source.authoredAt,
          commit.insertions,
          commit.source.sha,
          formatUnit(commit.insertions, dictionary.units.line, dictionary),
        );
      }
    }
  }

  for (const day of spec.anniversaryDays) {
    // The commit that first carried the project past that many days of life. A project younger
    // than the threshold simply has not reached it, and nothing is emitted.
    const reached = commits.find((commit) => inclusiveDaySpan(first.authoredAt, commit.authoredAt) >= day);
    if (reached === undefined) continue;
    push(
      'anniversary',
      reached.source.authoredAt,
      day,
      reached.source.sha,
      formatUnit(day, dictionary.units.day, dictionary),
    );
  }

  for (const days of spec.onStreakDays) {
    if (pulse.longestStreak.days < days || pulse.longestStreak.to === null) continue;
    const endOfStreak = commits.find((commit) => commit.authoredAt.dayKey === pulse.longestStreak.to);
    if (endOfStreak === undefined) continue;
    push(
      'streak',
      endOfStreak.source.authoredAt,
      days,
      endOfStreak.source.sha,
      formatUnit(days, dictionary.units.day, dictionary),
    );
  }

  if (spec.onMidnightFix) {
    const midnight = rules.classification.categories['midnight-oil'];
    const from = midnight?.localHourFrom;
    const to = midnight?.localHourTo;

    if (from !== undefined && to !== undefined) {
      const fixes = commits.filter(
        (commit) =>
          commit.conventional.type === 'fix' &&
          commit.authoredAt.hour >= from &&
          commit.authoredAt.hour <= to,
      );
      const recorded = spec.midnightFixMilestone === 'first-only' ? fixes.slice(0, 1) : fixes;

      for (const commit of recorded) {
        push(
          'midnight-fix',
          commit.source.authoredAt,
          null,
          commit.source.sha,
          categoryLabel(dictionary, 'midnight-oil'),
        );
      }
    }
  }

  // Chronological, with a declared tie-break so two engines cannot order the same instant
  // differently.
  return milestones.sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      String(a.value).localeCompare(String(b.value), 'en'),
  );
}

function narrate(kind: MilestoneKind, value: number | string | null, dictionary: Dictionary): string {
  const template = dictionary.milestones[kind];
  if (template === undefined) {
    throw new Error(`The dictionary has no milestone text for "${kind}"`);
  }
  return template.replace('{value}', value === null ? '' : String(value));
}

function categoryLabel(dictionary: Dictionary, category: 'birth' | 'midnight-oil'): string {
  const label = dictionary.categories[category]?.label;
  if (label === undefined) {
    throw new Error(`The dictionary has no label for category "${category}"`);
  }
  return label;
}
