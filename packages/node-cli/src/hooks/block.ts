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
 * The managed block.
 *
 * Every line of this is a decision about not damaging somebody else's repository:
 *
 * - It never runs a writing git command. A hook that stages or commits its own output fights
 *   interactive rebase, pollutes bisect and can recurse. The developer commits the chronicle when
 *   they choose; the generator is deterministic, so the file only changes when the history does.
 * - It returns 0 on every path. A hook that fails makes `git commit` look broken, and the first
 *   thing anyone does about that is delete the hook.
 * - It exits immediately during rebase, merge, cherry-pick, revert and bisect — regenerating the
 *   chronicle fifty times during one rebase is pure noise.
 * - It detaches and returns, so committing never waits for it.
 * - It does nothing at all when the CLI is not installed, rather than printing an error on a
 *   machine where somebody just cloned the repository.
 */
export function hookBlock(hookName: string, version: string): string {
  return [
    BEGIN_MARKER,
    `# Added by Egehan ${version} — \`egehan hook install\`. Everything between these markers is`,
    '# rewritten on the next install and removed by `egehan hook uninstall`, so edit outside them.',
    '#',
    '# This block never writes to the repository: no `git add`, no `git commit`, no `git stash`.',
    `# It regenerates the chronicle in the background and returns, so \`git ${hookName === 'post-merge' ? 'merge' : 'commit'}\` never waits for it.`,
    'egehan_chronicle() {',
    '  # Guard against recursion and give people a documented way to switch it off for one command.',
    '  if [ -n "$EGEHAN_HOOK" ] || [ -n "$EGEHAN_SKIP_HOOK" ]; then',
    '    return 0',
    '  fi',
    '',
    '  egehan_git_dir=$(git rev-parse --git-dir 2>/dev/null) || return 0',
    '',
    '  # Mid-operation states: a rebase replays many commits, and each one would fire this hook.',
    '  for egehan_state in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do',
    '    if [ -e "$egehan_git_dir/$egehan_state" ]; then',
    '      return 0',
    '    fi',
    '  done',
    '',
    '  egehan_root=$(git rev-parse --show-toplevel 2>/dev/null) || return 0',
    '',
    '  if [ -x "$egehan_root/node_modules/.bin/egehan" ]; then',
    '    egehan_bin="$egehan_root/node_modules/.bin/egehan"',
    '  elif command -v egehan >/dev/null 2>&1; then',
    '    egehan_bin=egehan',
    '  else',
    '    # Not installed on this machine: stay silent rather than nag on every commit.',
    '    return 0',
    '  fi',
    '',
    '  (',
    '    EGEHAN_HOOK=1 "$egehan_bin" generate --quiet >/dev/null 2>&1 </dev/null &',
    '  ) >/dev/null 2>&1',
    '',
    '  return 0',
    '}',
    '',
    'egehan_chronicle',
    END_MARKER,
  ].join('\n');
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
