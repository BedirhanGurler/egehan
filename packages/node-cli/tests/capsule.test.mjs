import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sealCapsule, openCapsule, passphrasesMatch, CapsuleError } from '../dist/capsule/capsule.js';
import { readCapsuleFile, saveCapsule, capsulePath, loadCapsule } from '../dist/capsule/storage.js';
import { loadRules } from '../dist/spec/rules.js';

const rules = loadRules();
const PASSPHRASE = 'bir-uzun-parola-2044';
const MESSAGE = 'Türkçe karakterler ğüşıöç ĞÜŞİÖÇ ve bir satır sonu\nile birlikte.';

const seal = (overrides = {}) =>
  sealCapsule(
    {
      message: MESSAGE,
      unlockDate: '2044-02-01',
      passphrase: PASSPHRASE,
      authorLabel: null,
      hint: null,
      createdAt: '2026-01-01T00:00:00+03:00',
      ...overrides,
    },
    rules,
  );

test('a sealed capsule opens with its passphrase and nothing else', () => {
  const capsule = seal();

  assert.equal(openCapsule(capsule, PASSPHRASE, rules), MESSAGE);
  assert.throws(() => openCapsule(capsule, PASSPHRASE + 'x', rules), CapsuleError);
  assert.throws(() => openCapsule(capsule, '', rules), CapsuleError);
});

test('the plaintext never appears in the capsule', () => {
  const capsule = seal();
  const serialized = JSON.stringify(capsule);

  assert.equal(serialized.includes('Türkçe'), false);
  assert.equal(serialized.includes('karakterler'), false);
  assert.equal(capsule.mode, 'sealed');
});

test('two capsules of the same message share no bytes', () => {
  // A fresh salt and IV per capsule: identical ciphertext would leak that two letters are the same.
  const first = seal();
  const second = seal();

  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test('editing the unlock date makes the capsule refuse to open', () => {
  // The date is bound in as additional authenticated data. It is not a security control — nothing
  // can be, on a file the reader holds — but an altered countdown announces itself.
  const capsule = seal();
  const tampered = { ...capsule, unlockDate: '2027-01-01' };

  assert.throws(() => openCapsule(tampered, PASSPHRASE, rules), CapsuleError);
});

test('editing the ciphertext makes the capsule refuse to open', () => {
  const capsule = seal();
  const bytes = Buffer.from(capsule.ciphertext, 'base64');
  bytes[0] ^= 0xff;

  assert.throws(
    () => openCapsule({ ...capsule, ciphertext: bytes.toString('base64') }, PASSPHRASE, rules),
    CapsuleError,
  );
});

test('the parameters are the ones the contract fixes', () => {
  const capsule = seal();

  assert.equal(capsule.algorithm.kdf, 'PBKDF2');
  assert.equal(capsule.algorithm.kdfHash, 'SHA-256');
  assert.equal(capsule.algorithm.cipher, 'AES-256-GCM');
  assert.equal(capsule.algorithm.iterations, rules.capsule.iterations);
  assert.equal(Buffer.from(capsule.salt, 'base64').length, rules.capsule.saltBytes);
  assert.equal(Buffer.from(capsule.iv, 'base64').length, rules.capsule.ivBytes);

  // Node hands the authentication tag over separately; it is appended so Web Crypto can read it.
  const overhead = Buffer.from(capsule.ciphertext, 'base64').length - Buffer.byteLength(MESSAGE, 'utf8');
  assert.equal(overhead, rules.capsule.authTagBits / 8);
});

test('a short passphrase is refused, with the reason', () => {
  assert.throws(
    () => seal({ passphrase: 'kısa' }),
    (error) => {
      assert.ok(error instanceof CapsuleError);
      assert.match(error.message, new RegExp(String(rules.capsule.minPassphraseLength)));
      assert.match(error.message, /cannot be reset or recovered/);
      return true;
    },
  );
});

test('an impossible unlock date is refused', () => {
  assert.throws(() => seal({ unlockDate: '2044-02-31' }), /not a date that exists/);
  assert.throws(() => seal({ unlockDate: '01-02-2044' }), /YYYY-MM-DD/);
  assert.throws(() => seal({ message: '   ' }), /no message to seal/);
});

test('passphrase confirmation compares without leaking length through timing', () => {
  assert.equal(passphrasesMatch('aynı-parola', 'aynı-parola'), true);
  assert.equal(passphrasesMatch('aynı-parola', 'başka-parola'), false);
  assert.equal(passphrasesMatch('kısa', 'çok-daha-uzun-bir-parola'), false);
});

/**
 * The interop test this whole design turns on.
 *
 * The capsule is sealed with node:crypto and opened with the Web Crypto API, using exactly the
 * call sequence the HTML template uses. If these two ever disagree, a message somebody sealed is
 * unreadable in the one place it was meant to be read, and no amount of unit testing either side
 * alone would have caught it.
 */
test('a capsule sealed by Node opens through the Web Crypto API', async () => {
  const capsule = seal();
  const encoder = new TextEncoder();
  const toBytes = (base64) => Uint8Array.from(Buffer.from(base64, 'base64'));

  const material = await crypto.subtle.importKey('raw', encoder.encode(PASSPHRASE), 'PBKDF2', false, [
    'deriveKey',
  ]);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toBytes(capsule.salt),
      iterations: capsule.algorithm.iterations,
      hash: capsule.algorithm.kdfHash,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toBytes(capsule.iv),
      additionalData: encoder.encode(
        rules.capsule.additionalDataFormat.replace('{unlockDate}', capsule.unlockDate),
      ),
      tagLength: rules.capsule.authTagBits,
    },
    key,
    toBytes(capsule.ciphertext),
  );

  assert.equal(new TextDecoder().decode(plaintext), MESSAGE);
});

