#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { runGenerate } from './commands/generate.js';
import { runInit } from './commands/init.js';
import { runStats } from './commands/stats.js';
import { fail, info, theme } from './output.js';
import { ConfigError, FORMATS, TONES, type OutputFormat } from '../config/config.js';
import { availableLanguages } from '../spec/dictionary.js';
import { EmptyHistoryError, NoCommitsError, NotARepositoryError } from '../pipeline.js';
import { GitError } from '../git/runGit.js';
import { packageVersion } from '../version.js';

/**
 * The CLI surface.
 *
 * Only commands that work are registered. A flag that parses and then does nothing is worse than a
 * missing flag: the first is a bug report from a user who trusted the help text, the second is a
 * feature request.
 */

interface SharedFlags {
  since?: string;
  until?: string;
  language?: string;
  tone?: string;
  anonymize?: boolean;
  redactEmails?: boolean;
  includeMerges?: boolean;
  projectName?: string;
}

function overridesFrom(flags: SharedFlags): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  if (flags.language !== undefined) overrides['language'] = flags.language;
  if (flags.tone !== undefined) overrides['tone'] = flags.tone;
  if (flags.anonymize === true) overrides['anonymizeAuthors'] = true;
  // commander maps --no-redact-emails to redactEmails === false.
  if (flags.redactEmails === false) overrides['redactEmails'] = false;
  if (flags.includeMerges === true) overrides['includeMergeCommits'] = true;
  if (flags.projectName !== undefined) overrides['projectName'] = flags.projectName;
  return overrides;
}

function withSharedFlags(command: Command): Command {
  return command
    .option('--since <ref>', 'start from a tag, revision or date (v1.0.0, HEAD~50, 2025-01-01)')
    .option('--until <ref>', 'stop at a tag, revision or date')
    .option('--language <code>', `narration language (${availableLanguages().join(', ')})`)
    .option('--tone <tone>', `narrative tone (${TONES.join(', ')})`)
    .option('--project-name <name>', 'override the project name')
    .option('--anonymize', 'replace author names with Developer #1, #2, …')
    .option('--no-redact-emails', 'keep author e-mail addresses in the output')
    .option('--include-merges', 'narrate merge commits too');
}

const program = new Command();

program
  .name('egehan')
  .description("Turn a project's git history into a living chronicle — offline, deterministic, no API key.")
  .version(packageVersion(), '-v, --version')
  .showHelpAfterError('(run `egehan --help` for the available commands)');

withSharedFlags(
  program
    .command('generate', { isDefault: true })
    .description('write the chronicle for this repository')
    .option('-o, --output <dir>', 'directory to write into (default: the repository root)')
    .option('-f, --format <format>', `output format (${FORMATS.join(', ')})`, parseFormat)
    .option('-q, --quiet', 'write the files and print nothing'),
).action((flags: SharedFlags & { output?: string; format?: OutputFormat; quiet?: boolean }) => {
  runGenerate({
    cwd: process.cwd(),
    since: flags.since ?? null,
    until: flags.until ?? null,
    output: flags.output ?? null,
    format: flags.format ?? null,
    overrides: overridesFrom(flags),
    quiet: flags.quiet === true,
  });
});

withSharedFlags(
  program.command('stats').description('show the Developer Pulse without writing any files'),
).action((flags: SharedFlags) => {
  runStats({
    cwd: process.cwd(),
    since: flags.since ?? null,
    until: flags.until ?? null,
    overrides: overridesFrom(flags),
  });
});

program
  .command('init')
  .description('create .egehanrc.json interactively')
  .option('-y, --yes', 'accept the defaults without asking')
  .option('--force', 'replace an existing .egehanrc.json')
  .action(async (flags: { yes?: boolean; force?: boolean }) => {
    await runInit({ cwd: process.cwd(), yes: flags.yes === true, force: flags.force === true });
  });

function parseFormat(value: string): OutputFormat {
  if (!FORMATS.includes(value as OutputFormat)) {
    throw new InvalidArgumentError(`Expected one of: ${FORMATS.join(', ')}`);
  }
  return value as OutputFormat;
}

/**
 * Error reporting.
 *
 * Expected failures — not a repository, no commits, a bad config — print one clear sentence and
 * exit 1. Only genuinely unexpected errors print a stack trace, because a stack trace shown for a
 * predictable situation teaches users that the tool is broken when it is merely being used in a
 * directory that is not a git repository.
 */
function reportError(error: unknown): never {
  if (
    error instanceof NotARepositoryError ||
    error instanceof NoCommitsError ||
    error instanceof EmptyHistoryError ||
    error instanceof ConfigError ||
    error instanceof GitError
  ) {
    fail(error.message);
    process.exit(1);
  }

  if (error instanceof Error) {
    fail(error.message);
    if (process.env['EGEHAN_DEBUG'] === '1' && error.stack !== undefined) {
      info(theme.muted(error.stack));
    } else {
      info(theme.muted('Set EGEHAN_DEBUG=1 for a stack trace.'));
    }
    process.exit(1);
  }

  fail(String(error));
  process.exit(1);
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  reportError(error);
}
