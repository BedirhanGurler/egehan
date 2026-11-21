import type { Dictionary } from '../spec/dictionary.js';
import { loadRules } from '../spec/rules.js';
import { formatDate } from '../engine/datetime.js';
import { parseTimestamp } from '../engine/datetime.js';
import type { EgehanReport, ReportChapter, ReportEntry } from '../engine/types.js';

/**
 * Renders `EGEHAN.md` — the version of the chronicle that lives in the repository.
 *
 * Markdown is the format that survives: it reviews well in a pull request, renders on every forge,
 * and still reads as plain text in thirty years. The HTML timeline is the one people look at; this
 * is the one the project keeps.
 *
 * Every label comes from the dictionary, so the file is written in the reader's language rather
 * than in English with translated sentences embedded in it.
 */

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

export function renderMarkdown(report: EgehanReport, dictionary: Dictionary): string {
  const ui = dictionary.ui;
  const lines: string[] = [];

  const title = fill(ui['documentTitle'], { project: report.project.name });
  lines.push(`# ${title}`, '');

  if (report.project.dedication !== null && report.project.dedication.trim() !== '') {
    lines.push(`> ${report.project.dedication.trim()}`, '');
  }

  lines.push(
    `> ${fill(ui['subtitle'], {
      days: String(report.range.days),
      commits: String(report.totals.commits),
    })}`,
    '',
  );

  lines.push(...renderSummary(report, dictionary), '');
  lines.push(...renderPulse(report, dictionary), '');

  if (report.milestones.length > 0) {
    lines.push(...renderMilestones(report, dictionary), '');
  }

  lines.push(`## ${ui['timelineTitle'] ?? 'Timeline'}`, '');
  report.chapters.forEach((chapter, index) => {
    lines.push(...renderChapter(chapter, index, report, dictionary), '');
  });

  lines.push('---', '');

  // No generation timestamp here unless the contract asks for one. This file is committed, and a
  // hook that regenerates it after every commit must leave the bytes alone when the history has
  // not changed — otherwise every commit drags a pointless one-line diff along with it.
  const footer = [fill(ui['generatedBy'], { version: report.generator.version })];
  if (loadRules().output.embedGenerationTimeInArtifacts) {
    footer.push(fill(ui['generatedAt'], { date: report.generator.generatedAt }));
  }
  lines.push(`<sub>${footer.join(' · ')}</sub>`);

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

function renderSummary(report: EgehanReport, dictionary: Dictionary): string[] {
  const labels = dictionary.pulse.labels;
  const ui = dictionary.ui;

  const rows: Array<[string, string]> = [
    [labels['totalCommits'] ?? 'Commits', String(report.totals.commits)],
    [labels['totalAuthors'] ?? 'Authors', String(report.totals.authors)],
    [labels['projectAge'] ?? 'Age', `${report.range.days} ${ui['daysLabel'] ?? 'days'}`],
    [labels['filesTouched'] ?? ui['filesLabel'] ?? 'files', String(report.totals.filesTouched)],
    [
      labels['lineChurn'] ?? `${ui['insertionsLabel'] ?? '+'} / ${ui['deletionsLabel'] ?? '-'}`,
      `+${report.totals.insertions} / −${report.totals.deletions}`,
    ],
  ];

  const categories = Object.entries(report.totals.byCategory)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => {
      const narratives = dictionary.categories[category as keyof typeof dictionary.categories];
      return `${narratives?.icon ?? ''} ${narratives?.label ?? category} ${count}`.trim();
    });

  return [
    '| | |',
    '| --- | --- |',
    ...rows.map(([label, value]) => `| ${label} | **${value}** |`),
    '',
    categories.join(' · '),
  ];
}

