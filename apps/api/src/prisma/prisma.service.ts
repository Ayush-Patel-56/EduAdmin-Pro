import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Prisma's pg adapter writes DateTime values as UTC wall-clock text without an
 * offset and reads timestamptz values back assuming they are UTC. With
 * timestamptz columns that is only correct when the database session's
 * TimeZone is UTC: in, say, Asia/Kolkata every instant would be stored 5:30
 * early (the app wouldn't notice, but SQL, defaults and exports would). Neon's
 * default is GMT; refuse to start rather than silently store wrong instants.
 */
export async function assertUtcSession(
  prisma: Pick<PrismaClient, '$queryRaw'>,
): Promise<void> {
  const [row] = await prisma.$queryRaw<{ tz: string; offset: number }[]>`
    SELECT current_setting('TimeZone') AS tz,
           extract(timezone FROM now())::int AS "offset"`;
  if (row && row.offset !== 0) {
    throw new Error(
      `The database session TimeZone is "${row.tz}", but the API needs UTC. Run ALTER DATABASE <database> SET timezone TO 'UTC'; (or ALTER ROLE <user> SET timezone TO 'UTC';) and reconnect.`,
    );
  }
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    // Runtime queries go through Neon's pooled connection.
    const adapter = new PrismaPg({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    await assertUtcSession(this);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
