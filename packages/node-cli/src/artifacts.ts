import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { Dictionary } from './spec/dictionary.js';
import type { EgehanRules } from './spec/rules.js';
import type { EgehanReport } from './engine/types.js';
import { renderHtml } from './renderers/html.js';
import { renderMarkdown } from './renderers/markdown.js';

/**
 * Writing the chronicle to disk.
 *
 * Shared by the CLI and by the IDE extensions on purpose. The whole project rests on the file a
 * git hook writes and the file an editor command writes being the same file; two copies of this
 * function would be two chances for them to stop being so.
 */

export type ArtifactFormat = 'md' | 'html' | 'json' | 'both' | 'all';

export interface WriteArtifactsOptions {
  readonly report: EgehanReport;
  readonly dictionary: Dictionary;
  readonly rules: EgehanRules;
  readonly outputDirectory: string;
  readonly format: ArtifactFormat;
}

/** Returns the absolute paths written, in a stable order. */
export function writeArtifacts(options: WriteArtifactsOptions): string[] {
  const { report, dictionary, rules, format } = options;

  const directory = isAbsolute(options.outputDirectory)
    ? options.outputDirectory
    : resolve(options.outputDirectory);

  mkdirSync(directory, { recursive: true });

  // `both` is the pair a project keeps; the JSON report is the machine format and stays opt-in.
  const wants = (candidate: 'md' | 'html' | 'json'): boolean =>
    format === candidate || format === 'all' || (format === 'both' && candidate !== 'json');

  const written: string[] = [];

  if (wants('md')) {
    const path = join(directory, rules.output.markdownFileName);
    writeFileSync(path, renderMarkdown(report, dictionary), 'utf8');
    written.push(path);
  }

  if (wants('html')) {
    const path = join(directory, rules.output.htmlFileName);
    writeFileSync(path, renderHtml(report, dictionary, rules), 'utf8');
    written.push(path);
  }

  if (wants('json')) {
    const path = join(directory, rules.output.reportFileName);
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    written.push(path);
  }

  return written;
}
