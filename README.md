# EduAdmin Pro

School management platform with separate Admin and Teacher dashboards — class scheduling, programs (JEE, NEET, …), batches, and multi-school management via join codes.

## Stack

| Part | Tech |
|---|---|
| `apps/web` | React 19 + Vite + TypeScript + Tailwind CSS 4 + React Router |
| `apps/api` | NestJS + Prisma 7 |
| Database | PostgreSQL on Neon |
| Files | Cloudflare R2 (planned) |

## Getting started

Requires Node 22+ and pnpm 10+.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # fill in your Neon connection strings
pnpm --filter api db:migrate             # create tables
pnpm dev                                  # web on :5173, api on :3000
```

The web dev server proxies `/api/*` to the API, so the frontend always calls relative `/api/...` paths.

### Neon connection strings

- `DATABASE_URL`: **pooled** connection (host contains `-pooler`), used by the running app.
- `DIRECT_URL`: **direct** connection, used by Prisma for migrations.

Create the Neon project in the region closest to your users (e.g. Singapore for India), and deploy the API in the same region.

Local development uses the Neon **`dev`** branch, a copy of `production`. Point `.env` at `production` only when deploying.

## Accounts & invite codes

1. **Admin invite code:** required to create an admin account. The permanent code is **`ADMIN123`** (unlimited uses, never expires). A migration creates it in every environment and restores it if it's ever revoked. Extra one-off codes can still be issued:
   ```bash
   pnpm --filter api invite:create -- "Client name" --max-uses 1 --days 14
   ```
2. After logging in, an admin either **creates a school** or **joins an existing school** with that school's invite code.
3. **School invite code:** every school gets a unique code (e.g. `GFCZ-BBYB`), shown on its dashboard.
   - **Admin accounts** that enter it join as admins.
   - **Teachers** who sign up with it join as *pending* until an admin approves them.

### Teachers

1. Sign up (school join code optional). A **6-digit code** is emailed. It expires in 10 minutes, is locked after 5 wrong tries, and can be re-sent once a minute.
2. After entering the code, sign in. Teachers can't sign in until their email is verified.
3. With a school code, the teacher is connected to that school immediately; without one, they can join later from the Faculty Portal. A teacher belongs to one school at a time.

Admins don't need to verify their email unless `REQUIRE_EMAIL_VERIFICATION=true`.

## Email (verification codes)

Codes are sent over SMTP. For Gmail (`academicplanningsystem@gmail.com`):

1. Turn on 2-Step Verification for that Google account.
2. Create an App Password at <https://myaccount.google.com/apppasswords>.
3. Put the 16-character password in `apps/api/.env` as `SMTP_PASS` (`SMTP_HOST`, `SMTP_USER` and `MAIL_FROM` are already set in `.env.example`).

If `SMTP_PASS` is empty in development, codes are printed in the API console instead. In production the API refuses to start without SMTP settings.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run web + api together |
| `pnpm build` | Build all apps |
| `pnpm lint` | Lint all apps |
| `pnpm --filter api db:migrate` | Create/apply a migration |
| `pnpm --filter api db:studio` | Browse data in Prisma Studio |
| `pnpm --filter api invite:create` | Issue an admin invite code |
