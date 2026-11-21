import type { Dictionary } from '../spec/dictionary.js';
import { variantsFor } from '../spec/dictionary.js';
import type { EgehanRules } from '../spec/rules.js';
import { dayKeyDistance } from './datetime.js';
import type { NarrationContext } from './narrator.js';
import type { PreparedCommit } from './prepare.js';
import { selectAndFill } from './templating.js';
import type { Chronotype, MonthlyActivity, Pulse, Streak } from './types.js';

/**
 * The Developer Pulse: the shape of how somebody actually worked.
 *
 * Two deliberate properties:
 *
 * - **Nothing here reads the wall clock.** `currentStreak` is the run of days ending at the last
 *   commit in range, not at today — otherwise the report would change every morning while the
 *   repository stood still, and the generated files could never live in git.
 * - **Everything is rounded before it enters the report**, to the precision fixed in
 *   `rules.json → pulse.rounding`, so the .NET engine cannot drift at the last decimal.
 */

export function computePulse(
  commits: readonly PreparedCommit[],
  rules: EgehanRules,
  context: NarrationContext,
): Pulse {
  const hourHistogram = new Array<number>(24).fill(0);
  const weekdayHistogram = new Array<number>(7).fill(0);
  const monthly = new Map<string, { commits: number; insertions: number; deletions: number }>();
  const dayKeys = new Set<string>();

  let insertions = 0;
  let deletions = 0;
  const changedLines: number[] = [];

  for (const commit of commits) {
    hourHistogram[commit.authoredAt.hour] = (hourHistogram[commit.authoredAt.hour] ?? 0) + 1;
    weekdayHistogram[commit.authoredAt.weekday] = (weekdayHistogram[commit.authoredAt.weekday] ?? 0) + 1;
    dayKeys.add(commit.authoredAt.dayKey);

    insertions += commit.insertions;
    deletions += commit.deletions;
    changedLines.push(commit.changedLines);

    const month = monthly.get(commit.authoredAt.monthKey) ?? { commits: 0, insertions: 0, deletions: 0 };
    month.commits += 1;
    month.insertions += commit.insertions;
    month.deletions += commit.deletions;
    monthly.set(commit.authoredAt.monthKey, month);
  }

  const total = commits.length;
  const chronotype = detectChronotype(hourHistogram, total, rules);
  const streaks = computeStreaks([...dayKeys], rules);

  const creationRatio = round(
    insertions / Math.max(1, insertions + deletions),
    rules.pulse.rounding.ratioDecimals,
  );
  const pulse: Omit<Pulse, 'narrative'> = {
    chronotype,
    chronotypeLabel: chronotypeLabel(chronotype, context.dictionary),
    hourHistogram,
    weekdayHistogram,
    busiestHour: smoothedPeakIndex(hourHistogram, rules.pulse.peakSmoothingWindow),
    busiestWeekday: peakIndex(weekdayHistogram),
    creationRatio,
    avgChangedLines: round(
      changedLines.reduce((sum, value) => sum + value, 0) / Math.max(1, total),
      rules.pulse.rounding.averageDecimals,
    ),
    medianChangedLines: round(median(changedLines), rules.pulse.rounding.averageDecimals),
    longestStreak: streaks.longest,
    currentStreak: streaks.current,
    monthlyActivity: toMonthlyActivity(monthly),
  };

  return { ...pulse, narrative: narratePulse(pulse, commits, context) };
}

/**
 * Picks the chronotype whose hours carry the largest share of commits, provided that share clears
 * the rule's `minShare`. Ties fall to declaration order, so the result never depends on how a map
 * happened to be iterated.
 */
function detectChronotype(hourHistogram: readonly number[], total: number, rules: EgehanRules): Chronotype {
  if (total === 0) return rules.pulse.fallbackChronotype as Chronotype;

  let best: { id: string; share: number } | null = null;

  for (const candidate of rules.pulse.chronotypes) {
    const share = candidate.hours.reduce((sum, hour) => sum + (hourHistogram[hour] ?? 0), 0) / total;
    if (share < candidate.minShare) continue;
    if (best === null || share > best.share) best = { id: candidate.id, share };
  }

  return (best?.id ?? rules.pulse.fallbackChronotype) as Chronotype;
}

interface Streaks {
  readonly longest: Streak;
  readonly current: Streak;
}

/**
 * Longest and current runs of consecutive calendar days with at least one commit.
 *
 * Days are compared as day keys in the commit's own timezone, so a developer who commits at 23:50
 * and again at 00:10 gets two days — which is what their calendar says, and what they would count
 * themselves.
 */
