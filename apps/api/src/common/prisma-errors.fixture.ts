import { Prisma } from '../generated/prisma/client.js';

/**
 * P2002 errors exactly as Prisma 7 + @prisma/adapter-pg raise them (captured
 * from a real Postgres): no `meta.target`, the index name is in
 * `meta.driverAdapterError.cause.constraint.index`, and the cause carries an
 * `originalCode` key (which is why "does the meta mention 'code'" is wrong).
 */
export function realUniqueError(index: string, table: string) {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the constraint: \`${index}\``,
    {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta: {
        modelName: table,
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '23505',
            originalMessage: `duplicate key value violates unique constraint "${index}"`,
            kind: 'UniqueConstraintViolation',
            constraint: { index },
            table,
          },
        },
      },
    },
  );
}
