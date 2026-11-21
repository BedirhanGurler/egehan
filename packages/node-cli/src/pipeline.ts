import { resolve } from 'node:path';
import { detectProjectTypes, scanRepository } from './detect/projectType.js';
import { buildReport, EmptyHistoryError } from './engine/buildReport.js';
import { nowIso } from './engine/datetime.js';
import type { EgehanReport, SealedCapsule } from './engine/types.js';
import { readHistory } from './git/logReader.js';
import { hasAnyCommit, isGitRepository, readRepositoryInfo } from './git/repository.js';
import type { GitContext } from './git/runGit.js';
import { loadCapsule } from './capsule/storage.js';
import { loadConfig, mergeConfig, type EgehanConfig } from './config/config.js';
import { loadRules } from './spec/rules.js';
import { packageVersion } from './version.js';

/**
 * The one path from "a directory on disk" to "a finished report".
 *
 * Both the CLI and the IDE extensions call this, which is the point: the status bar in VS Code and
 * the file written by a git hook must never be able to disagree about what the history says.
 */

export class NotARepositoryError extends Error {
  constructor(path: string) {
    super(
      `"${path}" is not inside a git repository. Egehan reads a project's story from its commits, ` +
        'so there has to be a repository to read.',
    );
    this.name = 'NotARepositoryError';
  }
}

export class NoCommitsError extends Error {
  constructor() {
    super('This repository has no commits yet. Make the first one — that is the opening chapter.');
    this.name = 'NoCommitsError';
  }
}

export interface ProduceOptions {
  readonly cwd: string;
  readonly since?: string | null;
  readonly until?: string | null;
  /** CLI flags, merged over `.egehanrc.json`. */
  readonly overrides?: Record<string, unknown>;
  readonly capsule?: SealedCapsule | null;
  /** Injected in tests so a report can be compared byte for byte. */
  readonly generatedAt?: string;
  /** An embedder's own ceiling on how much history to read; never raises the contract's. */
  readonly maxCommits?: number | undefined;
}

export interface ProduceResult {
  readonly report: EgehanReport;
  readonly config: EgehanConfig;
  readonly repositoryRoot: string;
}

export function produceReport(options: ProduceOptions): ProduceResult {
  const rules = loadRules();
  const cwd = resolve(options.cwd);
  const gitContext: GitContext = { cwd, rules };

  if (!isGitRepository(gitContext)) throw new NotARepositoryError(cwd);
  if (!hasAnyCommit(gitContext)) throw new NoCommitsError();

  const repository = readRepositoryInfo(gitContext);
  const rootContext: GitContext = { cwd: repository.root, rules };

  const fileConfig = loadConfig(repository.root, rules);
  const config =
    options.overrides === undefined || Object.keys(options.overrides).length === 0
      ? fileConfig
      : mergeConfig(fileConfig, options.overrides, 'command line');

  const history = readHistory(
    rootContext,
    { since: options.since ?? null, until: options.until ?? null, maxCommits: options.maxCommits },
    rules,
  );

  const projectTypes = detectProjectTypes(scanRepository(repository.root, rules), rules);

  const report = buildReport({
    commits: history.commits,
    project: {
      name: config.projectName ?? repository.name,
      dedication: config.dedication,
      detectedTypes: projectTypes.detectedTypes,
      flavor: projectTypes.flavor,
      defaultBranch: repository.defaultBranch,
      remoteHost: repository.remoteHost,
    },
    config: {
      language: config.language,
      tone: config.tone,
      redactEmails: config.redactEmails,
      anonymizeAuthors: config.anonymizeAuthors,
      includeMergeCommits: config.includeMergeCommits,
      theme: config.theme,
    },
    range: {
      since: options.since ?? null,
      until: options.until ?? null,
      truncated: history.truncated,
    },
    generator: {
      version: packageVersion(),
      generatedAt: options.generatedAt ?? nowIso(),
    },
    // A repository's own capsule is picked up without being asked for: the point of sealing one
    // is that it rides along with every chronicle from then on.
    capsule: options.capsule ?? loadCapsule(repository.root, rules),
  });

  return { report, config, repositoryRoot: repository.root };
}

export { EmptyHistoryError };
