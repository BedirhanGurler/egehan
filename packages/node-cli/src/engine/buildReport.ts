import { loadDictionary } from '../spec/dictionary.js';
import { loadRules } from '../spec/rules.js';
import { classifyCommits } from './classifier.js';
import { classificationFor, groupIntoChapters } from './chapters.js';
import { inclusiveDaySpan } from './datetime.js';
import { computeMilestones } from './milestones.js';
import { createNarrationContext, narrateChapter, narrateEntry } from './narrator.js';
import { prepareCommits, type PreparedCommit } from './prepare.js';
import { computePulse } from './pulse.js';
import { buildAuthors } from './privacy.js';
import type {
  Category,
  CommitType,
  EgehanReport,
  NormalizedCommit,
  ProjectInfo,
  ReportChapter,
  ReportConfig,
  ReportEntry,
  SealedCapsule,
  Totals,
} from './types.js';

/**
 * Assembles the report.
 *
 * This is the only place in the engine that knows the whole pipeline, and it is deliberately
 * boring: each stage is a pure function of the stage before it, and nothing here reads the
 * filesystem, spawns a process or looks at the clock. `generatedAt` arrives as an argument rather
 * than being read here, which is what lets the conformance tests compare two engines' output byte
 * for byte.
 */

export interface BuildReportInput {
  readonly commits: readonly NormalizedCommit[];
  readonly project: Omit<ProjectInfo, 'dedication'> & { readonly dedication: string | null };
  readonly config: ReportConfig;
  readonly range: {
    readonly since: string | null;
    readonly until: string | null;
    readonly truncated: boolean;
  };
  readonly generator: {
    readonly version: string;
    readonly generatedAt: string;
  };
  readonly capsule: SealedCapsule | null;
}

export class EmptyHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyHistoryError';
  }
}

export function buildReport(input: BuildReportInput): EgehanReport {
  const rules = loadRules();
  const dictionary = loadDictionary(input.config.language);

  const commits = input.config.includeMergeCommits
    ? input.commits
    : input.commits.filter((commit) => commit.parents.length <= 1);

  if (commits.length === 0) {
    throw new EmptyHistoryError(
      input.commits.length === 0
        ? 'This range contains no commits, so there is no story to tell yet.'
        : 'This range contains only merge commits. Pass --include-merges to narrate them.',
    );
  }

  const prepared = prepareCommits(commits, rules, {
    language: input.config.language,
    redactEmails: input.config.redactEmails,
  });

  const { authors, identityOf } = buildAuthors(commits, rules, {
    redactEmails: input.config.redactEmails,
    anonymizeAuthors: input.config.anonymizeAuthors,
    language: input.config.language,
  });

  const context = createNarrationContext(
    dictionary,
    rules,
    input.config.tone,
    input.config.language,
    input.project.flavor,
  );

  const classifications = classifyCommits(prepared, rules);

  const entries: ReportEntry[] = prepared.map((commit) => {
    const classification = classificationFor(classifications, commit);
    const author = identityOf(commit.source);
    const narrated = narrateEntry(
      commit,
      classification.category,
      classification.secondaryCategories,
      author.displayName,
      context,
    );

    return {
      sha: commit.source.sha,
      shortSha: commit.source.sha.slice(0, 7),
      parents: commit.source.parents,
      authorId: author.id,
      authoredAt: commit.source.authoredAt,
      committedAt: commit.source.committedAt,
      tzOffsetMinutes: commit.authoredAt.offsetMinutes,
      localHour: commit.authoredAt.hour,
      localWeekday: commit.authoredAt.weekday,
      subject: commit.subject,
      cleanSubject: commit.cleanSubject,
      conventional: commit.conventional,
      tags: commit.tags,
      stats: {
        filesCount: commit.filesCount,
        insertions: commit.insertions,
        deletions: commit.deletions,
        sizeBucket: commit.sizeBucket,
      },
      category: classification.category,
      secondaryCategories: classification.secondaryCategories,
      narrative: narrated.narrative,
      isMerge: commit.isMerge,
      variantIndex: narrated.variantIndex,
    };
  });

  const chapters = groupIntoChapters(prepared, classifications, rules).map((group, index) =>
    toChapter(group.category, group.commits, index, identityOf, context),
  );

  const pulse = computePulse(prepared, rules, context);
  const milestones = computeMilestones(prepared, pulse, rules, context);

  const firstCommit = prepared[0] as PreparedCommit;
  const lastCommit = prepared[prepared.length - 1] as PreparedCommit;

  return {
    schemaVersion: rules.schemaVersion,
    generator: {
      name: 'egehan',
      version: input.generator.version,
      platform: 'node',
      specVersion: rules.specVersion,
      dictionaryVersion: dictionary.version,
      generatedAt: input.generator.generatedAt,
    },
    project: input.project,
    config: input.config,
    range: {
      since: input.range.since,
      until: input.range.until,
      firstCommitAt: firstCommit.source.authoredAt,
      lastCommitAt: lastCommit.source.authoredAt,
      days: inclusiveDaySpan(firstCommit.authoredAt, lastCommit.authoredAt),
      truncated: input.range.truncated,
    },
    totals: computeTotals(prepared, entries, authors.length),
    authors,
    chapters,
    entries,
    pulse,
    milestones,
    capsule: input.capsule,
  };
}

