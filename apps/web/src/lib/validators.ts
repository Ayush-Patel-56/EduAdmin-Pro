// Client-side mirrors of the API's validators (apps/api/src/common/validators.ts),
// so users see mistakes before submitting. The API remains the source of truth.

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Indian GSTIN including its mod-36 check digit. Expects upper-case input. */
export function isValidGstin(value: string): boolean {
  if (!GSTIN_PATTERN.test(value)) return false
  const state = Number(value.slice(0, 2))
  if (state < 1 || (state > 38 && state !== 97 && state !== 99)) return false
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(value[i]) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return value[14] === GSTIN_CHARS[(36 - (sum % 36)) % 36]
}

/** 10-digit Indian mobile starting 6-9, optionally prefixed with +91 / 91 / 0. */
export function isValidIndianMobile(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '')
  return /^[6-9]\d{9}$/.test(digits)
}
