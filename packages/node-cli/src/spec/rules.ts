import { readAssetJson } from './assets.js';

/**
 * The typed view of `core-spec/spec/rules.json` — the engine contract.
 *
 * Nothing in this engine may hard-code a threshold that lives here. A magic number in engine code
 * is a number the .NET port cannot see, and the moment the two disagree the whole correctness
 * claim of the project collapses (docs/ARCHITECTURE.md, ADR-001).
 */

export interface DeterminismRules {
  readonly hashPrefixLength: number;
  readonly hashRadix: number;
  readonly selectionFormula: string;
}

export interface GitRules {
  readonly mandatoryFlags: readonly string[];
  readonly recordSeparator: string;
  readonly fieldSeparator: string;
  readonly logFields: readonly string[];
  readonly tagSource: string;
  readonly commitOrdering: readonly string[];
  readonly maxSubjectLength: number;
}

export interface TimeRules {
  readonly mode: string;
  readonly weekStartsOn: number;
}

export interface SubjectCleanupRules {
  readonly stripPrefixPattern: string;
  readonly stripTicketPattern: string;
  readonly stripTrailingPeriod: boolean;
  readonly collapseWhitespace: boolean;
  readonly capitalizeFirstLetter: boolean;
  /** `report-language`: the first letter is upper-cased with the report's language tag. */
  readonly capitalizationLocale: string;
  readonly maxLength: number;
  readonly ellipsis: string;
}

export interface ConventionalRules {
  readonly pattern: string;
  readonly revertPattern: string;
  readonly mergePattern: string;
  readonly typeAliases: Readonly<Record<string, string>>;
  readonly keywordFallback: Readonly<Record<string, readonly string[]>>;
  /** Explicit evaluation order: object key order is not portable across runtimes. */
  readonly keywordFallbackOrder: readonly string[];
  readonly subjectCleanup: SubjectCleanupRules;
}

export interface CategoryRules {
  readonly description: string;
  readonly firstCommitAlwaysMatches?: boolean;
  readonly setupWindowHours?: number;
  readonly setupWindowAppliesToTypes?: readonly string[];
  readonly requiresNoReleaseTagBefore?: boolean;
  readonly types?: readonly string[];
  readonly clusterWindowHours?: number;
  readonly minFixCommitsInCluster?: number;
  readonly clusterFixTypes?: readonly string[];
  readonly refactorDeletionRatio?: number;
  readonly refactorMinChangedLines?: number;
  readonly localHourFrom?: number;
  readonly localHourTo?: number;
  readonly tagPattern?: string;
  readonly largeInsertionThreshold?: number;
  readonly breakingChangeMatches?: boolean;
  readonly isFallback?: boolean;
}

export interface NarrativeRules {
  readonly capitalizeFirstLetter: boolean;
  /** `report-language`: capitalization uses the report's language tag, never the host locale. */
  readonly capitalizationLocale: string;
  readonly skipWhenFirstCharIsNotALetter: boolean;
}

export interface ClassificationRules {
  readonly evaluationOrder: readonly string[];
  readonly categories: Readonly<Record<string, CategoryRules>>;
  readonly modifierCategories: readonly string[];
  readonly maxModifiersPerEntry: number;
}

export interface ChapterRules {
  readonly groupBy: string;
  readonly maxEntriesPerChapter: number;
  readonly maxGapHoursWithinChapter: number;
}

export interface ChronotypeRule {
  readonly id: string;
  readonly hours: readonly number[];
  readonly minShare: number;
}

export interface SizeBucketRule {
  readonly id: string;
  readonly maxChangedLines: number | null;
}

export interface PulseRules {
  readonly chronotypes: readonly ChronotypeRule[];
  readonly fallbackChronotype: string;
  readonly creationRatioFormula: string;
  /** Hours of smoothing on each side when locating the busiest hour. */
  readonly peakSmoothingWindow: number;
  readonly streak: {
    readonly unit: string;
    readonly minLengthToReport: number;
    /** `last-commit-in-range`: never the wall clock. */
    readonly anchor: string;
  };
  readonly rounding: {
    readonly ratioDecimals: number;
    readonly averageDecimals: number;
  };
  readonly sizeBuckets: readonly SizeBucketRule[];
}

export interface MilestoneCelebrationRules {
  readonly commitCounts: readonly number[];
  readonly anniversaryDays: readonly number[];
  readonly onReleaseTag: boolean;
  readonly onMidnightFix: boolean;
  readonly midnightFixMilestone: string;
  readonly onStreakDays: readonly number[];
}

export interface ProjectTypeDetector {
  readonly id: string;
  readonly flavor: string;
  readonly priority: number;
  readonly anyFile?: readonly string[];
  readonly anyGlob?: readonly string[];
  readonly allDirs?: readonly string[];
}

export interface ProjectTypeRules {
  readonly detectors: readonly ProjectTypeDetector[];
  readonly fallbackFlavor: string;
  readonly maxDepth: number;
  readonly ignoreDirs: readonly string[];
}

export interface PrivacyRules {
  readonly redactEmailsByDefault: boolean;
  readonly emailHashAlgorithm: string;
  readonly emailHashPrefixLength: number;
  readonly anonymizeAuthorFormat: string;
  readonly anonymizeAuthorFormatEn: string;
  readonly emailPattern: string;
}

export interface CapsuleRules {
  readonly mode: 'sealed';
  readonly kdf: 'PBKDF2';
  readonly kdfHash: 'SHA-256';
  readonly iterations: number;
  readonly derivedKeyBits: number;
  readonly cipher: 'AES-256-GCM';
  readonly saltBytes: number;
  readonly ivBytes: number;
  readonly authTagBits: number;
  readonly encoding: 'base64';
  readonly additionalDataFormat: string;
  readonly minPassphraseLength: number;
  readonly trackedByGitByDefault: boolean;
}

export interface OutputRules {
  /** Rendered artifacts stay byte-stable across runs; only the JSON report records the time. */
  readonly embedGenerationTimeInArtifacts: boolean;
  readonly markdownFileName: string;
  readonly htmlFileName: string;
  readonly reportFileName: string;
  readonly stateDirName: string;
  readonly configFileName: string;
}

export interface LimitRules {
  readonly maxCommitsPerRun: number;
  readonly maxEntriesInHtml: number;
  readonly warnAboveCommits: number;
}

export interface EgehanRules {
  readonly specVersion: string;
  readonly schemaVersion: string;
  readonly determinism: DeterminismRules;
  readonly git: GitRules;
  readonly time: TimeRules;
  readonly conventionalCommits: ConventionalRules;
  readonly narrative: NarrativeRules;
  readonly classification: ClassificationRules;
  readonly chapters: ChapterRules;
  readonly pulse: PulseRules;
  readonly milestoneCelebrations: MilestoneCelebrationRules;
  readonly projectTypes: ProjectTypeRules;
  readonly privacy: PrivacyRules;
  readonly capsule: CapsuleRules;
  readonly output: OutputRules;
  readonly limits: LimitRules;
}

let cached: EgehanRules | null = null;

export function loadRules(): EgehanRules {
  cached ??= readAssetJson<EgehanRules>('spec', 'rules.json');
  return cached;
}

/** Narrows a rules lookup that must succeed, with a message that names the missing key. */
export function requireCategoryRules(rules: EgehanRules, category: string): CategoryRules {
  const found = rules.classification.categories[category];
  if (found === undefined) {
    throw new Error(`spec/rules.json declares no classification rules for category "${category}"`);
  }
  return found;
}
