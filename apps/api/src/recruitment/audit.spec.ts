import { Prisma } from '../generated/prisma/client.js';
import { diff, snapshot } from './audit.js';

describe('audit diff', () => {
  const before = {
    name: 'A',
    score: 3,
    when: new Date('2026-01-01T00:00:00Z'),
    avg: new Prisma.Decimal('72.50'),
    note: null as string | null,
  };

  it('lists only changed fields as [before, after]', () => {
    const after = { ...before, score: 4, note: 'Good' };
    expect(diff(before, after, ['name', 'score', 'when', 'avg', 'note'])).toEqual({
      score: [3, 4],
      note: [null, 'Good'],
    });
  });

  it('compares dates and decimals by value', () => {
    const after = { ...before, when: new Date('2026-01-01T00:00:00Z'), avg: new Prisma.Decimal('72.5') };
    expect(diff(before, after, ['when', 'avg'])).toEqual({});
  });

  it('snapshots rows as JSON-safe values', () => {
    expect(snapshot(before, ['when', 'avg', 'note'])).toEqual({
      when: '2026-01-01T00:00:00.000Z',
      avg: '72.5',
      note: null,
    });
  });
});
