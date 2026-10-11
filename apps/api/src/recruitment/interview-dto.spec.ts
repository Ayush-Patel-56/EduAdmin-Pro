import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InterviewDto } from './recruitment.dto.js';

const errorsFor = async (scheduledAt: string) =>
  validate(
    plainToInstance(InterviewDto, {
      candidateId: '44444444-4444-4444-8444-444444444444',
      scheduledAt,
      mode: 'ONLINE',
      result: 'PENDING',
    }),
  ).then((e) => e.filter((x) => x.property === 'scheduledAt'));

describe('InterviewDto.scheduledAt needs a time zone', () => {
  it.each(['2026-10-20T10:00:00Z', '2026-10-20T15:30:00+05:30', '2026-10-20T10:00:00.000Z'])(
    'accepts %s',
    async (value) => {
      expect(await errorsFor(value)).toHaveLength(0);
    },
  );

  it.each(['2026-10-20T10:00', '2026-10-20T10:00:00', '2026-10-20', 'not a date'])(
    'rejects %s',
    async (value) => {
      expect((await errorsFor(value)).length).toBeGreaterThan(0);
    },
  );
});
