// Issue an admin invite code. Anyone signing up with it gets an admin account.
//
// Usage:
//   pnpm --filter api invite:create -- [note] [--code CLIENT-2026] [--max-uses 5] [--days 14]
//
//   --code      custom code (4-32 letters, digits or "-"); random if omitted
//   --max-uses  how many admins can sign up with it; unlimited if omitted
//   --days      expires after this many days; never if omitted
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { generateJoinCode, normalizeCode } from '../src/auth/tokens.js';

const { values, positionals } = parseArgs({
  // pnpm forwards the "--" separator; drop it so the flags after it are parsed.
  args: process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === '--')),
  allowPositionals: true,
  options: {
    code: { type: 'string' },
    'max-uses': { type: 'string' },
    days: { type: 'string' },
  },
});

function positiveInt(raw: string | undefined, flag: string): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`${flag} must be a whole number of 1 or more`);
    process.exit(1);
  }
  return n;
}

const code = values.code ? normalizeCode(values.code) : generateJoinCode(3);
if (!/^[A-Z0-9-]{4,32}$/.test(code)) {
  console.error('--code must be 4-32 letters, digits or "-"');
  process.exit(1);
}
const maxUses = positiveInt(values['max-uses'], '--max-uses');
const days = positiveInt(values.days, '--days');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

try {
  const invite = await prisma.adminInviteCode.create({
    data: {
      code,
      note: positionals.join(' ') || null,
      maxUses,
      expiresAt: days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null,
    },
  });
  console.log(`Admin invite code: ${invite.code}`);
  if (invite.note) console.log(`Note:              ${invite.note}`);
  console.log(`Max uses:          ${invite.maxUses ?? 'unlimited'}`);
  console.log(`Expires:           ${invite.expiresAt?.toISOString() ?? 'never'}`);
} catch (err) {
  if ((err as { code?: string }).code === 'P2002') {
    console.error(`The code ${code} already exists. Choose another.`);
    process.exit(1);
  }
  throw err;
} finally {
  await prisma.$disconnect();
}
