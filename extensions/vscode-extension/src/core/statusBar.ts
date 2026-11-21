import type { EgehanReport } from 'egehan';

/**
 * The status bar entry: the project's age and size, in the language the chronicle is written in.
 *
 * The text comes from the dictionary rather than from this file, so a new language gets a
 * translated status bar with no code change — the same property the CLI has.
 */

export interface StatusBarContent {
  readonly text: string;
  readonly tooltip: string;
}

export function fill(template: string | undefined, values: Readonly<Record<string, string>>): string {
  return String(template ?? '').replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? (values[name] ?? '') : match,
  );
}

export function statusBarContent(
  report: EgehanReport,
  ui: Readonly<Record<string, string>>,
  labels: Readonly<Record<string, string>>,
): StatusBarContent {
  const text = fill(ui['statusBar'], {
    days: String(report.range.days),
    commits: String(report.totals.commits),
  });

  const lines = [
    report.project.name,
    '',
    `${labels['chronotype'] ?? 'Chronotype'}: ${report.pulse.chronotypeLabel}`,
    `${labels['busiestHour'] ?? 'Busiest hour'}: ${String(report.pulse.busiestHour).padStart(2, '0')}:00`,
    `${labels['creationRatio'] ?? 'New code'}: %${Math.round(report.pulse.creationRatio * 100)}`,
    `${labels['longestStreak'] ?? 'Longest streak'}: ${report.pulse.longestStreak.days}`,
    '',
    ui['openChronicle'] ?? 'Open the timeline',
  ];

  return { text: text.trim(), tooltip: lines.join('\n') };
}
