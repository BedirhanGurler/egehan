import { createHash } from 'node:crypto';
import type { EgehanRules } from '../spec/rules.js';
import type { AuthorSummary, Language, NormalizedCommit } from './types.js';

/**
 * Author identity and redaction.
 *
 * This engine reads `git log`, which contains every contributor's e-mail address, and writes an
 * HTML file whose entire purpose is to be shared. Redaction is therefore on by default: the first
 * time somebody runs Egehan on a work repository, it must not hand them a file that leaks their
 * team's addresses (docs/ARCHITECTURE.md, ADR-004). The hash is kept because identity merging and
 * avatar seeding need a stable key, and a truncated digest is a stable key that is not an address.
 */

export interface AuthorIdentity {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
  readonly emailHash: string | null;
  readonly email: string | null;
}

export interface PrivacyOptions {
  readonly redactEmails: boolean;
  readonly anonymizeAuthors: boolean;
  readonly language: Language;
}

interface AuthorAccumulator {
  key: string;
  latestName: string;
  latestAt: number;
  email: string;
  commits: number;
  insertions: number;
  deletions: number;
  firstCommitAt: string;
  lastCommitAt: string;
  firstSeenIndex: number;
}

export function hashEmail(email: string, rules: EgehanRules): string {
  return createHash(rules.privacy.emailHashAlgorithm)
    .update(email.trim().toLowerCase(), 'utf8')
    .digest('hex')
    .slice(0, rules.privacy.emailHashPrefixLength);
}

/**
 * Groups commits into authors.
 *
 * Identity is keyed on the lowercased e-mail, falling back to the name when a repository has
 * commits with no address at all. The display name is taken from the author's *most recent*
 * commit, because that is the spelling they currently use — people fix the capitalisation of their
 * own name years into a project, and the chronicle should show the corrected one.
 */
export function buildAuthors(
  commits: readonly NormalizedCommit[],
  rules: EgehanRules,
  options: PrivacyOptions,
): { authors: AuthorSummary[]; identityOf: (commit: NormalizedCommit) => AuthorIdentity } {
  const accumulators = new Map<string, AuthorAccumulator>();

  commits.forEach((commit, index) => {
    const key = identityKey(commit);
    const insertions = sum(commit, 'insertions');
    const deletions = sum(commit, 'deletions');
    const at = Date.parse(commit.authoredAt);

    const existing = accumulators.get(key);
    if (existing === undefined) {
      accumulators.set(key, {
        key,
        latestName: commit.authorName.trim(),
        latestAt: at,
        email: commit.authorEmail.trim(),
        commits: 1,
        insertions,
        deletions,
        firstCommitAt: commit.authoredAt,
        lastCommitAt: commit.authoredAt,
        firstSeenIndex: index,
      });
      return;
    }

    existing.commits += 1;
    existing.insertions += insertions;
    existing.deletions += deletions;
    existing.lastCommitAt = commit.authoredAt;
    if (at >= existing.latestAt) {
      existing.latestAt = at;
      if (commit.authorName.trim() !== '') existing.latestName = commit.authorName.trim();
    }
  });

  // Ordering is part of the contract: most commits first, then earliest appearance. Without a
  // total order the two engines could emit the same authors in different sequence.
  const ordered = [...accumulators.values()].sort(
    (a, b) => b.commits - a.commits || a.firstSeenIndex - b.firstSeenIndex,
  );

  const identities = new Map<string, AuthorIdentity>();
  const authors: AuthorSummary[] = ordered.map((accumulator, position) => {
    const emailHash = accumulator.email === '' ? null : hashEmail(accumulator.email, rules);
    const identity: AuthorIdentity = {
      id: emailHash === null ? `author-${slug(accumulator.key)}` : `author-${emailHash}`,
      key: accumulator.key,
      displayName: options.anonymizeAuthors
        ? anonymousName(position + 1, rules, options.language)
        : accumulator.latestName || accumulator.key,
      emailHash,
      email: options.redactEmails || options.anonymizeAuthors ? null : accumulator.email || null,
    };
    identities.set(accumulator.key, identity);

    return {
      id: identity.id,
      displayName: identity.displayName,
      emailHash: identity.emailHash,
      email: identity.email,
      commits: accumulator.commits,
      insertions: accumulator.insertions,
      deletions: accumulator.deletions,
      firstCommitAt: accumulator.firstCommitAt,
      lastCommitAt: accumulator.lastCommitAt,
    };
  });

  const identityOf = (commit: NormalizedCommit): AuthorIdentity => {
    const identity = identities.get(identityKey(commit));
    if (identity === undefined) {
      throw new Error(`No author identity was built for commit ${commit.sha}`);
    }
    return identity;
  };

  return { authors, identityOf };
}

function identityKey(commit: NormalizedCommit): string {
  const email = commit.authorEmail.trim().toLowerCase();
  return email !== '' ? email : `name:${commit.authorName.trim().toLowerCase()}`;
}

function anonymousName(index: number, rules: EgehanRules, language: Language): string {
  const template =
    language === 'tr' ? rules.privacy.anonymizeAuthorFormat : rules.privacy.anonymizeAuthorFormatEn;
  return template.replace('{index}', String(index));
}

function slug(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

function sum(commit: NormalizedCommit, field: 'insertions' | 'deletions'): number {
  return commit.files.reduce((total, file) => total + file[field], 0);
}

/**
 * Removes e-mail addresses from free text.
 *
 * Commit subjects do contain addresses — "fix: drop hardcoded admin@example.com" is a real commit
 * somebody has written — and the subject is reproduced verbatim in the chronicle. Redacting the
 * author field while publishing the subject untouched would be a redaction in name only.
 */
export function redactEmailsIn(text: string, rules: EgehanRules): string {
  return text.replace(new RegExp(rules.privacy.emailPattern, 'g'), '[redacted]');
}
