// Checked once at boot by ConfigModule so a missing or malformed variable
// stops the API immediately instead of failing on the first request.

type Env = Record<string, unknown>;

const NODE_ENVS = ['development', 'production', 'test'];
const BOOLEANS = ['true', 'false'];
export const R2_KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
];

export function validateEnv(env: Env): Env {
  const errors: string[] = [];
  const str = (key: string) =>
    typeof env[key] === 'string' ? (env[key] as string).trim() : '';

  if (!str('DATABASE_URL')) errors.push('DATABASE_URL is required');
  else if (!/^postgres(ql)?:\/\//.test(str('DATABASE_URL'))) {
    errors.push('DATABASE_URL must be a postgres:// connection string');
  }

  if (str('NODE_ENV') && !NODE_ENVS.includes(str('NODE_ENV'))) {
    errors.push(`NODE_ENV must be one of ${NODE_ENVS.join(', ')}`);
  }
  if (str('PORT') && !isPort(str('PORT')))
    errors.push('PORT must be a number between 1 and 65535');
  if (str('SMTP_PORT') && !isPort(str('SMTP_PORT'))) {
    errors.push('SMTP_PORT must be a number between 1 and 65535');
  }
  if (str('WEB_ORIGIN') && !isHttpUrl(str('WEB_ORIGIN'))) {
    errors.push(
      'WEB_ORIGIN must be an http(s) URL, e.g. http://localhost:5173',
    );
  }
  if (
    str('REQUIRE_EMAIL_VERIFICATION') &&
    !BOOLEANS.includes(str('REQUIRE_EMAIL_VERIFICATION'))
  ) {
    errors.push('REQUIRE_EMAIL_VERIFICATION must be true or false');
  }
  if (str('TRUST_PROXY') && !/^\d+$/.test(str('TRUST_PROXY'))) {
    errors.push(
      'TRUST_PROXY must be the number of proxy hops in front of the API, e.g. 1',
    );
  }

  // Cloudflare R2 (file uploads): all of these or none. Without them, uploads
  // go to a local folder in development and are switched off in production.
  const r2 = R2_KEYS.filter((key) => str(key));
  if (r2.length > 0 && r2.length < R2_KEYS.length) {
    const missing = R2_KEYS.filter((key) => !str(key));
    errors.push(`R2 storage needs ${missing.join(', ')} as well`);
  }

  if (str('NODE_ENV') === 'production') {
    // Production always verifies email; the flag may only be left unset or true.
    if (str('REQUIRE_EMAIL_VERIFICATION') === 'false') {
      errors.push(
        'REQUIRE_EMAIL_VERIFICATION=false is not allowed in production',
      );
    }
    if (!str('WEB_ORIGIN')) errors.push('WEB_ORIGIN is required in production');
    for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
      if (!str(key)) errors.push(`${key} is required in production`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${errors.join('\n  - ')}`,
    );
  }
  return env;
}

function isPort(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65_535;
}

function isHttpUrl(value: string) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
