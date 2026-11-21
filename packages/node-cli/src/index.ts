/**
 * The public API of the `egehan` package.
 *
 * The IDE extensions consume this rather than shelling out to the CLI: a VS Code status bar that
 * spawned a process on every keystroke would be unusable, and one that re-implemented the pipeline
 * would eventually tell the user something different from the file on disk.
 */

export { produceReport, NotARepositoryError, NoCommitsError, EmptyHistoryError } from './pipeline.js';
export type { ProduceOptions, ProduceResult } from './pipeline.js';

export { buildReport } from './engine/buildReport.js';
export type { BuildReportInput } from './engine/buildReport.js';

export { renderMarkdown } from './renderers/markdown.js';
export { renderHtml, readTemplate } from './renderers/html.js';

export { loadRules } from './spec/rules.js';
export type { EgehanRules } from './spec/rules.js';
export { loadDictionary, availableLanguages } from './spec/dictionary.js';
export type { Dictionary } from './spec/dictionary.js';
export { assetPath, assetRoot } from './spec/assets.js';

export {
  defaultConfig,
  loadConfig,
  mergeConfig,
  serializeConfig,
  configExists,
  configPath,
  ConfigError,
  TONES,
  FORMATS,
  THEMES,
} from './config/config.js';
export type { EgehanConfig, OutputFormat, ChronicleTheme } from './config/config.js';

export { detectProjectTypes, scanRepository } from './detect/projectType.js';
export { prepareCommits } from './engine/prepare.js';
export { classifyCommits } from './engine/classifier.js';
export { computePulse } from './engine/pulse.js';
export { sealCapsule, openCapsule, CapsuleError } from './capsule/capsule.js';
export { loadCapsule, readCapsuleFile, saveCapsule, capsulePath } from './capsule/storage.js';
export { packageVersion } from './version.js';

export type * from './engine/types.js';
