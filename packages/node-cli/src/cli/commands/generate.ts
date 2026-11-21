import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { renderHtml } from '../../renderers/html.js';
import { renderMarkdown } from '../../renderers/markdown.js';
import { loadDictionary } from '../../spec/dictionary.js';
import { loadRules } from '../../spec/rules.js';
import { produceReport } from '../../pipeline.js';
import { info, success, theme, warn } from '../output.js';
import type { OutputFormat } from '../../config/config.js';

/**
 * `egehan generate` — writes the chronicle.
 *
 * Output is written atomically-ish and idempotently: because narration is deterministic, running
 * this twice on an unchanged repository produces byte-identical files. That is what makes it safe
 * for a git hook to run it after every commit without filling the project's diff with noise.
 */

export interface GenerateOptions {
  readonly cwd: string;
  readonly since: string | null;
  readonly until: string | null;
  readonly output: string | null;
  readonly format: OutputFormat | null;
  readonly overrides: Record<string, unknown>;
  readonly quiet: boolean;
}

export interface GenerateResult {
  readonly writtenFiles: readonly string[];
  readonly commits: number;
}

export function runGenerate(options: GenerateOptions): GenerateResult {
  const rules = loadRules();
  const { report, config, repositoryRoot } = produceReport({
    cwd: options.cwd,
    since: options.since,
    until: options.until,
    overrides: options.overrides,
  });

  const format = options.format ?? config.format;
  const outputDir = resolveOutputDir(repositoryRoot, options.output ?? config.output);
  mkdirSync(outputDir, { recursive: true });

  const wants = (candidate: OutputFormat): boolean =>
    format === candidate || format === 'all' || (format === 'both' && candidate !== 'json');

  const dictionary = loadDictionary(report.config.language);
  const written: string[] = [];

  if (wants('md')) {
    const path = join(outputDir, rules.output.markdownFileName);
    writeFileSync(path, renderMarkdown(report, dictionary), 'utf8');
    written.push(path);
  }

  if (wants('html')) {
    const path = join(outputDir, rules.output.htmlFileName);
    writeFileSync(path, renderHtml(report, dictionary, rules), 'utf8');
    written.push(path);
  }

  if (wants('json')) {
    const path = join(outputDir, rules.output.reportFileName);
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    written.push(path);
  }

  if (!options.quiet) {
    if (report.range.truncated) {
      warn(
        `Only the most recent ${rules.limits.maxCommitsPerRun} commits were read. ` +
          'Narrow the range with --since to cover a specific period.',
      );
    }
    if (report.totals.commits >= rules.limits.warnAboveCommits) {
      warn(`${report.totals.commits} commits is a lot of story. Consider --since for a focused chapter.`);
    }

    info('');
    info(
      `${theme.heading(report.project.name)} ${theme.muted('·')} ` +
        `${theme.value(String(report.totals.commits))} commits ${theme.muted('·')} ` +
        `${theme.value(String(report.range.days))} days ${theme.muted('·')} ` +
        `${theme.value(String(report.chapters.length))} chapters`,
    );
    for (const path of written) {
      success(relative(options.cwd, path) || path);
    }
    info('');
  }

  return { writtenFiles: written, commits: report.totals.commits };
}

function resolveOutputDir(repositoryRoot: string, output: string): string {
  return isAbsolute(output) ? output : resolve(repositoryRoot, output);
}
