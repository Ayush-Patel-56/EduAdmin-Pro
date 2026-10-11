// Development-only seed data. Kept separate from the CLI entry point
// (seed-dev.ts) so the production guard can be unit-tested.
import type { PrismaClient } from '../src/generated/prisma/client.js';

export const DEV_ADMIN_CODE = 'ADMIN123';

/**
 * Runs only when NODE_ENV is explicitly "development" or "test". Refuses
 * "production", and also an unset NODE_ENV: a laptop whose .env points at the
 * production database usually has no NODE_ENV at all.
 */
export function assertDevEnvironment(env: NodeJS.ProcessEnv): void {
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === 'production') {
    throw new Error(
      'Refusing to seed: NODE_ENV=production. ADMIN123 is a public code and must never work in production; issue a private code with `pnpm --filter api invite:create` instead.',
    );
  }
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error(
      `Refusing to seed: NODE_ENV is ${nodeEnv ? `"${nodeEnv}"` : 'not set'}. Run it as NODE_ENV=development pnpm --filter api seed:dev, against a development database only.`,
    );
  }
}

/** Creates ADMIN123 (unlimited, no expiry), or re-enables it after the revoke migration. */
export async function seedDevAdminCode(
  prisma: Pick<PrismaClient, 'adminInviteCode'>,
) {
  return prisma.adminInviteCode.upsert({
    where: { code: DEV_ADMIN_CODE },
    create: {
      code: DEV_ADMIN_CODE,
      note: 'Development admin signup code (seed:dev)',
    },
    update: {
      note: 'Development admin signup code (seed:dev)',
      maxUses: null,
      expiresAt: null,
      revokedAt: null,
    },
  });
}
