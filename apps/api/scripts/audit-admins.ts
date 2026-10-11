// List admin memberships that deserve a second look. READ-ONLY: it changes nothing.
//
// Before the per-school admin code existed, any admin account that entered a
// school's (teacher-shared) invite code became an ADMIN of that school. Nothing
// records which code was used, so the only separable group is "ADMIN members
// who did not create the school". Review those, and revoke any that shouldn't
// have admin rights (see docs/deploy.md for the revoke statement).
//
// Usage:
//   pnpm --filter api admins:audit -- [--before 2026-10-11T00:00:00Z]
//
//   --before  only memberships created before this instant, i.e. before the
//             admin-code change was deployed (older ones are the ones at risk)
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === '--')),
  options: { before: { type: 'string' } },
});

const before = values.before ? new Date(values.before) : null;
if (before && Number.isNaN(before.getTime())) {
  console.error('--before must be a date/time, e.g. 2026-10-11T00:00:00Z');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

try {
  const memberships = await prisma.schoolMembership.findMany({
    where: {
      role: 'ADMIN',
      status: 'ACTIVE',
      ...(before && { createdAt: { lt: before } }),
    },
    orderBy: [{ schoolId: 'asc' }, { createdAt: 'asc' }],
    include: {
      user: { select: { id: true, email: true, fullName: true, accountType: true } },
      school: { select: { id: true, name: true, createdById: true } },
    },
  });

  const review = memberships.filter((m) => m.school.createdById !== m.userId);
  console.log(
    `${memberships.length} active admin membership(s)${before ? ` created before ${before.toISOString()}` : ''}; ` +
      `${review.length} not created by the school's owner:\n`,
  );
  for (const m of review) {
    console.log(
      [
        m.school.name.padEnd(28),
        m.user.email.padEnd(36),
        m.user.fullName.padEnd(22),
        `joined ${m.createdAt.toISOString().slice(0, 10)}`,
        `membership ${m.id}`,
      ].join('  '),
    );
  }
  if (review.length === 0) console.log('Nothing to review.');
} finally {
  await prisma.$disconnect();
}
