import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { SealedCapsule } from '../engine/types.js';
import type { EgehanRules } from '../spec/rules.js';
import { CapsuleError } from './capsule.js';

/**
 * Where a capsule lives on disk.
 *
 * Separate from the CLI command so the pipeline can pick a capsule up without importing anything
 * from the command layer — `generate` embeds whatever capsule the repository has, and an IDE
 * extension calling `produceReport` must get the same chronicle the CLI would write.
 */

export function capsulePath(root: string, override: string | null, rules: EgehanRules): string {
  if (override === null || override === '') return join(root, rules.output.capsuleFileName);
  return isAbsolute(override) ? override : resolve(root, override);
}

export function saveCapsule(path: string, capsule: SealedCapsule): void {
  writeFileSync(path, `${JSON.stringify(capsule, null, 2)}\n`, 'utf8');
}

export function readCapsuleFile(path: string, rules: EgehanRules): SealedCapsule {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CapsuleError(`The capsule at ${path} could not be read: ${reason}`);
  }

  const capsule = parsed as Partial<SealedCapsule>;

  if (capsule.mode !== 'sealed') {
    throw new CapsuleError(
      `The capsule at ${path} declares mode "${String(capsule.mode)}". Only sealed capsules exist.`,
    );
  }
  if (
    typeof capsule.ciphertext !== 'string' ||
    typeof capsule.salt !== 'string' ||
    typeof capsule.iv !== 'string'
  ) {
    throw new CapsuleError(`The capsule at ${path} is missing its ciphertext.`);
  }
  if (capsule.algorithm?.iterations === undefined || capsule.algorithm.iterations < 1) {
    throw new CapsuleError(`The capsule at ${path} does not say how it was derived.`);
  }
  // Refuse a capsule weakened below the floor rather than opening it and implying it was fine.
  if (capsule.algorithm.iterations < rules.capsule.iterations / 10) {
    throw new CapsuleError(
      `The capsule at ${path} was derived with ${capsule.algorithm.iterations} iterations, far ` +
        `below the ${rules.capsule.iterations} this version requires. Re-create it.`,
    );
  }

  return capsule as SealedCapsule;
}

/** The repository's own capsule, when it has one. */
export function loadCapsule(root: string, rules: EgehanRules): SealedCapsule | null {
  const path = capsulePath(root, null, rules);
  return existsSync(path) ? readCapsuleFile(path, rules) : null;
}
