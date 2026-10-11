import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

/**
 * The unique index (and/or fields) a P2002 error hit, or null when `err` is
 * not a unique violation.
 *
 * With the pg driver adapter Prisma doesn't fill `meta.target`; the index name
 * is in `meta.driverAdapterError.cause.constraint.index`, e.g.
 * `CurriculumChapter_schoolId_code_key` or `Program_schoolId_lower_name_key`
 * (the constraint may carry `fields` instead). `meta.target` is still read for
 * the non-adapter engine.
 */
export function uniqueViolation(err: unknown): string[] | null {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== 'P2002'
  ) {
    return null;
  }
  const meta = (err.meta ?? {}) as {
    target?: unknown;
    driverAdapterError?: {
      cause?: { constraint?: { index?: unknown; fields?: unknown } };
    };
  };
  const names: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string') names.push(value);
    else if (Array.isArray(value))
      names.push(...value.filter((v): v is string => typeof v === 'string'));
  };
  add(meta.target);
  const constraint = meta.driverAdapterError?.cause?.constraint;
  add(constraint?.index);
  add(constraint?.fields);
  return names;
}

/** True when the violated unique index/fields involve a `code` column. */
export function isCodeClash(names: string[]): boolean {
  return names.some((n) => n === 'code' || n.endsWith('_code_key'));
}

/**
 * Runs a write; a unique-index violation (P2002) becomes a 409 with `message`
 * instead of a 500. The database's unique indexes are the last word on
 * duplicates, e.g. when two requests race past the service's own check.
 */
export async function duplicateAsConflict<T>(
  write: () => Promise<T>,
  message: string | ((names: string[]) => string),
): Promise<T> {
  try {
    return await write();
  } catch (err) {
    const names = uniqueViolation(err);
    if (names) {
      throw new ConflictException(
        typeof message === 'function' ? message(names) : message,
      );
    }
    throw err;
  }
}