function computeStreaks(dayKeys: readonly string[], rules: EgehanRules): Streaks {
  const sorted = [...dayKeys].sort();
  const empty: Streak = { days: 0, from: null, to: null };
  if (sorted.length === 0) return { longest: empty, current: empty };

  const minimum = rules.pulse.streak.minLengthToReport;
  const runs: Streak[] = [];

  let start = sorted[0] as string;
  let previous = start;
  let length = 1;

  for (const day of sorted.slice(1)) {
    if (dayKeyDistance(previous, day) === 1) {
      length += 1;
    } else {
      runs.push({ days: length, from: start, to: previous });
      start = day;
      length = 1;
    }
    previous = day;
  }
  runs.push({ days: length, from: start, to: previous });

  const longest = runs.reduce((best, run) => (run.days > best.days ? run : best), runs[0] as Streak);
  // The *current* streak is the last run in the history, not a run relative to today.
  const current = runs[runs.length - 1] as Streak;

  return {
    longest: longest.days >= minimum ? longest : empty,
    current: current.days >= minimum ? current : empty,
  };
}

function narratePulse(
  pulse: Omit<Pulse, 'narrative'>,
  commits: readonly PreparedCommit[],
  context: NarrationContext,
): string {
  const { dictionary, rules, tone } = context;
  const chronotype = dictionary.pulse.chronotypes[pulse.chronotype];
  if (chronotype === undefined) {
    throw new Error(`The dictionary has no pulse text for chronotype "${pulse.chronotype}"`);
  }

  const where = `chronotype "${pulse.chronotype}" (${tone})`;
  // Seeded from the first commit's sha so the summary is stable for a given history, and differs
  // between projects that happen to share a chronotype.
  const seed = commits[0]?.source.sha ?? '0'.repeat(40);

  const headline = selectAndFill(
    variantsFor(chronotype.narratives, tone, where),
    seed,
    {
      busiestHour: String(pulse.busiestHour).padStart(2, '0'),
      busiestWeekday: dictionary.locale.weekdays[pulse.busiestWeekday] ?? '',
      commits: String(commits.length),
    },
    rules,
    where,
  ).text;

  const percent = Math.round(pulse.creationRatio * 100);
  const creation =
    percent >= 65
      ? dictionary.pulse.creation.building
      : percent <= 40
        ? dictionary.pulse.creation.refining
        : dictionary.pulse.creation.balanced;

  const streak =
    pulse.longestStreak.days > 0
      ? dictionary.pulse.streak.longest
          .replace('{streakDays}', String(pulse.longestStreak.days))
          .replace('{from}', pulse.longestStreak.from ?? '')
          .replace('{to}', pulse.longestStreak.to ?? '')
      : dictionary.pulse.streak.none;

  return [headline, creation.replace('{creationPercent}', String(percent)), streak].join(' ');
}

function chronotypeLabel(chronotype: Chronotype, dictionary: Dictionary): string {
  const label = dictionary.pulse.chronotypes[chronotype]?.label;
  if (label === undefined) {
    throw new Error(`The dictionary has no label for chronotype "${chronotype}"`);
  }
  return label;
}

/**
 * The peak of a circularly smoothed histogram.
 *
 * A raw peak is noise on a small history: fourteen commits at fourteen different hours all tie at
 * one, the lowest index wins, and the report announces "busiest hour 02" for a project that only
 * ever commits in daylight. Summing each hour with its neighbours answers the question people
 * actually mean — which part of the day this project was written in. The window is circular, so
 * 23:00 and 01:00 count as neighbours, which is exactly when it matters.
 */
function smoothedPeakIndex(histogram: readonly number[], window: number): number {
  if (window <= 0) return peakIndex(histogram);

  const smoothed = histogram.map((_, hour) => {
    let total = 0;
    for (let offset = -window; offset <= window; offset += 1) {
      const neighbour = (hour + offset + histogram.length) % histogram.length;
      total += histogram[neighbour] ?? 0;
    }
    return total;
  });

  // Ties fall to the hour with the larger raw count, then to the earlier hour, so the answer is
  // both meaningful and totally ordered.
  let peak = 0;
  for (let hour = 1; hour < smoothed.length; hour += 1) {
    const better =
      (smoothed[hour] ?? 0) > (smoothed[peak] ?? 0) ||
      ((smoothed[hour] ?? 0) === (smoothed[peak] ?? 0) && (histogram[hour] ?? 0) > (histogram[peak] ?? 0));
    if (better) peak = hour;
  }
  return peak;
}

/** First index holding the maximum, so ties resolve to the earliest hour or weekday. */
function peakIndex(histogram: readonly number[]): number {
  let peak = 0;
  for (let index = 1; index < histogram.length; index += 1) {
    if ((histogram[index] ?? 0) > (histogram[peak] ?? 0)) peak = index;
  }
  return peak;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toMonthlyActivity(
  monthly: ReadonlyMap<string, { commits: number; insertions: number; deletions: number }>,
): MonthlyActivity[] {
  return [...monthly.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([month, stats]) => ({ month, ...stats }));
}
