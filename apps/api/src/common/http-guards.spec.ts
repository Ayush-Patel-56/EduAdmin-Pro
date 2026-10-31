import type { NextFunction, Request, Response } from 'express';
import { noStore, parseOrigins, sameOriginWrites } from './http-guards.js';

const res = () => {
  const r = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      r.statusCode = code;
      return r;
    },
    json(body: unknown) {
      r.body = body;
      return r;
    },
    setHeader(k: string, v: string) {
      r.headers[k.toLowerCase()] = v;
    },
  };
  return r as typeof r & Response;
};
const req = (method: string, headers: Record<string, string> = {}) => ({ method, headers }) as unknown as Request;

describe('parseOrigins', () => {
  it('reduces each entry to its origin, so spacing, case, a default port or a path never cause a mismatch', () => {
    expect(parseOrigins(' https://EduAdmin-Web.vercel.app/ , https://www.example.com:443/app ')).toEqual([
      'https://eduadmin-web.vercel.app',
      'https://www.example.com',
    ]);
    expect(parseOrigins('http://localhost:5173')).toEqual(['http://localhost:5173']);
  });

  it('refuses anything that is not an http(s) address', () => {
    expect(() => parseOrigins('eduadmin-web.vercel.app')).toThrow('WEB_ORIGIN');
    expect(() => parseOrigins('ftp://example.com')).toThrow('WEB_ORIGIN');
    expect(() => parseOrigins(' , ')).toThrow('WEB_ORIGIN');
  });
});

describe('sameOriginWrites', () => {
  const guard = sameOriginWrites(['https://eduadmin-web.vercel.app', 'https://www.example.com']);
  const run = (r: Request) => {
    const response = res();
    const next = vi.fn() as unknown as NextFunction;
    guard(r, response, next);
    return { response, passed: (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length === 1 };
  };

  it('lets reads through from anywhere (links, the cron, health checks)', () => {
    expect(run(req('GET', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).passed).toBe(true);
    expect(run(req('HEAD')).passed).toBe(true);
    expect(run(req('OPTIONS', { origin: 'https://evil.example' })).passed).toBe(true);
  });

  it('lets writes through from the web app (any of its addresses), and from tools that send no browser headers', () => {
    expect(run(req('POST', { origin: 'https://eduadmin-web.vercel.app', 'sec-fetch-site': 'same-origin' })).passed).toBe(true);
    expect(run(req('POST', { origin: 'https://www.example.com' })).passed).toBe(true);
    expect(run(req('PATCH')).passed).toBe(true);
  });

  it('refuses writes from another site, by Origin or by Sec-Fetch-Site', () => {
    for (const r of [
      req('POST', { origin: 'https://evil.example' }),
      req('DELETE', { origin: 'https://eduadmin-web.vercel.app.evil.example' }),
      req('PUT', { 'sec-fetch-site': 'cross-site' }),
      req('POST', { origin: 'null' }),
    ]) {
      const { response, passed } = run(r);
      expect(passed).toBe(false);
      expect(response.statusCode).toBe(403);
    }
  });
});

describe('noStore', () => {
  it('marks every API response as not to be cached (a route can still set its own)', () => {
    const response = res();
    const next = vi.fn();
    noStore(req('GET'), response, next as unknown as NextFunction);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(next).toHaveBeenCalled();
  });
});