test('Web Crypto rejects the same capsule under a wrong passphrase', async () => {
  const capsule = seal();
  const encoder = new TextEncoder();
  const toBytes = (base64) => Uint8Array.from(Buffer.from(base64, 'base64'));

  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode('yanlis-parola-2044'),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toBytes(capsule.salt),
      iterations: capsule.algorithm.iterations,
      hash: capsule.algorithm.kdfHash,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  await assert.rejects(
    crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toBytes(capsule.iv),
        additionalData: encoder.encode(
          rules.capsule.additionalDataFormat.replace('{unlockDate}', capsule.unlockDate),
        ),
        tagLength: rules.capsule.authTagBits,
      },
      key,
      toBytes(capsule.ciphertext),
    ),
  );
});

/* ------------------------------------------------------------------ *
 * storage
 * ------------------------------------------------------------------ */

test('a capsule round-trips through the filesystem', () => {
  const dir = mkdtempSync(join(tmpdir(), 'egehan-capsule-'));

  try {
    const path = capsulePath(dir, null, rules);
    assert.equal(loadCapsule(dir, rules), null, 'no capsule means no capsule');

    saveCapsule(path, seal());
    const loaded = loadCapsule(dir, rules);

    assert.ok(loaded !== null);
    assert.equal(openCapsule(loaded, PASSPHRASE, rules), MESSAGE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a capsule weakened below the floor is refused rather than quietly opened', () => {
  const dir = mkdtempSync(join(tmpdir(), 'egehan-capsule-'));

  try {
    const path = capsulePath(dir, null, rules);
    const weak = { ...seal(), algorithm: { ...seal().algorithm, iterations: 1000 } };
    writeFileSync(path, JSON.stringify(weak), 'utf8');

    assert.throws(() => readCapsuleFile(path, rules), /far\s+below/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file that is not a sealed capsule is refused by name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'egehan-capsule-'));

  try {
    const path = capsulePath(dir, null, rules);

    writeFileSync(path, '{ not json', 'utf8');
    assert.throws(() => readCapsuleFile(path, rules), /could not be read/);

    writeFileSync(path, JSON.stringify({ mode: 'symbolic' }), 'utf8');
    assert.throws(() => readCapsuleFile(path, rules), /Only sealed capsules exist/);

    writeFileSync(path, JSON.stringify({ mode: 'sealed' }), 'utf8');
    assert.throws(() => readCapsuleFile(path, rules), /missing its ciphertext/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
