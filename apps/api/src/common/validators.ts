import { registerDecorator, type ValidationOptions } from 'class-validator';

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Validates an Indian GSTIN: 15 characters (state code, PAN, entity number,
 * "Z", check digit) including the official mod-36 check digit.
 */
export function isValidGstin(value: string): boolean {
  if (!GSTIN_PATTERN.test(value)) return false;
  const state = Number(value.slice(0, 2));
  if (state < 1 || (state > 38 && state !== 97 && state !== 99)) return false;

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(value[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = GSTIN_CHARS[(36 - (sum % 36)) % 36];
  return value[14] === check;
}

/** Indian mobile number: 10 digits starting 6-9, optional +91 / 0 prefix. */
export function normalizeIndianMobile(value: string): string | null {
  const digits = value.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

function simpleDecorator(name: string, test: (value: string) => boolean, message: string) {
  return (options?: ValidationOptions) => (object: object, propertyName: string) =>
    registerDecorator({
      name,
      target: object.constructor,
      propertyName,
      options: { message, ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && test(value),
      },
    });
}

export const IsGstin = simpleDecorator(
  'isGstin',
  isValidGstin,
  'Please enter a valid 15-character GST number',
);

export const IsIndianMobile = simpleDecorator(
  'isIndianMobile',
  (v) => normalizeIndianMobile(v) !== null,
  'Please enter a valid 10-digit mobile number',
);
