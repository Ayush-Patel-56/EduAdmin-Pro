import { validateEnv } from './env.js';

const base = { DATABASE_URL: 'postgresql://u:p@host/db' };

describe('validateEnv', () => {
  it('accepts a minimal development config', () => {
    expect(validateEnv(base)).toEqual(base);
  });

  it('requires DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow('DATABASE_URL is required');
  });

  it('rejects malformed values', () => {
    expect(() => validateEnv({ ...base, PORT: 'abc' })).toThrow('PORT must be');
    expect(() => validateEnv({ ...base, WEB_ORIGIN: 'localhost' })).toThrow('WEB_ORIGIN must be');
    expect(() => validateEnv({ ...base, TRUST_PROXY: 'yes' })).toThrow('TRUST_PROXY must be');
    expect(() => validateEnv({ ...base, REQUIRE_EMAIL_VERIFICATION: '1' })).toThrow(
      'REQUIRE_EMAIL_VERIFICATION must be',
    );
  });

  it('requires SMTP and WEB_ORIGIN in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/WEB_ORIGIN is required[\s\S]*SMTP_PASS/);
    expect(
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        WEB_ORIGIN: 'https://app.example.com',
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
      }),
    ).toBeTruthy();
  });
});
