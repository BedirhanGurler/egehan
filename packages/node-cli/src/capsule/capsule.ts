import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { EgehanRules } from '../spec/rules.js';
import type { SealedCapsule } from '../engine/types.js';

/**
 * The sealed time capsule.
 *
 * One mode exists, and the reason is worth stating plainly: the ciphertext is embedded in an HTML
 * file people publish. Anything that file can decrypt on its own, every reader can decrypt too, so
 * a "no passphrase, just a date" capsule would advertise encryption while providing none. The
 * countdown in the timeline is a ritual; the passphrase is the lock (docs/ARCHITECTURE.md, ADR-005).
 *
 * PBKDF2 is not the strongest KDF available in Node — scrypt and Argon2 both resist hardware
 * better. It is chosen because the capsule must also open in a browser, from the generated file,
 * with no dependencies, and Web Crypto offers PBKDF2 and neither of the others. The iteration
 * count in `rules.json` compensates within that constraint.
 *
 * Every parameter comes from the rules file so the .NET engine produces capsules this engine — and
 * the page — can open.
 */

export class CapsuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapsuleError';
  }
}

export interface SealInput {
  readonly message: string;
  /** `YYYY-MM-DD`. Presentational: it drives the countdown, never the decryption. */
  readonly unlockDate: string;
  readonly passphrase: string;
  readonly authorLabel: string | null;
  readonly hint: string | null;
  readonly createdAt: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function sealCapsule(input: SealInput, rules: EgehanRules): SealedCapsule {
  const spec = rules.capsule;

  validateUnlockDate(input.unlockDate);
  validatePassphrase(input.passphrase, spec.minPassphraseLength);

  if (input.message.trim() === '') {
    throw new CapsuleError('There is no message to seal.');
  }

  const salt = randomBytes(spec.saltBytes);
  const iv = randomBytes(spec.ivBytes);
  const key = deriveKey(input.passphrase, salt, rules);

  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: spec.authTagBits / 8 });
  cipher.setAAD(Buffer.from(additionalData(input.unlockDate, rules), 'utf8'));

  const body = Buffer.concat([cipher.update(input.message, 'utf8'), cipher.final()]);
  // Web Crypto expects the authentication tag appended to the ciphertext; Node hands it over
  // separately. Concatenating here is what makes the browser able to open what Node sealed.
  const ciphertext = Buffer.concat([body, cipher.getAuthTag()]);

  return {
    mode: 'sealed',
    unlockDate: input.unlockDate,
    authorLabel: emptyToNull(input.authorLabel),
    hint: emptyToNull(input.hint),
    algorithm: {
      kdf: 'PBKDF2',
      kdfHash: 'SHA-256',
      iterations: spec.iterations,
      cipher: 'AES-256-GCM',
    },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    createdAt: input.createdAt,
  };
}

export function openCapsule(capsule: SealedCapsule, passphrase: string, rules: EgehanRules): string {
  const tagBytes = rules.capsule.authTagBits / 8;
  const raw = Buffer.from(capsule.ciphertext, 'base64');

  if (raw.length <= tagBytes) {
    throw new CapsuleError('This capsule is truncated; there is nothing to decrypt.');
  }

  const key = deriveKey(passphrase, Buffer.from(capsule.salt, 'base64'), rules, capsule.algorithm.iterations);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(capsule.iv, 'base64'), {
    authTagLength: tagBytes,
  });
  decipher.setAAD(Buffer.from(additionalData(capsule.unlockDate, rules), 'utf8'));
  decipher.setAuthTag(raw.subarray(raw.length - tagBytes));

  try {
    return Buffer.concat([
      decipher.update(raw.subarray(0, raw.length - tagBytes)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // A wrong passphrase and a tampered file fail identically here, and saying only "the
    // passphrase is not correct" is both true and the one thing worth telling the reader.
    throw new CapsuleError('That passphrase does not open this capsule.');
  }
}

function deriveKey(passphrase: string, salt: Buffer, rules: EgehanRules, iterations?: number): Buffer {
  return pbkdf2Sync(
    passphrase.normalize('NFC'),
    salt,
    iterations ?? rules.capsule.iterations,
    rules.capsule.derivedKeyBits / 8,
    'sha256',
  );
}

/**
 * The unlock date is bound into the ciphertext as additional authenticated data.
 *
 * It does not make the date a security control — nothing can, on a file the reader holds. What it
 * does is make the date *tamper-evident*: editing the countdown in a published chronicle makes the
 * capsule stop opening, so an altered file announces itself instead of passing as the original.
 */
function additionalData(unlockDate: string, rules: EgehanRules): string {
  return rules.capsule.additionalDataFormat.replace('{unlockDate}', unlockDate);
}

function validateUnlockDate(value: string): void {
  if (!DATE_PATTERN.test(value)) {
    throw new CapsuleError(`The unlock date must look like YYYY-MM-DD, not "${value}".`);
  }
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new CapsuleError(`"${value}" is not a date that exists.`);
  }
}

function validatePassphrase(passphrase: string, minimum: number): void {
  if ([...passphrase].length < minimum) {
    throw new CapsuleError(
      `The passphrase must be at least ${minimum} characters. This is the only thing standing ` +
        'between the message and anyone who opens the file, and it cannot be reset or recovered.',
    );
  }
}

/** Constant-time comparison for the confirmation prompt, so a typo check leaks no timing. */
export function passphrasesMatch(first: string, second: string): boolean {
  const a = Buffer.from(first.normalize('NFC'), 'utf8');
  const b = Buffer.from(second.normalize('NFC'), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function emptyToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}
