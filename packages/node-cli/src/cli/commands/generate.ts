import { isAbsolute, relative, resolve } from 'node:path';
import { writeArtifacts } from '../../artifacts.js';
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

  const written = writeArtifacts({
    report,
    dictionary: loadDictionary(report.config.language),
    rules,
    outputDirectory: outputDir,
    format,
  });

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
