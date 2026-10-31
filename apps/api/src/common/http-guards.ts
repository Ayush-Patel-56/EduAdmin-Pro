import type { RequestHandler } from 'express';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * WEB_ORIGIN as the exact origins browsers send: a comma-separated list
 * (e.g. while moving to a custom domain), each reduced to scheme, host and
 * port, so spacing, letter case, a default port or a path can't make the
 * web app's own requests look foreign.
 */
export function parseOrigins(value: string): string[] {
  const origins = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => {
      let url: URL;
      try {
        url = new URL(v);
      } catch {
        throw new Error(`WEB_ORIGIN has an entry that isn't a URL: ${v}`);
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`WEB_ORIGIN entries must be http(s) addresses: ${v}`);
      return url.origin;
    });
  if (origins.length === 0) throw new Error('WEB_ORIGIN is empty');
  return origins;
}

/**
 * Refuses requests that change something when a browser says they come from
 * another site. The session cookie is SameSite=Lax, which already keeps it
 * off most cross-site requests; this also covers sibling subdomains (same
 * "site" under a custom domain) and browsers that don't honour SameSite.
 * Requests without browser headers (scripts, the release checks) pass: they
 * carry no one's cookie by accident.
 */
export function sameOriginWrites(webOrigins: string[]): RequestHandler {
  const allowed = new Set(webOrigins);
  return (req, res, next) => {
    if (READS.has(req.method)) return next();
    const origin = req.headers.origin;
    if ((origin !== undefined && !allowed.has(origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ statusCode: 403, message: 'This request came from another site and was refused' });
      return;
    }
    next();
  };
}

/** API answers often hold students' data: never keep them in a browser or shared cache. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
