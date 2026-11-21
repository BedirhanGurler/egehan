import { relative } from 'node:path';
import {
  installHooks,
  lefthookSnippet,
  readHookStatus,
  resolveHookTarget,
  uninstallHooks,
  type HookTarget,
  type HookWriteResult,
} from '../../hooks/manager.js';
import { isGitRepository, readRepositoryInfo } from '../../git/repository.js';
import { loadRules } from '../../spec/rules.js';
import { NotARepositoryError } from '../../pipeline.js';
import { packageVersion } from '../../version.js';
import { info, success, theme, warn } from '../output.js';

/**
 * `egehan hook <install|uninstall|status>`.
 *
 * The command talks more than it acts, on purpose. Installing a git hook changes what happens
 * every time somebody commits, and the person doing it deserves to be told exactly which file was
 * touched, what the hook will and will not do, and how to undo it.
 */

export type HookAction = 'install' | 'uninstall' | 'status';

export interface HookOptions {
  readonly cwd: string;
  readonly action: HookAction;
}

export function runHook(options: HookOptions): void {
  const rules = loadRules();
  const context = { cwd: options.cwd, rules };

  if (!isGitRepository(context)) throw new NotARepositoryError(options.cwd);

  const root = readRepositoryInfo(context).root;
  const target = resolveHookTarget(context, root);

  switch (options.action) {
    case 'install':
      install(target, options.cwd);
      return;
    case 'uninstall':
      uninstall(target, options.cwd);
      return;
    case 'status':
      status(target, options.cwd);
      return;
    default: {
      const unreachable: never = options.action;
      throw new Error(`Unknown hook action: ${String(unreachable)}`);
    }
  }
}

function install(target: HookTarget, cwd: string): void {
  info('');

  if (target.owner === 'lefthook') {
    warn(target.explanation);
    info('');
    info('  Anything written into the hook files would disappear on the next `lefthook install`.');
    info('  Add this to your lefthook configuration instead:');
    info('');
    for (const line of lefthookSnippet().split('\n')) info(theme.accent(`    ${line}`));
    info('');
    return;
  }

  const results = installHooks(target, packageVersion());
  info(theme.muted(`  ${target.explanation}`));
  report(results, cwd);

  info('');
  info('  From now on the chronicle updates itself after every commit and merge.');
  info(theme.muted('    · It runs in the background, so committing never waits for it.'));
  info(theme.muted('    · It never stages or commits anything — the files are yours to commit.'));
  info(theme.muted('    · It stays out of the way during rebase, merge, cherry-pick and bisect.'));
  info(theme.muted('    · EGEHAN_SKIP_HOOK=1 switches it off for one command.'));
  info(theme.muted('    · `egehan hook uninstall` removes it and leaves your other hooks alone.'));
  info('');
}

function uninstall(target: HookTarget, cwd: string): void {
  info('');

  if (target.owner === 'lefthook') {
    warn('Lefthook manages this repository; remove the egehan entries from its configuration.');
    info('');
    return;
  }

  const results = uninstallHooks(target);
  if (results.every((result) => result.action === 'absent')) {
    info(theme.muted('  Nothing to remove — the hooks were not installed here.'));
    info('');
    return;
  }

  report(results, cwd);
  info('');
}

function status(target: HookTarget, cwd: string): void {
  info('');
  info(theme.muted(`  ${target.explanation}`));

  if (target.owner === 'lefthook') {
    info('');
    info('  Add this to your lefthook configuration to keep the chronicle updating:');
    info('');
    for (const line of lefthookSnippet().split('\n')) info(theme.accent(`    ${line}`));
    info('');
    return;
  }

  info('');
  for (const entry of readHookStatus(target)) {
    const where = relative(cwd, entry.path) || entry.path;
    const mark = entry.installed ? theme.accent('✔') : theme.muted('·');
    const state = entry.installed
      ? entry.sharedWithOtherHooks
        ? 'installed, alongside other hooks'
        : 'installed'
      : entry.exists
        ? 'not installed (the file exists and belongs to something else)'
        : 'not installed';

    info(`  ${mark} ${entry.hook.padEnd(12)} ${theme.muted(state)}`);
    info(`    ${theme.muted(where)}`);
  }
  info('');
}

function report(results: readonly HookWriteResult[], cwd: string): void {
  const words: Record<HookWriteResult['action'], string> = {
    created: 'installed',
    updated: 'updated',
    unchanged: 'already up to date',
    removed: 'removed',
    absent: 'was not installed',
    skipped: 'skipped',
  };

  info('');
  for (const result of results) {
    const where = result.path === '' ? result.hook : relative(cwd, result.path) || result.path;
    if (result.action === 'absent') {
      info(`  ${theme.muted('·')} ${where} ${theme.muted(words[result.action])}`);
    } else {
      success(`${where} ${theme.muted(`— ${words[result.action]}`)}`);
    }
  }
}
