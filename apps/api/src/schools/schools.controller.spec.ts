import type { ExecutionContext } from '@nestjs/common';
import { hasDurableLimit } from '../rate-limit/hybrid-throttler.storage.js';
import { SchoolsController } from './schools.controller.js';

describe('SchoolsController rate limits', () => {
  // The handler as the throttler sees it, read without calling it as a method.
  const join = Object.getOwnPropertyDescriptor(SchoolsController.prototype, 'join')!.value as () => void;
  const ctx = { getHandler: () => join, getClass: () => SchoolsController } as unknown as ExecutionContext;

  it('POST /schools/join has the durable limit, so invite-code guesses are counted across instances', () => {
    expect(hasDurableLimit(ctx)).toBe(true);
    expect(Reflect.getMetadata('THROTTLER:LIMITdurable', join)).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:TTLdurable', join)).toBe(60_000);
  });

  it('keeps the in-memory limit alongside it', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', join)).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', join)).toBe(60_000);
  });
});
