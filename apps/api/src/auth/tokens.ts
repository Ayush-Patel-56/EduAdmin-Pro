import { createHash, randomBytes, randomInt } from 'node:crypto';

// Crockford-style alphabet: no 0/O or 1/I/L, so codes survive being read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Human-friendly join code, e.g. `K7QM-X2PD` (~1e12 combinations). */
export function generateJoinCode(groups = 2, groupLength = 4): string {
  return Array.from({ length: groups }, () =>
    Array.from(
      { length: groupLength },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join(''),
  ).join('-');
}

/** Opaque secret for cookies and email links. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored hashed; a DB leak must not yield usable sessions or links. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}