function renderPulse(report: EgehanReport, dictionary: Dictionary): string[] {
  const { pulse } = report;
  const labels = dictionary.pulse.labels;
  const chronotype = dictionary.pulse.chronotypes[pulse.chronotype];
  const weekday = dictionary.locale.weekdays[pulse.busiestWeekday] ?? '';

  return [
    `## ${dictionary.pulse.title}`,
    '',
    pulse.narrative,
    '',
    '| | |',
    '| --- | --- |',
    `| ${labels['chronotype']} | **${chronotype?.icon ?? ''} ${pulse.chronotypeLabel}** |`,
    `| ${labels['busiestDay']} | **${weekday}** |`,
    `| ${labels['busiestHour']} | **${pad(pulse.busiestHour)}:00** |`,
    `| ${labels['creationRatio']} | **%${Math.round(pulse.creationRatio * 100)}** |`,
    `| ${labels['avgCommitSize']} | **${pulse.avgChangedLines} ${dictionary.units.line.other}** |`,
    `| ${labels['longestStreak']} | **${pulse.longestStreak.days} ${dictionary.units.day.other}** |`,
    '',
    `**${labels['hourDistribution']}**`,
    '',
    '```text',
    `${sparkline(pulse.hourHistogram)}`,
    `${hourAxis()}`,
    '```',
  ];
}

function renderMilestones(report: EgehanReport, dictionary: Dictionary): string[] {
  const lines = [`## ${dictionary.categories.milestone.icon} ${dictionary.categories.milestone.label}`, ''];

  for (const milestone of report.milestones) {
    const at = parseTimestamp(milestone.at);
    const date = formatDate(at, dictionary.locale.dateFormat, dictionary.locale.months);
    lines.push(`- **${date}** — ${milestone.narrative}`);
  }

  return lines;
}

function renderChapter(
  chapter: ReportChapter,
  index: number,
  report: EgehanReport,
  dictionary: Dictionary,
): string[] {
  const narratives = dictionary.categories[chapter.category];
  const entries = chapter.entryShas
    .map((sha) => report.entries.find((entry) => entry.sha === sha))
    .filter((entry): entry is ReportEntry => entry !== undefined);

  const from = parseTimestamp(chapter.from);
  const to = parseTimestamp(chapter.to);
  const range =
    from.dayKey === to.dayKey
      ? formatDate(from, dictionary.locale.dateFormat, dictionary.locale.months)
      : `${formatDate(from, dictionary.locale.dateShortFormat, dictionary.locale.months)} – ` +
        `${formatDate(to, dictionary.locale.dateFormat, dictionary.locale.months)}`;

  const lines = [
    `### ${index + 1}. ${narratives?.icon ?? ''} ${chapter.title}`.replace('  ', ' '),
    '',
    `<sub>${range} · ${fill(dictionary.ui['chapterCommits'], { commits: String(chapter.stats.commits) })}</sub>`,
    '',
    `*${chapter.narrative}*`,
    '',
  ];

  for (const entry of entries) {
    const at = parseTimestamp(entry.authoredAt);
    const date = formatDate(at, dictionary.locale.dateShortFormat, dictionary.locale.months);
    const author = report.authors.find((candidate) => candidate.id === entry.authorId);

    lines.push(`- **${date}** · \`${entry.shortSha}\` — ${entry.narrative}`);
    lines.push(
      `  <sub>${author?.displayName ?? ''} · ` +
        `${entry.stats.filesCount} ${dictionary.ui['filesLabel']} · ` +
        `+${entry.stats.insertions} / −${entry.stats.deletions}` +
        (entry.tags.length > 0 ? ` · \`${entry.tags.join('`, `')}\`` : '') +
        '</sub>',
    );
  }

  return lines;
}

/** A 24-column bar chart, scaled to the busiest hour. */
function sparkline(histogram: readonly number[]): string {
  const peak = Math.max(1, ...histogram);
  return histogram
    .map((count) => {
      if (count === 0) return ' ';
      const level = Math.ceil((count / peak) * SPARK.length) - 1;
      return SPARK[Math.max(0, Math.min(SPARK.length - 1, level))] ?? ' ';
    })
    .join('');
}

function hourAxis(): string {
  return '0   3   6   9   12  15  18  21';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function fill(template: string | undefined, values: Readonly<Record<string, string>>): string {
  if (template === undefined) return '';
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, name: string) => values[name] ?? match);
}
