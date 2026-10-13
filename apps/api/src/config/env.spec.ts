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

  it('does not allow turning email verification off in production', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://app.example.com',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
    };
    expect(() => validateEnv({ ...production, REQUIRE_EMAIL_VERIFICATION: 'false' })).toThrow(
      'REQUIRE_EMAIL_VERIFICATION=false is not allowed in production',
    );
    expect(validateEnv({ ...production, REQUIRE_EMAIL_VERIFICATION: 'true' })).toBeTruthy();
    expect(validateEnv(production)).toBeTruthy();
    // Still fine to leave it off in development.
    expect(validateEnv({ ...base, REQUIRE_EMAIL_VERIFICATION: 'false' })).toBeTruthy();
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

  it('takes R2 settings all together or not at all', () => {
    expect(() => validateEnv({ ...base, R2_BUCKET: 'files' })).toThrow(
      /R2 storage needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/,
    );
    expect(
      validateEnv({
        ...base,
        R2_ACCOUNT_ID: 'acc',
        R2_ACCESS_KEY_ID: 'key',
        R2_SECRET_ACCESS_KEY: 'secret',
        R2_BUCKET: 'files',
      }),
    ).toBeTruthy();
  });

  it('local file storage is opt-in and never allowed in production', () => {
    expect(validateEnv({ ...base, FILE_STORAGE: 'local' })).toBeTruthy();
    expect(() => validateEnv({ ...base, FILE_STORAGE: 'disk' })).toThrow('FILE_STORAGE must be');
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', WEB_ORIGIN: 'https://a.b', SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p', FILE_STORAGE: 'local' }),
    ).toThrow('FILE_STORAGE=local is for development only');
  });
});
