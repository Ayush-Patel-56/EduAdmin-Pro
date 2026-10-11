import { Prisma, type AuditAction } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/** Who made a change and from where, taken from the authenticated request. */
export type Actor = {
  userId: string;
  name: string;
  ip: string | null;
  userAgent: string | null;
};

type Plain = string | number | boolean | null;

function plain(value: unknown): Plain {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value as Plain;
}

/** An actor from the database, for changes made outside the recruitment controller. */
export async function actorFromUser(tx: Tx, userId: string): Promise<Actor> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { fullName: true },
  });
  return { userId, name: user.fullName, ip: null, userAgent: null };
}

/** The given fields of a row, as JSON-safe values, for create/delete snapshots. */
export function snapshot<T extends object>(row: T, fields: (keyof T)[]) {
  return Object.fromEntries(fields.map((f) => [f, plain(row[f])])) as Record<
    string,
    Plain
  >;
}

/** { field: [before, after] } for every listed field whose value changed. */
export function diff<T extends object>(
  before: T,
  after: T,
  fields: (keyof T)[],
) {
  const changes: Record<string, [Plain, Plain]> = {};
  for (const f of fields) {
    const a = plain(before[f]);
    const b = plain(after[f]);
    if (a !== b) changes[f as string] = [a, b];
  }
  return changes;
}

/**
 * Appends one audit row inside the caller's transaction, so the change and its
 * record commit (or roll back) together. The table rejects updates and deletes.
 */
export async function writeAudit(
  tx: Tx,
  actor: Actor,
  entry: {
    schoolId: string;
    action: AuditAction;
    entity: string;
    recordId: string;
    summary: string;
    changes?: Record<string, unknown>;
  },
) {
  await tx.recruitmentAuditLog.create({
    data: {
      ...entry,
      changes: (entry.changes ?? undefined) as
        Prisma.InputJsonValue | undefined,
      actorId: actor.userId,
      actorName: actor.name,
      ip: actor.ip,
      userAgent: actor.userAgent?.slice(0, 300) ?? null,
    },
  });
}
