import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { relative } from 'node:path';
import { stdin, stdout } from 'node:process';
import {
  configExists,
  configPath,
  defaultConfig,
  FORMATS,
  serializeConfig,
  TONES,
  type EgehanConfig,
  type OutputFormat,
} from '../../config/config.js';
import { availableLanguages } from '../../spec/dictionary.js';
import { loadRules } from '../../spec/rules.js';
import { isGitRepository, readRepositoryInfo } from '../../git/repository.js';
import { info, success, theme, warn } from '../output.js';
import type { Language, Tone } from '../../engine/types.js';

/**
 * `egehan init` — the setup wizard.
 *
 * Two behaviours worth noting. It never overwrites an existing `.egehanrc.json` without `--force`,
 * because a config file is something a team agreed on and a wizard is not entitled to overrule it.
 * And the dedication prompt makes clear that whatever is typed there will be committed to the
 * repository, since the whole point of the field is that it ends up at the top of a file people
 * share.
 */

export interface InitOptions {
  readonly cwd: string;
  readonly yes: boolean;
  readonly force: boolean;
}

export async function runInit(options: InitOptions): Promise<void> {
  const rules = loadRules();
  const gitContext = { cwd: options.cwd, rules };

  const root = isGitRepository(gitContext) ? readRepositoryInfo(gitContext).root : options.cwd;
  const path = configPath(root, rules);

  if (configExists(root, rules) && !options.force) {
    warn(`${relative(options.cwd, path) || path} already exists. Pass --force to replace it.`);
    return;
  }

  const base = defaultConfig(rules);
  const suggestedName = isGitRepository(gitContext) ? readRepositoryInfo(gitContext).name : null;

  if (options.yes) {
    write(path, { ...base, projectName: suggestedName }, options.cwd);
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    info('');
    info(theme.heading('Egehan'));
    info(theme.muted('A few questions, then your chronicle writes itself after every commit.'));
    info('');

    const projectName = await askText(rl, 'Project name', suggestedName ?? '');
    const language = (await askChoice(rl, 'Language', availableLanguages(), base.language)) as Language;
    const tone = (await askChoice(rl, 'Narrative tone', TONES, base.tone)) as Tone;
    const format = (await askChoice(rl, 'Output', [...FORMATS], base.format)) as OutputFormat;
    const redactEmails = await askYesNo(rl, 'Redact author e-mail addresses', base.redactEmails);

    info('');
    info(theme.muted('A dedication is optional. It is written at the top of the generated files,'));
    info(theme.muted('so treat it as something the repository publishes. Leave blank to skip.'));
    const dedication = await askText(rl, 'Dedication', '');

    write(
      path,
      {
        ...base,
        projectName: projectName === '' ? suggestedName : projectName,
        dedication: dedication === '' ? null : dedication,
        language,
        tone,
        format,
        redactEmails,
      },
      options.cwd,
    );
  } finally {
    rl.close();
  }
}

function write(path: string, config: EgehanConfig, cwd: string): void {
  const existed = existsSync(path);
  writeFileSync(path, serializeConfig(config), 'utf8');

  success(`${existed ? 'Replaced' : 'Created'} ${relative(cwd, path) || path}`);
  info('');
  info(`  ${theme.accent('egehan generate')}      ${theme.muted('write the chronicle')}`);
  info(`  ${theme.accent('egehan stats')}         ${theme.muted('see the Developer Pulse')}`);
  info('');
}

type ReadLine = ReturnType<typeof createInterface>;

async function askText(rl: ReadLine, label: string, fallback: string): Promise<string> {
  const suffix = fallback === '' ? '' : theme.muted(` (${fallback})`);
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer === '' ? fallback : answer;
}

async function askChoice(
  rl: ReadLine,
  label: string,
  choices: readonly string[],
  fallback: string,
): Promise<string> {
  const rendered = choices.map((choice) => (choice === fallback ? theme.accent(choice) : choice)).join(' / ');

  for (;;) {
    const answer = (await rl.question(`${label} [${rendered}]: `)).trim().toLowerCase();
    if (answer === '') return fallback;
    if (choices.includes(answer)) return answer;
    warn(`Pick one of: ${choices.join(', ')}`);
  }
}

async function askYesNo(rl: ReadLine, label: string, fallback: boolean): Promise<boolean> {
  const hint = fallback ? `${theme.accent('Y')}/n` : `y/${theme.accent('N')}`;

  for (;;) {
    const answer = (await rl.question(`${label} [${hint}]: `)).trim().toLowerCase();
    if (answer === '') return fallback;
    if (['y', 'yes'].includes(answer)) return true;
    if (['n', 'no'].includes(answer)) return false;
    warn('Answer y or n.');
  }
}
