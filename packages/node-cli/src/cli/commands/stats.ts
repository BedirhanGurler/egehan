import { loadDictionary } from '../../spec/dictionary.js';
import { produceReport } from '../../pipeline.js';
import { info, theme, visibleWidth } from '../output.js';
import type { EgehanReport } from '../../engine/types.js';
import type { Dictionary } from '../../spec/dictionary.js';

/**
 * `egehan stats` — the Developer Pulse, in the terminal.
 *
 * Deliberately a read-only command that writes no files. It is the thing somebody runs out of
 * curiosity, and a command run out of curiosity must never leave anything behind.
 */

export interface StatsOptions {
  readonly cwd: string;
  readonly since: string | null;
  readonly until: string | null;
  readonly overrides: Record<string, unknown>;
}

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
const PANEL_WIDTH = 64;

export function runStats(options: StatsOptions): void {
  const { report } = produceReport({
    cwd: options.cwd,
    since: options.since,
    until: options.until,
    overrides: options.overrides,
  });

  const dictionary = loadDictionary(report.config.language);
  render(report, dictionary);
}

function render(report: EgehanReport, dictionary: Dictionary): void {
  const { pulse } = report;
  const labels = dictionary.pulse.labels;
  const chronotype = dictionary.pulse.chronotypes[pulse.chronotype];

  info('');
  info(frameTop());
  info(frameLine(`${theme.heading(report.project.name)} ${theme.muted('— ' + dictionary.pulse.title)}`));
  info(frameSeparator());

  info(frameLine(wrapText(pulse.narrative, PANEL_WIDTH - 4)[0] ?? ''));
  for (const line of wrapText(pulse.narrative, PANEL_WIDTH - 4).slice(1)) {
    info(frameLine(line));
  }
  info(frameSeparator());

  const rows: Array<[string, string]> = [
    [labels['chronotype'] ?? '', `${chronotype?.icon ?? ''} ${pulse.chronotypeLabel}`],
    [labels['busiestDay'] ?? '', dictionary.locale.weekdays[pulse.busiestWeekday] ?? ''],
    [labels['busiestHour'] ?? '', `${pad(pulse.busiestHour)}:00`],
    [labels['creationRatio'] ?? '', `${Math.round(pulse.creationRatio * 100)}%`],
    [labels['avgCommitSize'] ?? '', `${pulse.avgChangedLines} ${dictionary.units.line.other}`.trim()],
    [
      labels['longestStreak'] ?? '',
      pulse.longestStreak.days > 0
        ? `${pulse.longestStreak.days} (${pulse.longestStreak.from} → ${pulse.longestStreak.to})`
        : '—',
    ],
    [labels['totalCommits'] ?? '', String(report.totals.commits)],
    [labels['totalAuthors'] ?? '', String(report.totals.authors)],
    [labels['projectAge'] ?? '', `${report.range.days} ${dictionary.ui['daysLabel'] ?? ''}`.trim()],
  ];

  const widest = Math.max(...rows.map(([label]) => visibleWidth(label)));
  for (const [label, value] of rows) {
    info(frameLine(`${theme.muted(label.padEnd(widest))}  ${theme.value(value)}`));
  }

  info(frameSeparator());
  info(frameLine(theme.muted(labels['hourDistribution'] ?? '')));
  info(frameLine(histogram(pulse.hourHistogram)));
  info(frameLine(theme.muted('0   3   6   9   12  15  18  21')));

  info(frameSeparator());
  info(frameLine(theme.muted(labels['weekdayDistribution'] ?? '')));
  info(frameLine(histogram(pulse.weekdayHistogram, 3)));
  info(
    frameLine(theme.muted(dictionary.locale.weekdaysShort.map((day) => day.slice(0, 3).padEnd(3)).join(''))),
  );

  info(frameSeparator());
  const categories = Object.entries(report.totals.byCategory)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => {
      const narratives = dictionary.categories[category as keyof typeof dictionary.categories];
      return `${narratives?.icon ?? ''}${theme.value(String(count))}`;
    });
  info(frameLine(categories.join('  ')));
  info(frameBottom());
  info('');
}

function histogram(values: readonly number[], cellWidth = 1): string {
  const peak = Math.max(1, ...values);
  return values
    .map((count) => {
      if (count === 0) return ' '.repeat(cellWidth);
      const level = Math.ceil((count / peak) * BLOCKS.length) - 1;
      const block = BLOCKS[Math.max(0, Math.min(BLOCKS.length - 1, level))] ?? ' ';
      return theme.accent(block.padEnd(cellWidth));
    })
    .join('');
}

/** Word wrap that counts visible characters, so styled text does not break the frame. */
function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (line === '') {
      line = word;
    } else if (visibleWidth(`${line} ${word}`) <= width) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);

  return lines.length > 0 ? lines : [''];
}

const frameTop = (): string => theme.muted(`╭${'─'.repeat(PANEL_WIDTH - 2)}╮`);
const frameBottom = (): string => theme.muted(`╰${'─'.repeat(PANEL_WIDTH - 2)}╯`);
const frameSeparator = (): string => theme.muted(`├${'─'.repeat(PANEL_WIDTH - 2)}┤`);

function frameLine(content: string): string {
  const inner = PANEL_WIDTH - 4;
  const padding = Math.max(0, inner - visibleWidth(content));
  return `${theme.muted('│')} ${content}${' '.repeat(padding)} ${theme.muted('│')}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
