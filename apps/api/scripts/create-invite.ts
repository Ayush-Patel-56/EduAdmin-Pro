// Issue a platform invite code for onboarding a new client school.
// Usage: pnpm --filter api invite:create -- "Note, e.g. client name" [--days 14]
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { generateJoinCode } from '../src/auth/tokens.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { days: { type: 'string' } },
});

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const days = values.days ? Number(values.days) : null;
const invite = await prisma.platformInvite.create({
  data: {
    code: generateJoinCode(3),
    note: positionals.join(' ') || null,
    expiresAt: days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null,
  },
});

console.log(`Invite code: ${invite.code}`);
if (invite.note) console.log(`Note:        ${invite.note}`);
console.log(`Expires:     ${invite.expiresAt?.toISOString() ?? 'never'}`);
await prisma.$disconnect();
