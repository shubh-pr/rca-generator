import fs from 'node:fs';
import path from 'node:path';
import { hash, verify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

/** argon2id with the OWASP-recommended baseline parameters (19 MiB, 2 iterations). */
const ARGON2 = { algorithm: 2 /* Argon2id */, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

export const hashPassword = (plain: string) => hash(plain, ARGON2);

/** Verify argon2id hashes, and legacy bcrypt hashes from the internal-tool era. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    if (stored.startsWith('$2')) return await bcrypt.compare(plain, stored);
    return await verify(stored, plain);
  } catch {
    return false;
  }
}

/** Legacy (bcrypt) hashes are upgraded to argon2id on the next successful login. */
export const needsRehash = (stored: string) => !stored.startsWith('$argon2id$');

// A valid argon2id hash of a random string, used to spend the same time when an account does not exist.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(plain: string) {
  dummyHash ??= hashPassword(`dummy-${Math.random()}`);
  await verifyPassword(plain, await dummyHash);
}

let common: Set<string> | undefined;
function commonPasswords(): Set<string> {
  common ??= new Set(
    fs
      .readFileSync(path.join(import.meta.dirname, 'data/common-passwords.txt'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
  return common;
}

/** Password rules: 10–128 characters, not a common password, not the email address, not one repeated character. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters`;
  const lower = password.toLowerCase();
  if (commonPasswords().has(lower)) return 'This password is too common. Choose a less predictable one';
  if (/^(.)\1+$/.test(password)) return 'This password is too easy to guess';
  if (email) {
    const e = email.toLowerCase();
    if (lower === e || lower === e.split('@')[0]) return 'Do not use your email address as the password';
  }
  return null;
}
