import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/**
 * Reading a passphrase.
 *
 * There is deliberately **no `--passphrase` flag**. A secret passed on the command line lands in
 * the shell's history file and is visible to every other process on the machine through the
 * process list — for a passphrase that is meant to hold for eighteen years, that is not a trade
 * worth making for a few saved keystrokes.
 *
 * `EGEHAN_PASSPHRASE` exists for automation. It is better than a flag and still worse than
 * typing: an environment variable is inherited by every child process. The CLI says so when it
 * uses one.
 */

export const PASSPHRASE_ENV = 'EGEHAN_PASSPHRASE';

export class PromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptError';
  }
}

export function passphraseFromEnvironment(): string | null {
  const value = process.env[PASSPHRASE_ENV];
  return value === undefined || value === '' ? null : value;
}

/** Asks a question with the typed characters hidden. */
export async function promptSecret(question: string): Promise<string> {
  if (stdin.isTTY !== true) {
    throw new PromptError(
      `A passphrase is needed, but this is not an interactive terminal. Set ${PASSPHRASE_ENV} ` +
        'to supply one without a prompt.',
    );
  }

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });

  // readline writes every keystroke back to the terminal; this intercepts that so the passphrase
  // never appears on screen or in a scrollback buffer.
  const muteable = rl as unknown as { _writeToOutput?: (text: string) => void };
  let muted = false;
  muteable._writeToOutput = (text: string): void => {
    if (!muted) stdout.write(text);
  };

  try {
    const answer = rl.question(question);
    muted = true;
    const value = await answer;
    stdout.write('\n');
    return value;
  } finally {
    muted = false;
    rl.close();
  }
}

export async function promptText(question: string, fallback = ''): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(question)).trim();
    return answer === '' ? fallback : answer;
  } finally {
    rl.close();
  }
}
