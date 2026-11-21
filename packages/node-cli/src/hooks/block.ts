import { readFileSync } from 'node:fs';
import { assetPath } from '../spec/assets.js';

/**
 * The text Egehan writes into a git hook, and the surgery for putting it in and taking it out.
 *
 * Kept pure and separate from the filesystem so the one thing that really matters here — that
 * installing and uninstalling leave somebody else's hook exactly as it was — can be tested
 * directly on strings.
 */

export const BEGIN_MARKER = '# >>> egehan >>>';
export const END_MARKER = '# <<< egehan <<<';

export const SHEBANG = '#!/bin/sh';

/**
 * The managed block, read from the shared contract.
 *
 * The script lives in `core-spec/templates/hook.sh` rather than in this file, for the same reason
 * the narrative templates do: it is content both engines install, and a copy in each language is
 * two copies to keep in step (docs/ARCHITECTURE.md, ADR-001). What it says is argued there too —
 * every line of it is a decision about not damaging somebody else's repository.
 */
export function hookBlock(hookName: string, version: string): string {
  const verb = hookName === 'post-merge' ? 'merge' : 'commit';

  return readFileSync(assetPath('templates', 'hook.sh'), 'utf8')
    .replaceAll('{version}', version)
    .replaceAll('{verb}', verb)
    .trimEnd();
}

export function hasBlock(content: string): boolean {
  return content.includes(BEGIN_MARKER) && content.includes(END_MARKER);
}

/** Adds or replaces the managed block, leaving everything outside it untouched. */
export function withBlock(content: string, block: string): string {
  if (content.trim() === '') {
    return `${SHEBANG}\n\n${block}\n`;
  }

  if (hasBlock(content)) {
    const start = content.indexOf(BEGIN_MARKER);
    const end = content.indexOf(END_MARKER) + END_MARKER.length;
    return content.slice(0, start) + block + content.slice(end);
  }

  const body = content.endsWith('\n') ? content : `${content}\n`;
  return `${body}\n${block}\n`;
}

/** Removes the managed block and nothing else. */
export function withoutBlock(content: string): string {
  if (!hasBlock(content)) return content;

  const start = content.indexOf(BEGIN_MARKER);
  const end = content.indexOf(END_MARKER) + END_MARKER.length;

  const before = content.slice(0, start).replace(/\n+$/, '\n');
  const after = content.slice(end).replace(/^\n+/, '');

  const result = `${before}${after}`;
  return result.trim() === '' ? '' : result;
}

/** True when a hook file has nothing left but a shebang and whitespace. */
export function isEmptyScript(content: string): boolean {
  return content
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#!'))
    .every((line) => line.trim().startsWith('#'));
}
