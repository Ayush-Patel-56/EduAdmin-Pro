package stages

import (
	"context"
	"errors"
	"fmt"
	"net/url"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/run"
)

// E2E applies every migration to an empty database, runs the API end-to-end
// tests against it, and then checks that the migrations produce exactly the
// schema in schema.prisma. The tests wipe tables, so databaseURL must be a
// throwaway database on this machine; anything else is refused.
func E2E(ctx context.Context, r *run.Runner, databaseURL string) error {
	if err := requireLocalDatabase(databaseURL); err != nil {
		return err
	}
	env := []string{"DATABASE_URL=" + databaseURL, "DIRECT_URL=" + databaseURL}

	r.Stage("apply migrations")
	if err := r.Cmd(ctx, "", env, "pnpm", "--filter", "api", "exec", "prisma", "migrate", "deploy"); err != nil {
		return err
	}

	r.Stage("api e2e tests")
	if err := r.Cmd(ctx, "", env, "pnpm", "--filter", "api", "test:e2e"); err != nil {
		return err
	}

	// Exits 2 when the migrations and the schema have drifted apart.
	r.Stage("schema drift")
	return r.Cmd(ctx, "", env, "pnpm", "--filter", "api", "exec", "prisma", "migrate", "diff",
		"--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code")
}

// requireLocalDatabase accepts only a postgres URL whose host is this machine.
// Errors never include the URL: it carries a password.
func requireLocalDatabase(databaseURL string) error {
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required, and it must point at a throwaway local database")
	}
	u, err := url.Parse(databaseURL)
	if err != nil {
		return errors.New("DATABASE_URL is not a valid URL; it must point at a throwaway local database")
	}
	if u.Scheme != "postgres" && u.Scheme != "postgresql" {
		return errors.New("DATABASE_URL must be a postgres URL for a throwaway local database")
	}
	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1":
		return nil
	}
	return fmt.Errorf("refusing to run against host %q: the tests wipe data, so only a throwaway database on localhost, 127.0.0.1 or ::1 is allowed", u.Hostname())
}
