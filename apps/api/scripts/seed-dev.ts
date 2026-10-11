// Development-only seed: enables the public ADMIN123 admin signup code.
//
// Usage (local / Neon dev branch only):
//   NODE_ENV=development pnpm --filter api seed:dev
//
// Refuses to run when NODE_ENV=production or NODE_ENV is unset. In
// production, issue private codes with `pnpm --filter api invite:create`.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { assertDevEnvironment, seedDevAdminCode } from './dev-seed.js';

try {
  assertDevEnvironment(process.env);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});

try {
  const code = await seedDevAdminCode(prisma);
  console.log(
    `Development admin code ${code.code} is active on ${new URL(url).host}.`,
  );
} finally {
  await prisma.$disconnect();
}
