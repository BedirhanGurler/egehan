import { basename, resolve } from 'node:path';
import { git, tryGit, type GitContext } from './runGit.js';

/** Facts about the repository that the report records but the engine does not reason about. */
export interface RepositoryInfo {
  readonly root: string;
  readonly name: string;
  readonly defaultBranch: string | null;
  readonly remoteHost: string | null;
}

export function isGitRepository(context: GitContext): boolean {
  const result = tryGit(context, 'rev-parse', '--git-dir');
  return result.exitCode === 0;
}

export function hasAnyCommit(context: GitContext): boolean {
  return tryGit(context, 'rev-parse', '--verify', 'HEAD').exitCode === 0;
}

export function readRepositoryInfo(context: GitContext): RepositoryInfo {
  const root = resolve(git(context, 'rev-parse', '--show-toplevel').trim());

  return {
    root,
    name: basename(root),
    defaultBranch: readDefaultBranch(context),
    remoteHost: readRemoteHost(context),
  };
}

function readDefaultBranch(context: GitContext): string | null {
  // The symbolic ref is the authoritative answer when a remote exists; the current branch is a
  // reasonable second guess for a repository that has never had one.
  const remoteHead = tryGit(context, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  if (remoteHead.exitCode === 0) {
    const value = remoteHead.stdout.trim();
    const branch = value.startsWith('origin/') ? value.slice('origin/'.length) : value;
    if (branch !== '') return branch;
  }

  const current = tryGit(context, 'rev-parse', '--abbrev-ref', 'HEAD');
  const name = current.stdout.trim();
  return current.exitCode === 0 && name !== '' && name !== 'HEAD' ? name : null;
}

/**
 * The remote's *host* only.
 *
 * A full remote URL can embed a token (`https://x-access-token:ghp_…@github.com/…`), and this value
 * ends up in a file people publish. Recording the host alone keeps the useful part — which forge
 * the project lives on — and leaves no room for a credential to ride along.
 */
function readRemoteHost(context: GitContext): string | null {
  const result = tryGit(context, 'remote', 'get-url', 'origin');
  if (result.exitCode !== 0) return null;

  const url = result.stdout.trim();
  if (url === '') return null;

  const scp = /^[^@/]+@([^:/]+):/.exec(url);
  if (scp !== null) return scp[1] ?? null;

  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** Resolves `--since` / `--until`, which users pass as a tag, a revision or a date. */
export function isRevision(context: GitContext, value: string): boolean {
  return tryGit(context, 'rev-parse', '--verify', '--quiet', `${value}^{commit}`).exitCode === 0;
}
