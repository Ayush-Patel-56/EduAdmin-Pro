import type { RequestHandler } from 'express';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuses requests that change something when a browser says they come from
 * another site. The session cookie is SameSite=Lax, which already keeps it
 * off most cross-site requests; this also covers sibling subdomains (same
 * "site" under a custom domain) and browsers that don't honour SameSite.
 * Requests without browser headers (scripts, the release checks) pass: they
 * carry no one's cookie by accident.
 */
export function sameOriginWrites(webOrigin: string): RequestHandler {
  return (req, res, next) => {
    if (READS.has(req.method)) return next();
    const origin = req.headers.origin;
    if ((origin !== undefined && origin !== webOrigin) || req.headers['sec-fetch-site'] === 'cross-site') {
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
