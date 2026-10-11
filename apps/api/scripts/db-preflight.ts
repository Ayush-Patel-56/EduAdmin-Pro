// Pre-deploy checks. Read-only: runs inside a READ ONLY transaction.
//
//   pnpm --filter api db:preflight   # checks only
//   pnpm --filter api db:deploy      # checks, then prisma migrate deploy
//
// Uses DIRECT_URL (like prisma migrate), falling back to DATABASE_URL.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { runChecks } from './preflight-checks.js';

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Set DIRECT_URL (or DATABASE_URL) first.');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});

try {
  const problems = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return runChecks((sql) => tx.$queryRawUnsafe(sql));
  });
  const host = new URL(url).host;
  if (problems.length === 0) {
    console.log(`Preflight passed on ${host}.`);
  } else {
    console.error(`Preflight FAILED on ${host}; nothing was deployed.\n`);
    for (const { check, rows } of problems) {
      console.error(`✗ ${check.name}`);
      for (const row of rows) console.error(`    ${JSON.stringify(row)}`);
      console.error(`  Fix: ${check.fix}\n`);
    }
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
