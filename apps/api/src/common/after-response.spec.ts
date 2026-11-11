import { afterResponse } from './after-response.js';

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');
type Holder = Record<symbol, unknown>;

describe('afterResponse', () => {
  afterEach(() => {
    delete (globalThis as Holder)[REQUEST_CONTEXT];
  });

  it("on Vercel, hands the work to the platform's waitUntil so the function stays up until it finishes", () => {
    const waitUntil = vi.fn();
    (globalThis as Holder)[REQUEST_CONTEXT] = { get: () => ({ waitUntil }) };
    const work = Promise.resolve();
    afterResponse(work);
    expect(waitUntil).toHaveBeenCalledWith(work);
  });

  it('elsewhere (a long-running server, tests) just lets the work run', () => {
    expect(() => afterResponse(Promise.resolve())).not.toThrow();
    (globalThis as Holder)[REQUEST_CONTEXT] = { get: () => undefined };
    expect(() => afterResponse(Promise.resolve())).not.toThrow();
  });
});
