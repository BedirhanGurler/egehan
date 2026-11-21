import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { nowIso } from '../../engine/datetime.js';
import { openCapsule, passphrasesMatch, sealCapsule, CapsuleError } from '../../capsule/capsule.js';
import { capsulePath, readCapsuleFile, saveCapsule } from '../../capsule/storage.js';
import { isGitRepository, readRepositoryInfo } from '../../git/repository.js';
import { loadRules } from '../../spec/rules.js';
import { info, success, theme, warn } from '../output.js';
import { passphraseFromEnvironment, promptSecret, PASSPHRASE_ENV } from '../prompt.js';

/**
 * `egehan capsule` — seal a message, or open one.
 *
 * The command spends as much effort on warning the user as on the cryptography, and that is the
 * right balance: the algorithm is not the part people get wrong. Losing the passphrase is, and
 * committing the capsule to a public repository without understanding what that means is.
 */

export interface CapsuleOptions {
  readonly cwd: string;
  readonly message: string | null;
  readonly messageFile: string | null;
  readonly unlockDate: string | null;
  readonly author: string | null;
  readonly hint: string | null;
  readonly file: string | null;
  readonly open: boolean;
  readonly force: boolean;
}

export async function runCapsule(options: CapsuleOptions): Promise<void> {
  const rules = loadRules();
  const root = repositoryRoot(options.cwd);
  const path = capsulePath(root, options.file, rules);

  if (options.open) {
    await openExisting(path, options.cwd);
    return;
  }

  if (existsSync(path) && !options.force) {
    warn(
      `${relative(options.cwd, path) || path} already exists. Pass --force to replace it — the ` +
        'message inside the current one cannot be recovered afterwards.',
    );
    return;
  }

  const message = readMessage(options);
  const unlockDate = options.unlockDate;

  if (unlockDate === null) {
    throw new CapsuleError('An unlock date is required: --unlock-date YYYY-MM-DD.');
  }

  const passphrase = await collectPassphrase(rules.capsule.minPassphraseLength);

  const capsule = sealCapsule(
    {
      message,
      unlockDate,
      passphrase,
      authorLabel: options.author,
      hint: options.hint,
      createdAt: nowIso(),
    },
    rules,
  );

  saveCapsule(path, capsule);

  success(`${relative(options.cwd, path) || path}`);
  info('');
  info(theme.muted('  The capsule is embedded in the chronicle the next time you run `egehan generate`.'));
  info(theme.muted('  Nothing but the passphrase can open it, and nothing can reset the passphrase.'));
  if (options.hint !== null && options.hint !== '') {
    info(theme.warn('  The hint is stored in clear text and travels with the file.'));
  }
  info(theme.muted(`  Capsule files are not tracked by git by default — keep a copy somewhere safe.`));
  info('');
}

async function openExisting(path: string, cwd: string): Promise<void> {
  if (!existsSync(path)) {
    throw new CapsuleError(`There is no capsule at ${relative(cwd, path) || path}.`);
  }

  const rules = loadRules();
  const capsule = readCapsuleFile(path, rules);

  if (capsule.hint !== null && capsule.hint !== undefined && capsule.hint !== '') {
    info(theme.muted(`Hint: ${capsule.hint}`));
  }

  const passphrase = passphraseFromEnvironment() ?? (await promptSecret('Passphrase: '));
  const message = openCapsule(capsule, passphrase, rules);

  info('');
  info(message);
  info('');
}

async function collectPassphrase(minimum: number): Promise<string> {
  const fromEnvironment = passphraseFromEnvironment();
  if (fromEnvironment !== null) {
    warn(`Using the passphrase from ${PASSPHRASE_ENV}. Every child process inherits that variable.`);
    return fromEnvironment;
  }

  info('');
  info(theme.muted(`  At least ${minimum} characters. There is no way to recover or reset it.`));

  const first = await promptSecret('  Passphrase: ');
  const second = await promptSecret('  Again: ');

  if (!passphrasesMatch(first, second)) {
    throw new CapsuleError('The two passphrases are not the same. Nothing was written.');
  }

  return first;
}

function readMessage(options: CapsuleOptions): string {
  if (options.messageFile !== null) {
    const path = resolve(options.cwd, options.messageFile);
    if (!existsSync(path)) {
      throw new CapsuleError(`There is no file at ${options.messageFile}.`);
    }
    return readFileSync(path, 'utf8');
  }

  if (options.message !== null) return options.message;

  throw new CapsuleError('There is no message: pass --message "…" or --message-file <path>.');
}

function repositoryRoot(cwd: string): string {
  const context = { cwd, rules: loadRules() };
  return isGitRepository(context) ? readRepositoryInfo(context).root : resolve(cwd);
}
