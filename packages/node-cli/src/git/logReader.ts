import type { EgehanRules } from '../spec/rules.js';
import type { ChangedFile, NormalizedCommit } from '../engine/types.js';
import { git, type GitContext } from './runGit.js';
import { isRevision } from './repository.js';

/**
 * Reads a repository's history into the engine's input shape.
 *
 * This is the last platform-specific stage: everything downstream consumes `NormalizedCommit[]`
 * and must behave identically in every runtime (docs/ARCHITECTURE.md). Three details here matter
 * more than they look:
 *
 * - **Records are delimited by control characters**, not newlines, because commit bodies contain
 *   newlines and a newline-delimited format would mis-parse any commit with a paragraph in it.
 * - **Tags come from `for-each-ref`**, not from the log's `%D` decoration: an annotated tag's
 *   object name is not the commit's, so decoration-based parsing silently drops annotated
 *   releases — the ones a project cared enough to annotate.
 * - **Commits are re-sorted chronologically.** `git log` is topological; fix clustering and streak
 *   counting are chronological. The sort has an explicit total tie-break so the order can never
 *   depend on which engine read it.
 */

export interface ReadHistoryOptions {
  readonly since: string | null;
  readonly until: string | null;
  /**
   * A lower cap than the contract's own, for callers that must stay responsive — an editor
   * status bar cannot afford to read a hundred thousand commits on every refresh. Never higher
   * than `rules.limits.maxCommitsPerRun`, so a caller cannot opt out of the global ceiling.
   */
  readonly maxCommits?: number | undefined;
}

export interface History {
  readonly commits: readonly NormalizedCommit[];
  readonly truncated: boolean;
}

const RECORD = '\u001e';
const FIELD = '\u001f';

/** Eight fixed fields, then the body, then a trailing separator so numstat is always the last part. */
const PRETTY_FORMAT = `${RECORD}%H${FIELD}%h${FIELD}%P${FIELD}%an${FIELD}%ae${FIELD}%aI${FIELD}%cI${FIELD}%s${FIELD}%b${FIELD}`;

const FIXED_FIELD_COUNT = 8;

export function readHistory(context: GitContext, options: ReadHistoryOptions, rules: EgehanRules): History {
  const ceiling = rules.limits.maxCommitsPerRun;
  const requested = options.maxCommits;
  const limit =
    requested === undefined || requested <= 0 ? ceiling : Math.min(ceiling, Math.floor(requested));

  const output = git(
    context,
    'log',
    '--reverse',
    '--numstat',
    `--max-count=${limit}`,
    `--pretty=format:${PRETTY_FORMAT}`,
    ...rangeArguments(context, options),
  );

  const tags = readTags(context);
  const commits = output
    .split(RECORD)
    .slice(1) // the format emits a leading separator
    .map((record) => parseRecord(record, tags, rules))
    .filter((commit): commit is NormalizedCommit => commit !== null);

  return { commits: sortChronologically(commits), truncated: commits.length >= limit };
}

/**
 * Turns `--since` / `--until` into git arguments.
 *
 * Users pass whichever they have at hand: a tag (`v1.0.0`), a revision (`HEAD~50`) or a date
 * (`2025-01-01`, `3 months ago`). Probing with `rev-parse` tells the two apart, so both work
 * without the user having to know which form the tool wanted.
 */
function rangeArguments(context: GitContext, options: ReadHistoryOptions): string[] {
  const { since, until } = options;
  const sinceIsRevision = since !== null && isRevision(context, since);
  const untilIsRevision = until !== null && isRevision(context, until);

  const args: string[] = [];

  if (sinceIsRevision && untilIsRevision) {
    args.push(`${since}..${until}`);
  } else if (sinceIsRevision) {
    args.push(`${since}..HEAD`);
  } else if (untilIsRevision) {
    args.push(until as string);
  }

  if (since !== null && !sinceIsRevision) args.push(`--since=${since}`);
  if (until !== null && !untilIsRevision) args.push(`--until=${until}`);

  return args;
}

function parseRecord(
  record: string,
  tags: ReadonlyMap<string, string[]>,
  rules: EgehanRules,
): NormalizedCommit | null {
  const trimmed = record.replace(/^\n+/, '');
  if (trimmed.trim() === '') return null;

  const parts = trimmed.split(FIELD);
  if (parts.length < FIXED_FIELD_COUNT + 2) return null;

  const [sha, , parentList, authorName, authorEmail, authoredAt, committedAt, subject] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    ...string[],
  ];

  // The body may itself contain the field separator; numstat is always the final part.
  const body = parts.slice(FIXED_FIELD_COUNT, parts.length - 1).join(FIELD);
  const numstat = parts[parts.length - 1] ?? '';

  return {
    sha,
    parents: parentList.trim() === '' ? [] : parentList.trim().split(/\s+/),
    authorName,
    authorEmail,
    authoredAt,
    committedAt,
    subject: truncate(subject, rules.git.maxSubjectLength),
    body: body.trim(),
    tags: tags.get(sha) ?? [],
    files: parseNumstat(numstat),
  };
}

/**
 * Parses `--numstat` lines.
 *
 * Binary files report `-` instead of a line count; they are kept with zero lines, because a commit
 * that added a 4 MB design asset did touch a file and saying otherwise would misreport the file
 * count. Renames arrive as `old => new` paths and are recorded verbatim: inventing a canonical
 * path would make the distinct-file count disagree with what the developer sees in `git show`.
 */
function parseNumstat(block: string): ChangedFile[] {
  const files: ChangedFile[] = [];

  for (const line of block.split('\n')) {
    if (line.trim() === '') continue;

    const columns = line.split('\t');
    if (columns.length < 3) continue;

    const [insertions, deletions, ...pathParts] = columns as [string, string, ...string[]];
    const path = pathParts.join('\t').trim();
    if (path === '') continue;

    files.push({
      path,
      insertions: insertions === '-' ? 0 : Number.parseInt(insertions, 10) || 0,
      deletions: deletions === '-' ? 0 : Number.parseInt(deletions, 10) || 0,
    });
  }

  return files;
}

/** sha → tag names, resolving annotated tags to the commit they point at. */
export function readTags(context: GitContext): Map<string, string[]> {
  const output = git(
    context,
    'for-each-ref',
    'refs/tags',
    `--format=%(objectname)${FIELD}%(*objectname)${FIELD}%(refname:short)`,
  );

  const tags = new Map<string, string[]>();

  for (const line of output.split('\n')) {
    if (line.trim() === '') continue;

    const [objectName, dereferenced, name] = line.split(FIELD) as [string, string, string];
    // For an annotated tag, %(*objectname) is the commit; for a lightweight tag it is empty.
    const sha = dereferenced.trim() !== '' ? dereferenced.trim() : objectName.trim();
    if (sha === '' || name === undefined || name.trim() === '') continue;

    const existing = tags.get(sha);
    if (existing === undefined) {
      tags.set(sha, [name.trim()]);
    } else {
      existing.push(name.trim());
    }
  }

  // Several tags on one commit are sorted, so the first one the narrator picks is stable.
  for (const names of tags.values()) names.sort();

  return tags;
}

function sortChronologically(commits: readonly NormalizedCommit[]): NormalizedCommit[] {
  return [...commits].sort(
    (a, b) =>
      Date.parse(a.authoredAt) - Date.parse(b.authoredAt) ||
      Date.parse(a.committedAt) - Date.parse(b.committedAt) ||
      (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0),
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
