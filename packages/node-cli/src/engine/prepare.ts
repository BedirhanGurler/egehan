import type { EgehanRules } from '../spec/rules.js';
import { parseSubject } from './conventional.js';
import { parseTimestamp, type LocalTimestamp } from './datetime.js';
import { redactEmailsIn } from './privacy.js';
import type { ConventionalInfo, Language, NormalizedCommit, SizeBucket } from './types.js';

/**
 * Everything the later stages need about a commit, computed once.
 *
 * Classification, narration, chapter grouping and the pulse all want the same derived facts — the
 * local hour, the line counts, the cleaned subject. Deriving them in one place means they cannot
 * disagree with each other, and it keeps the stages that follow readable: a classifier that also
 * parses timestamps is a classifier nobody can review.
 */

export interface PreparedCommit {
  readonly index: number;
  readonly source: NormalizedCommit;
  readonly authoredAt: LocalTimestamp;
  readonly committedAt: LocalTimestamp;
  readonly subject: string;
  readonly cleanSubject: string;
  readonly conventional: ConventionalInfo;
  readonly insertions: number;
  readonly deletions: number;
  readonly changedLines: number;
  readonly filesCount: number;
  readonly sizeBucket: SizeBucket;
  readonly tags: readonly string[];
  /** The subset of `tags` that look like a release, per rules.json → milestone.tagPattern. */
  readonly releaseTags: readonly string[];
  readonly isMerge: boolean;
}

export interface PrepareOptions {
  readonly language: Language;
  readonly redactEmails: boolean;
}

export function prepareCommits(
  commits: readonly NormalizedCommit[],
  rules: EgehanRules,
  options: PrepareOptions,
): PreparedCommit[] {
  const tagPattern = new RegExp(requireTagPattern(rules));

  return commits.map((commit, index) => {
    const { conventional, cleanSubject } = parseSubject(commit, rules, options.language);
    const insertions = commit.files.reduce((total, file) => total + file.insertions, 0);
    const deletions = commit.files.reduce((total, file) => total + file.deletions, 0);

    const subject = options.redactEmails ? redactEmailsIn(commit.subject, rules) : commit.subject;
    const cleaned = options.redactEmails ? redactEmailsIn(cleanSubject, rules) : cleanSubject;

    return {
      index,
      source: commit,
      authoredAt: parseTimestamp(commit.authoredAt),
      committedAt: parseTimestamp(commit.committedAt),
      subject,
      cleanSubject: cleaned,
      conventional,
      insertions,
      deletions,
      changedLines: insertions + deletions,
      filesCount: commit.files.length,
      sizeBucket: bucketFor(insertions + deletions, rules),
      tags: commit.tags,
      releaseTags: commit.tags.filter((tag) => tagPattern.test(tag)),
      isMerge: commit.parents.length > 1,
    };
  });
}

function bucketFor(changedLines: number, rules: EgehanRules): SizeBucket {
  for (const bucket of rules.pulse.sizeBuckets) {
    if (bucket.maxChangedLines === null || changedLines <= bucket.maxChangedLines) {
      return bucket.id as SizeBucket;
    }
  }
  throw new Error('rules.json → pulse.sizeBuckets has no open-ended final bucket');
}

export function requireTagPattern(rules: EgehanRules): string {
  const pattern = rules.classification.categories['milestone']?.tagPattern;
  if (pattern === undefined) {
    throw new Error('rules.json → classification.categories.milestone.tagPattern is missing');
  }
  return pattern;
}
