/**
 * The TypeScript mirror of `core-spec/schema/egehan-report.schema.json`.
 *
 * These types are a convenience for this engine, not the specification — the schema is. They can
 * drift from it, which is why CI validates every generated report against the schema itself
 * (docs/ARCHITECTURE.md, ADR-001). When the two disagree, the schema wins.
 */

export type Language = 'tr' | 'en';
export type Tone = 'poetic' | 'minimalist' | 'humorous';

export type Category = 'birth' | 'first-steps' | 'growing-pains' | 'midnight-oil' | 'milestone' | 'evolution';

export type CommitType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'perf'
  | 'test'
  | 'build'
  | 'ci'
  | 'chore'
  | 'revert'
  | 'merge'
  | 'unknown';

export type ProjectFlavor = 'frontend' | 'mobile' | 'backend' | 'systems' | 'library';

export type Chronotype =
  | 'night-owl'
  | 'early-architect'
  | 'daylight-builder'
  | 'evening-craftsman'
  | 'balanced-rhythm';

export type SizeBucket = 'touch' | 'small' | 'medium' | 'large' | 'epic';

export type MilestoneKind =
  | 'first-commit'
  | 'commit-count'
  | 'release-tag'
  | 'anniversary'
  | 'streak'
  | 'midnight-fix'
  | 'architectural-leap';

/* ------------------------------------------------------------------ *
 * Input: what the git-reading layer hands to the engine.
 *
 * This interface is the documented boundary of the system. Everything above it is
 * platform-specific plumbing; everything below it must behave identically in every runtime, and
 * the conformance fixtures in core-spec are expressed in exactly this shape.
 * ------------------------------------------------------------------ */

export interface ChangedFile {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
}

export interface NormalizedCommit {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly authorName: string;
  readonly authorEmail: string;
  /** ISO-8601 with the commit's own UTC offset preserved. The offset is load-bearing. */
  readonly authoredAt: string;
  readonly committedAt: string;
  readonly subject: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly files: readonly ChangedFile[];
}

/* ------------------------------------------------------------------ *
 * Output: the report.
 * ------------------------------------------------------------------ */

export interface GeneratorInfo {
  readonly name: 'egehan';
  readonly version: string;
  readonly platform: 'node' | 'dotnet';
  readonly specVersion: string;
  readonly dictionaryVersion: string;
  /** The only field allowed to depend on wall-clock time. */
  readonly generatedAt: string;
}

export interface ProjectInfo {
  readonly name: string;
  readonly dedication: string | null;
  readonly detectedTypes: readonly string[];
  readonly flavor: ProjectFlavor;
  readonly defaultBranch: string | null;
  readonly remoteHost: string | null;
}

export interface ReportConfig {
  readonly language: Language;
  readonly tone: Tone;
  readonly redactEmails: boolean;
  readonly anonymizeAuthors: boolean;
  readonly includeMergeCommits: boolean;
  readonly theme: 'auto' | 'light' | 'dark';
}

export interface RangeInfo {
  readonly since: string | null;
  readonly until: string | null;
  readonly firstCommitAt: string;
  readonly lastCommitAt: string;
  readonly days: number;
  readonly truncated: boolean;
}

export interface Totals {
  readonly commits: number;
  readonly authors: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly filesTouched: number;
  readonly tags: number;
  readonly mergeCommits: number;
  readonly byCategory: Readonly<Record<Category, number>>;
  readonly byType: Readonly<Partial<Record<CommitType, number>>>;
}

export interface AuthorSummary {
  readonly id: string;
  readonly displayName: string;
  readonly emailHash: string | null;
  readonly email: string | null;
  readonly commits: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly firstCommitAt: string;
  readonly lastCommitAt: string;
}

export interface ConventionalInfo {
  readonly type: CommitType;
  readonly scope: string | null;
  readonly breaking: boolean;
  /** True when the type came from keyword fallback rather than an explicit prefix. */
  readonly inferred: boolean;
}

export interface EntryStats {
  readonly filesCount: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly sizeBucket: SizeBucket;
}

export interface ReportEntry {
  readonly sha: string;
  readonly shortSha: string;
  readonly parents: readonly string[];
  readonly authorId: string;
  readonly authoredAt: string;
  readonly committedAt: string;
  readonly tzOffsetMinutes: number;
  readonly localHour: number;
  /** 0 = Monday, per rules.json → time.weekStartsOn. */
  readonly localWeekday: number;
  readonly subject: string;
  readonly cleanSubject: string;
  readonly conventional: ConventionalInfo;
  readonly tags: readonly string[];
  readonly stats: EntryStats;
  readonly category: Category;
  readonly secondaryCategories: readonly Category[];
  readonly narrative: string;
  readonly isMerge: boolean;
  readonly variantIndex: number;
}

export interface ChapterStats {
  readonly commits: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly filesCount: number;
  readonly authorIds: readonly string[];
}

export interface ReportChapter {
  readonly id: string;
  readonly category: Category;
  readonly title: string;
  readonly narrative: string;
  readonly from: string;
  readonly to: string;
  readonly entryShas: readonly string[];
  readonly stats: ChapterStats;
}

export interface Streak {
  readonly days: number;
  readonly from: string | null;
  readonly to: string | null;
}

export interface MonthlyActivity {
  readonly month: string;
  readonly commits: number;
  readonly insertions: number;
  readonly deletions: number;
}

export interface Pulse {
  readonly chronotype: Chronotype;
  readonly chronotypeLabel: string;
  readonly hourHistogram: readonly number[];
  readonly weekdayHistogram: readonly number[];
  readonly busiestHour: number;
  readonly busiestWeekday: number;
  readonly creationRatio: number;
  readonly avgChangedLines: number;
  readonly medianChangedLines: number;
  readonly longestStreak: Streak;
  readonly currentStreak: Streak;
  readonly monthlyActivity: readonly MonthlyActivity[];
  readonly narrative: string;
}

export interface Milestone {
  readonly kind: MilestoneKind;
  readonly at: string;
  readonly label: string;
  readonly value: number | string | null;
  readonly sha: string | null;
  readonly narrative: string;
}

export interface SealedCapsule {
  readonly mode: 'sealed';
  readonly unlockDate: string;
  readonly authorLabel: string | null;
  readonly hint: string | null;
  readonly algorithm: {
    readonly kdf: 'PBKDF2';
    readonly kdfHash: 'SHA-256';
    readonly iterations: number;
    readonly cipher: 'AES-256-GCM';
  };
  readonly salt: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly createdAt: string;
}

export interface EgehanReport {
  readonly schemaVersion: string;
  readonly generator: GeneratorInfo;
  readonly project: ProjectInfo;
  readonly config: ReportConfig;
  readonly range: RangeInfo;
  readonly totals: Totals;
  readonly authors: readonly AuthorSummary[];
  readonly chapters: readonly ReportChapter[];
  readonly entries: readonly ReportEntry[];
  readonly pulse: Pulse;
  readonly milestones: readonly Milestone[];
  readonly capsule: SealedCapsule | null;
}
