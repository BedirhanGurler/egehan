import type { EgehanConfig, EgehanReport, Dictionary, SealedCapsule } from 'egehan';
import type { EgehanSettings } from './settings.js';
import { overridesFrom } from './settings.js';

/**
 * The bridge to the `egehan` package.
 *
 * The extension uses the library rather than spawning the CLI. A status bar that started a
 * process on every refresh would be unusable, and one that re-implemented the pipeline would
 * eventually disagree with the file the hook writes — which is the one thing the whole
 * architecture is arranged to prevent.
 *
 * The import is dynamic because the extension host loads CommonJS and `egehan` is ESM.
 */

export interface EgehanApi {
  produceReport: (options: { cwd: string; overrides?: Record<string, unknown> }) => {
    report: EgehanReport;
    config: EgehanConfig;
    repositoryRoot: string;
  };
  renderHtml: (report: EgehanReport, dictionary: Dictionary) => string;
  renderMarkdown: (report: EgehanReport, dictionary: Dictionary) => string;
  loadDictionary: (language: string) => Dictionary;
  setAssetRoot: (directory: string) => void;
  resolveHookTarget: (context: { cwd: string; rules: unknown }, root: string) => unknown;
  loadRules: () => unknown;
}

let api: Promise<EgehanApi> | null = null;

/**
 * Loads the library once, pointing it at the assets bundled inside the VSIX.
 *
 * `setAssetRoot` rather than the `EGEHAN_SPEC_DIR` environment variable: the extension host is
 * shared with every other extension, and changing its environment to configure a library of ours
 * is not a side effect to inflict on them.
 */
export async function loadEgehan(assetsDirectory: string): Promise<EgehanApi> {
  api ??= import('egehan').then((module) => {
    const loaded = module as unknown as EgehanApi;
    loaded.setAssetRoot(assetsDirectory);
    return loaded;
  });
  return api;
}

export interface Chronicle {
  readonly report: EgehanReport;
  readonly dictionary: Dictionary;
  readonly repositoryRoot: string;
  readonly capsule: SealedCapsule | null;
}

export async function buildChronicle(
  assetsDirectory: string,
  cwd: string,
  settings: EgehanSettings,
): Promise<Chronicle> {
  const egehan = await loadEgehan(assetsDirectory);
  const { report, repositoryRoot } = egehan.produceReport({
    cwd,
    overrides: overridesFrom(settings),
  });

  return {
    report,
    dictionary: egehan.loadDictionary(report.config.language),
    repositoryRoot,
    capsule: report.capsule,
  };
}
