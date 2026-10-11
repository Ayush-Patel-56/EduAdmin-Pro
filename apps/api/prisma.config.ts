import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// `prisma generate` (run by `pnpm install`) loads this file but never connects,
// so a fresh checkout or CI job without DIRECT_URL must still be able to load
// it. Commands that do connect (migrate deploy, db push, ...) fail on this
// placeholder with a connection error rather than touching another database.
const GENERATE_ONLY_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Migrations run over Neon's direct (non-pooled) connection.
    url: process.env.DIRECT_URL || GENERATE_ONLY_URL,
  },
});
