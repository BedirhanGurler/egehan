import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { git, tryGit, type GitContext } from '../git/runGit.js';
import { hasBlock, hookBlock, isEmptyScript, withBlock, withoutBlock, SHEBANG } from './block.js';

/**
 * Deciding *where* a hook goes, and putting it there without breaking what is already set up.
 *
 * Most repositories that would want Egehan already run something on commit. Taking over
 * `.git/hooks` is the one behaviour guaranteed to make a maintainer uninstall the tool, so this
 * module's job is mostly deference: find out who owns the hooks, and either fit in alongside them
 * or step back and say what to add by hand.
 */

export type HookName = 'post-commit' | 'post-merge';
export const MANAGED_HOOKS: readonly HookName[] = ['post-commit', 'post-merge'];

export type HookOwner = 'git' | 'husky' | 'lefthook';

export interface HookTarget {
  readonly owner: HookOwner;
  /** Absolute directory the hook files go in. Empty when another tool owns them. */
  readonly directory: string;
  /** The value of core.hooksPath, when the repository sets one. */
  readonly configuredHooksPath: string | null;
  readonly explanation: string;
}

export type HookAction = 'created' | 'updated' | 'unchanged' | 'removed' | 'absent' | 'skipped';

export interface HookWriteResult {
  readonly hook: HookName;
  readonly path: string;
  readonly action: HookAction;
}

export interface HookStatus {
  readonly hook: HookName;
  readonly path: string;
  readonly installed: boolean;
  readonly exists: boolean;
  /** True when the file holds something besides Egehan's block. */
  readonly sharedWithOtherHooks: boolean;
}

const LEFTHOOK_CONFIGS = [
  'lefthook.yml',
  'lefthook.yaml',
  '.lefthook.yml',
  '.lefthook.yaml',
  'lefthook.toml',
  'lefthook.json',
];

/**
 * Works out which directory git will actually read hooks from, and who is in charge of it.
 *
 * `core.hooksPath` has to be honoured or the hook is written somewhere git never looks — which
 * fails silently, the worst way for this to fail.
 */
export function resolveHookTarget(context: GitContext, root: string): HookTarget {
  const configured = tryGit(context, 'config', '--get', 'core.hooksPath');
  const configuredHooksPath = configured.exitCode === 0 ? configured.stdout.trim() || null : null;

  if (existsSync(join(root, '.husky'))) {
    // Husky v8 points core.hooksPath at `.husky`, v9 at `.husky/_` where it regenerates shims that
    // call `.husky/<hook>`. In both versions `.husky/<hook>` is the file a human is meant to own,
    // so that is where this belongs — and it survives `husky install`.
    return {
      owner: 'husky',
      directory: join(root, '.husky'),
      configuredHooksPath,
      explanation: 'Husky manages this repository, so the hook goes in .husky/ beside your own.',
    };
  }

  if (detectsLefthook(root, configuredHooksPath)) {
    // Lefthook regenerates the files in the hooks directory on every `lefthook install`, so
    // anything appended there disappears without warning. Telling the user what to add to
    // lefthook.yml is the honest answer; quietly writing a file that will vanish is not.
    return {
      owner: 'lefthook',
      directory: '',
      configuredHooksPath,
      explanation: 'Lefthook manages this repository and rewrites its hook files on every install.',
    };
  }

  // `--absolute-git-dir`, never `--git-dir`: run from the repository root the latter answers the
  // relative ".git", and resolving that against the *process* working directory installs the hook
  // into whichever repository the tool itself happens to be running from. A test caught exactly
  // that, which is the kind of bug that would otherwise land in somebody else's repository.
  const directory =
    configuredHooksPath === null
      ? join(git(context, 'rev-parse', '--absolute-git-dir').trim(), 'hooks')
      : isAbsolute(configuredHooksPath)
        ? configuredHooksPath
        : resolve(root, configuredHooksPath);

  return {
    owner: 'git',
    directory,
    configuredHooksPath,
    explanation:
      configuredHooksPath === null
        ? 'Hooks live in the repository’s own hooks directory.'
        : `This repository sets core.hooksPath to "${configuredHooksPath}".`,
  };
}

function detectsLefthook(root: string, configuredHooksPath: string | null): boolean {
  if (LEFTHOOK_CONFIGS.some((name) => existsSync(join(root, name)))) return true;
  if (configuredHooksPath !== null && configuredHooksPath.includes('lefthook')) return true;

  // A hook file lefthook generated carries its own banner.
  return MANAGED_HOOKS.some((hook) => {
    const path = join(root, '.git', 'hooks', hook);
    return existsSync(path) && readFileSync(path, 'utf8').includes('LEFTHOOK');
  });
}

/** The lefthook configuration a user should add by hand. */
export function lefthookSnippet(): string {
  return [
    'post-commit:',
    '  commands:',
    '    egehan:',
    '      run: egehan generate --quiet',
    '',
    'post-merge:',
    '  commands:',
    '    egehan:',
    '      run: egehan generate --quiet',
  ].join('\n');
}

export function installHooks(target: HookTarget, version: string): HookWriteResult[] {
  if (target.owner === 'lefthook') {
    return MANAGED_HOOKS.map((hook) => ({ hook, path: '', action: 'skipped' as const }));
  }

  mkdirSync(target.directory, { recursive: true });

  return MANAGED_HOOKS.map((hook) => {
    const path = join(target.directory, hook);
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const updated = withBlock(existing, hookBlock(hook, version));

    if (existing === updated) {
      makeExecutable(path);
      return { hook, path, action: 'unchanged' as const };
    }

    writeFileSync(path, updated, 'utf8');
    makeExecutable(path);

    return { hook, path, action: existing === '' ? ('created' as const) : ('updated' as const) };
  });
}

export function uninstallHooks(target: HookTarget): HookWriteResult[] {
  if (target.owner === 'lefthook') {
    return MANAGED_HOOKS.map((hook) => ({ hook, path: '', action: 'skipped' as const }));
  }

  return MANAGED_HOOKS.map((hook) => {
    const path = join(target.directory, hook);
    if (!existsSync(path)) return { hook, path, action: 'absent' as const };

    const existing = readFileSync(path, 'utf8');
    if (!hasBlock(existing)) return { hook, path, action: 'absent' as const };

    const remaining = withoutBlock(existing);

    // Only delete a file that has nothing of anyone else's left in it. A hook that still runs
    // somebody's linter must survive uninstalling this one.
    if (remaining === '' || isEmptyScript(remaining)) {
      rmSync(path, { force: true });
      return { hook, path, action: 'removed' as const };
    }

    writeFileSync(path, remaining.startsWith('#!') ? remaining : `${SHEBANG}\n${remaining}`, 'utf8');
    return { hook, path, action: 'updated' as const };
  });
}

export function readHookStatus(target: HookTarget): HookStatus[] {
  return MANAGED_HOOKS.map((hook) => {
    const path = target.owner === 'lefthook' ? '' : join(target.directory, hook);
    const exists = path !== '' && existsSync(path);
    const content = exists ? readFileSync(path, 'utf8') : '';

    return {
      hook,
      path,
      exists,
      installed: hasBlock(content),
      sharedWithOtherHooks: hasBlock(content) && !isEmptyScript(withoutBlock(content)),
    };
  });
}

function makeExecutable(path: string): void {
  try {
    // Windows has no execute bit and git runs hooks there regardless, so a failure here is not
    // worth failing the install over.
    const mode = statSync(path).mode;
    chmodSync(path, mode | 0o111);
  } catch {
    /* ignore */
  }
}
