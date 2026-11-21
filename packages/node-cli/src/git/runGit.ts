import { spawnSync } from 'node:child_process';
import type { EgehanRules } from '../spec/rules.js';

/**
 * The only place in the codebase that invokes git.
 *
 * Everything here exists because of one failure mode: a chronicle whose Turkish commit messages
 * arrive as `Ã¼` on a Windows machine. The encoding flags in `rules.json → git.mandatoryFlags` are
 * applied to every invocation without exception, output is decoded as UTF-8 explicitly rather than
 * trusting the platform default, and `core.quotepath=false` keeps non-ASCII file paths readable
 * instead of octal-escaped.
 *
 * Commands are run with `spawnSync` and an argument array — never through a shell — so a branch or
 * tag name containing a space, a quote or a semicolon is data, not syntax.
 */

const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

export class GitError extends Error {
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(args: readonly string[], exitCode: number | null, stderr: string) {
    super(`git ${args.join(' ')} failed${exitCode === null ? '' : ` (exit ${exitCode})`}: ${stderr.trim()}`);
    this.name = 'GitError';
    this.args = args;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export interface GitContext {
  readonly cwd: string;
  readonly rules: EgehanRules;
}

export interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

/** Runs git and throws on failure. */
export function git(context: GitContext, ...args: string[]): string {
  const result = tryGit(context, ...args);
  if (result.exitCode !== 0) {
    throw new GitError(args, result.exitCode, result.stderr);
  }
  return result.stdout;
}

/** Runs git and returns the failure instead of throwing, for probes like `rev-parse --verify`. */
export function tryGit(context: GitContext, ...args: string[]): GitResult {
  const full = [...context.rules.git.mandatoryFlags, ...args];

  const result = spawnSync('git', full, {
    cwd: context.cwd,
    encoding: 'buffer',
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
    // An explicit, minimal environment for the variables that change git's output. A user with
    // GIT_PAGER=less or a locale that reorders output would otherwise get different results from
    // the same repository.
    env: {
      ...process.env,
      GIT_PAGER: 'cat',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C.UTF-8',
    },
  });

  if (result.error !== undefined) {
    const reason = result.error.message;
    throw new Error(
      reason.includes('ENOENT')
        ? 'git was not found on this system. Egehan reads history with git and cannot work without it.'
        : `Could not run git: ${reason}`,
    );
  }

  return {
    // Decoding is explicit and always UTF-8. Buffer.toString('utf8') is lossy only for invalid
    // sequences, which is the right trade: a replacement character is visible, mojibake is not.
    stdout: decode(result.stdout),
    stderr: decode(result.stderr),
    exitCode: result.status,
  };
}

function decode(value: Buffer | null): string {
  if (value === null) return '';
  // Strip a UTF-8 BOM, which git on Windows can emit for configured files.
  const text = value.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
