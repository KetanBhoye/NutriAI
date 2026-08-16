import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashSha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomToken(size = 32): string {
  return randomBytes(size).toString('hex');
}

export function createPasswordHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expected] = storedHash.split(':');

  if (!salt || !expected) {
    return false;
  }

  const derived = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');

  if (derived.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(derived, expectedBuffer);
}

export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const digest = createHash('sha256').update(codeVerifier).digest('base64url');
  return digest === codeChallenge;
}
