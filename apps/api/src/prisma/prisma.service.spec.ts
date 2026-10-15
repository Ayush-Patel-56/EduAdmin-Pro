import { describe, expect, it, vi } from 'vitest';
import { assertUtcSession } from './prisma.service.js';

const db = (tz: string, offset: number) => ({
  $queryRaw: vi.fn().mockResolvedValue([{ tz, offset }]),
});

describe('assertUtcSession', () => {
  it.each([
    ['UTC', 0],
    ['GMT', 0],
    ['Etc/UTC', 0],
  ])('accepts %s', async (tz, offset) => {
    await expect(assertUtcSession(db(tz, offset) as never)).resolves.toBe(
      undefined,
    );
  });

  it('refuses a non-UTC session, which would store every instant shifted', async () => {
    await expect(
      assertUtcSession(db('Asia/Kolkata', 19800) as never),
    ).rejects.toThrow(/Asia\/Kolkata.*SET timezone TO 'UTC'/);
  });
});
