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

## Accounts & join codes

- **New client school:** issue a platform invite, and give the code to the school's first admin. They enter it as the "Admin invite code" at signup.
  ```bash
  pnpm --filter api invite:create -- "Client name" --days 14
  ```
- **More admins:** a school admin issues a single-use, expiring admin code.
- **Teachers:** sign up with the school's teacher join code; they stay *pending* until an admin approves them.
- Everyone must verify their email before logging in. No email provider is connected yet: in development the verification link is printed in the API console.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run web + api together |
| `pnpm build` | Build all apps |
| `pnpm lint` | Lint all apps |
| `pnpm --filter api db:migrate` | Create/apply a migration |
| `pnpm --filter api db:studio` | Browse data in Prisma Studio |
| `pnpm --filter api invite:create` | Issue a platform invite code |
