// Vercel's per-request context, as @vercel/functions reads it (its waitUntil is
// exactly this lookup); read here directly to avoid a dependency.
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');
type RequestContext = { waitUntil?: (work: Promise<unknown>) => void };

/**
 * Lets `work` finish after the response has gone. On Vercel the platform is
 * told to keep the function up until it settles; a long-running server (local
 * development) simply finishes it. `work` should handle its own errors.
 */
export function afterResponse(work: Promise<unknown>): void {
  const holder = (globalThis as Record<symbol, { get?: () => RequestContext | undefined } | undefined>)[REQUEST_CONTEXT];
  holder?.get?.()?.waitUntil?.(work);
}
