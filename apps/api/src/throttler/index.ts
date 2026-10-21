/**
 * Vendored from @nestjs/throttler v6.7.1 (https://github.com/nestjs/throttler,
 * commit 91f49124562621737a26a0a771430d5bc684985f), MIT licensed (see LICENSE).
 *
 * Why: NestJS 12 ships @nestjs/common and @nestjs/core as ES modules only, but
 * @nestjs/throttler is CommonJS and require()s them. Node allows that, Vercel's
 * function launcher does not (ERR_REQUIRE_ESM), so the API crashed at startup.
 * Compiling the source here makes it ESM like the rest of the app.
 *
 * Changes from upstream: relative imports carry the `.js` suffix (nodenext) and
 * type-only imports use `import type` where this repo's compiler settings need it.
 * Replace this folder with the npm package once it publishes an ESM release.
 */
export * from './ip.js';
export * from './throttler-module-options.interface.js';
export * from './throttler-storage.interface.js';
export * from './throttler.decorator.js';
export * from './throttler.exception.js';
export * from './throttler.guard.js';
export * from './throttler.guard.interface.js';
export * from './throttler.module.js';
export { getOptionsToken, getStorageToken } from './throttler.providers.js';
export * from './throttler.service.js';
export * from './utilities.js';
