import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const prismaDir = join(import.meta.dirname, '..', '..', 'prisma');

describe('timestamps (#6)', () => {
  it('every DateTime column in schema.prisma is timestamptz or a calendar date', () => {
    const schema = readFileSync(join(prismaDir, 'schema.prisma'), 'utf8');
    const bare = schema
      .split('\n')
      .filter((line) => /^\s+\w+\s+DateTime\??(\s|$)/.test(line))
      .filter((line) => !/@db\.(Timestamptz\(3\)|Date)(?![\w(])/.test(line))
      .map((line) => line.trim());
    expect(bare).toEqual([]);
  });

  it('migrations convert timestamps explicitly as UTC, never with a bare SET DATA TYPE', () => {
    const offenders: string[] = [];
    for (const dir of readdirSync(join(prismaDir, 'migrations'))) {
      // Older migrations predate the rule and have already run everywhere.
      if (!/^\d{14}_/.test(dir) || dir < '20261012050000') continue;
      const sql = readFileSync(
        join(prismaDir, 'migrations', dir, 'migration.sql'),
        'utf8',
      );
      for (const m of sql.matchAll(
        /ALTER COLUMN "(\w+)" (?:SET DATA )?TYPE TIMESTAMPTZ[^,;]*/gi,
      )) {
        if (!new RegExp(`USING "${m[1]}" AT TIME ZONE 'UTC'`).test(m[0]))
          offenders.push(`${dir}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