function toChapter(
  category: Category,
  commits: readonly PreparedCommit[],
  index: number,
  identityOf: (commit: NormalizedCommit) => { id: string },
  context: Parameters<typeof narrateChapter>[1],
): ReportChapter {
  const first = commits[0] as PreparedCommit;
  const last = commits[commits.length - 1] as PreparedCommit;

  const files = new Set<string>();
  const authorIds = new Set<string>();
  let insertions = 0;
  let deletions = 0;

  for (const commit of commits) {
    insertions += commit.insertions;
    deletions += commit.deletions;
    authorIds.add(identityOf(commit.source).id);
    for (const file of commit.source.files) files.add(file.path);
  }

  const narrated = narrateChapter(
    {
      category,
      commits: commits.length,
      insertions,
      deletions,
      filesCount: files.size,
      authorsCount: authorIds.size,
      from: first.authoredAt,
      to: last.authoredAt,
      seedSha: first.source.sha,
    },
    context,
  );

  return {
    id: `chapter-${String(index + 1).padStart(3, '0')}`,
    category,
    title: narrated.title,
    narrative: narrated.narrative,
    from: first.source.authoredAt,
    to: last.source.authoredAt,
    entryShas: commits.map((commit) => commit.source.sha),
    stats: {
      commits: commits.length,
      insertions,
      deletions,
      filesCount: files.size,
      // Sorted, because a Set's iteration order is an implementation detail and this value is
      // compared across engines.
      authorIds: [...authorIds].sort(),
    },
  };
}

function computeTotals(
  prepared: readonly PreparedCommit[],
  entries: readonly ReportEntry[],
  authorCount: number,
): Totals {
  const files = new Set<string>();
  const byCategory: Record<Category, number> = {
    birth: 0,
    'first-steps': 0,
    'growing-pains': 0,
    'midnight-oil': 0,
    milestone: 0,
    evolution: 0,
  };
  const byType: Partial<Record<CommitType, number>> = {};

  let insertions = 0;
  let deletions = 0;
  let tags = 0;
  let mergeCommits = 0;

  for (const commit of prepared) {
    insertions += commit.insertions;
    deletions += commit.deletions;
    tags += commit.tags.length;
    if (commit.isMerge) mergeCommits += 1;
    for (const file of commit.source.files) files.add(file.path);
    byType[commit.conventional.type] = (byType[commit.conventional.type] ?? 0) + 1;
  }

  for (const entry of entries) {
    byCategory[entry.category] += 1;
  }

  return {
    commits: prepared.length,
    authors: authorCount,
    insertions,
    deletions,
    filesTouched: files.size,
    tags,
    mergeCommits,
    byCategory,
    byType,
  };
}
