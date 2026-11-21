import type { EgehanReport, Milestone } from 'egehan';

/**
 * Deciding which milestones are worth interrupting somebody for.
 *
 * The rule that matters is the first-run one. A repository with four years of history has dozens
 * of milestones, and announcing all of them the moment the extension is installed would be the
 * single most annoying thing it could do. The first run records what already happened and says
 * nothing; from then on, only genuinely new milestones are announced.
 */

/**
 * Identity of a milestone, stable across regenerations *and* across rewritten history.
 *
 * Deliberately not the commit sha. A rebase, an amend or a squash gives every commit a new sha
 * while the project's story is unchanged — keyed on the sha, the extension would announce the
 * whole history again the first time somebody rebased a branch. Author dates survive a rebase, so
 * kind, value and date identify the moment rather than the object.
 */
export function milestoneKey(milestone: Milestone): string {
  return [milestone.kind, String(milestone.value ?? ''), milestone.at].join('|');
}

export interface MilestoneDiff {
  /** Milestones to announce now. Empty on the first run, by design. */
  readonly announce: readonly Milestone[];
  /** The full set to remember, whether announced or not. */
  readonly seen: readonly string[];
  readonly seeded: boolean;
}

export function diffMilestones(
  report: EgehanReport,
  previouslySeen: readonly string[] | undefined,
): MilestoneDiff {
  const keys = report.milestones.map(milestoneKey);

  if (previouslySeen === undefined) {
    return { announce: [], seen: keys, seeded: true };
  }

  const known = new Set(previouslySeen);
  const announce = report.milestones.filter((milestone) => !known.has(milestoneKey(milestone)));

  return {
    announce,
    seen: [...new Set([...previouslySeen, ...keys])],
    seeded: false,
  };
}

/**
 * One notification, however many milestones arrived.
 *
 * A single commit can cross a commit-count threshold, land a release tag and be an architectural
 * leap all at once. Three toasts for one commit is three times the interruption and no extra
 * information, so the newest one speaks and the rest are counted.
 */
export function celebrationText(
  announce: readonly Milestone[],
  title: string,
): { headline: string; detail: string } | null {
  if (announce.length === 0) return null;

  const latest = announce[announce.length - 1] as Milestone;
  const others = announce.length - 1;

  return {
    headline: title,
    detail: others === 0 ? latest.narrative : `${latest.narrative} (+${others})`,
  };
}
