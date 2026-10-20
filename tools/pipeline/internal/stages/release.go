package stages

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/run"
	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/smoke"
	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/vercel"
)

// ReleaseDeps is everything Release does to the outside world. Live is the
// real implementation; tests use fakes.
type ReleaseDeps interface {
	EnsureProject(ctx context.Context, spec vercel.ProjectSpec) (vercel.Project, error)
	EnsureDomain(ctx context.Context, projectID, name string) error
	ProductionOrigin(ctx context.Context, projectID string) (string, error)
	RolledBack(ctx context.Context, projectID string) (bool, error)
	PreviousProduction(ctx context.Context, projectID string) (deploymentID string, ok bool, err error)
	// APIEnv builds the API project's production environment.
	APIEnv(webOrigin string) (map[string]string, error)
	// PendingMigrations lists the migrations production hasn't applied yet.
	PendingMigrations(ctx context.Context) ([]Migration, error)
	// Migrate applies them, returning the command's output for diagnosis.
	Migrate(ctx context.Context) (output string, err error)
	SyncEnv(ctx context.Context, projectID string, vars map[string]string) error
	// Deploy builds and deploys the project to production, returning the
	// deployment's URL for the log ("" if it could not be read; success
	// is the error being nil).
	Deploy(ctx context.Context, projectID string) (url string, err error)
	// WriteRewrite points the web project's /api rewrite at apiOrigin. restore
	// puts apps/web/vercel.json back as it was.
	WriteRewrite(apiOrigin string) (restore func() error, err error)
	Smoke(ctx context.Context, webOrigin, apiOrigin string) error
	Rollback(ctx context.Context, projectID, deploymentID string) error
}

// undoHint is how to get out of a rolled-back state, for the error text.
const undoHint = "Production domains stay on the rolled-back deployment, and new deployments won't go live, until the rollback is undone: " +
	"once the problem is fixed, use Undo Rollback on the project's production deployment in the Vercel dashboard, " +
	"or run `vercel promote <deployment-url-or-id>`, then run the release again"

// target is a project together with what to roll it back to.
type target struct {
	project vercel.Project
	prev    string
	hasPrev bool
}

// Release ships the current checkout to production: it refuses if a project is
// still rolled back, warns about destructive migrations, migrates the database,
// syncs the API's environment, deploys the API then the web, and runs the
// smoke checks. If the web deploy or the smoke checks fail, the projects
// deployed so far are rolled back to the deployments that were live before.
// The database is never rolled back: migrations are additive (expand/contract).
func Release(ctx context.Context, r *run.Runner, d ReleaseDeps) error {
	r.Stage("vercel projects")
	api, err := ensure(ctx, r, d, vercel.APISpec)
	if err != nil {
		return err
	}
	web, err := ensure(ctx, r, d, vercel.WebSpec)
	if err != nil {
		return err
	}
	apiOrigin, err := d.ProductionOrigin(ctx, api.ID)
	if err != nil {
		return err
	}
	webOrigin, err := d.ProductionOrigin(ctx, web.ID)
	if err != nil {
		return err
	}
	r.Printf("api origin %s", apiOrigin)
	r.Printf("web origin %s", webOrigin)

	r.Stage("rollback state")
	var stuck []string
	for _, p := range []vercel.Project{api, web} {
		rolled, err := d.RolledBack(ctx, p.ID)
		if err != nil {
			return err
		}
		if rolled {
			stuck = append(stuck, p.Name)
		}
	}
	if len(stuck) > 0 {
		return fmt.Errorf("still rolled back from an earlier release: %s. A new deployment would not go live, so nothing was migrated or deployed. "+
			"Check the live site, then undo the rollback: use Undo Rollback on the project's production deployment in the Vercel dashboard, "+
			"or run `vercel promote <deployment-url-or-id>`. Then run the release again", strings.Join(stuck, ", "))
	}
	apiT, webT := target{project: api}, target{project: web}
	for _, t := range []*target{&apiT, &webT} {
		t.prev, t.hasPrev, err = d.PreviousProduction(ctx, t.project.ID)
		if err != nil {
			return err
		}
		if t.hasPrev {
			r.Printf("%s: current production deployment %s", t.project.Name, t.prev)
		} else {
			r.Printf("%s: no production deployment yet", t.project.Name)
		}
	}
	// Built now so a missing secret stops the release before anything changes.
	env, err := d.APIEnv(webOrigin)
	if err != nil {
		return err
	}

	r.Stage("migrations")
	pending, err := d.PendingMigrations(ctx)
	if err != nil {
		return err
	}
	if len(pending) == 0 {
		r.Printf("no pending migrations")
	}
	for _, m := range pending {
		r.Printf("pending: %s", m.Name)
		for _, kind := range RiskyStatements(m.SQL) {
			r.Printf("::warning::migration %s has a %s statement. A release must only add: drop or rename something one release after no deployed code uses it (expand/contract, see docs/deploy.md)", m.Name, kind)
		}
	}
	if out, err := d.Migrate(ctx); err != nil {
		return migrateError(out, err)
	}

	r.Stage("api environment")
	if err := d.SyncEnv(ctx, api.ID, env); err != nil {
		return err
	}
	r.Printf("%s: %d production variables written", api.Name, len(env))

	r.Stage("deploy api")
	apiURL, err := d.Deploy(ctx, api.ID)
	if err != nil {
		return fmt.Errorf("deploying %s failed: %w. The database is migrated; the web project was not deployed", api.Name, err)
	}
	printDeployed(r, api.Name, apiURL)

	r.Stage("deploy web")
	webURL, err := deployWeb(ctx, r, d, web, apiOrigin)
	if err != nil {
		return rollBack(ctx, r, d, fmt.Errorf("deploying %s failed: %w", web.Name, err), apiT)
	}
	printDeployed(r, web.Name, webURL)

	r.Stage("smoke")
	if err := d.Smoke(ctx, webOrigin, apiOrigin); err != nil {
		return rollBack(ctx, r, d, err, apiT, webT)
	}
	r.Printf("released: %s", webOrigin)
	return nil
}

// ensure creates or updates the project and makes sure it has its
// *.vercel.app production domain.
func ensure(ctx context.Context, r *run.Runner, d ReleaseDeps, spec vercel.ProjectSpec) (vercel.Project, error) {
	p, err := d.EnsureProject(ctx, spec)
	if err != nil {
		return vercel.Project{}, err
	}
	if err := d.EnsureDomain(ctx, p.ID, p.Name); err != nil {
		return vercel.Project{}, err
	}
	r.Printf("project %s ready", p.Name)
	return p, nil
}

// deployWeb writes the API origin into apps/web/vercel.json, deploys the web
// project, and puts vercel.json back whatever happens, so a local run leaves
// the tree as it was.
func deployWeb(ctx context.Context, r *run.Runner, d ReleaseDeps, web vercel.Project, apiOrigin string) (string, error) {
	restore, err := d.WriteRewrite(apiOrigin)
	if err != nil {
		return "", err
	}
	defer func() {
		if err := restore(); err != nil {
			r.Printf("::warning::could not restore apps/web/vercel.json: %v", err)
		}
	}()
	return d.Deploy(ctx, web.ID)
}

// rollBack points each target back at its previous production deployment and
// returns cause with a plain account of the state production is now in.
func rollBack(ctx context.Context, r *run.Runner, d ReleaseDeps, cause error, targets ...target) error {
	r.Stage("rollback")
	// A cancelled release (Ctrl-C, a cancelled workflow) must still roll back,
	// or production is left half new and half old.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), RollbackTimeout)
	defer cancel()
	var done, notes []string
	for _, t := range targets {
		if !t.hasPrev {
			notes = append(notes, fmt.Sprintf("%s has no earlier production deployment to roll back to (this was its first release), so it stays on the new deployment", t.project.Name))
			continue
		}
		if err := d.Rollback(ctx, t.project.ID, t.prev); err != nil {
			notes = append(notes, fmt.Sprintf("rolling back %s to %s FAILED (%v): it may still serve the new deployment; roll it back from the Vercel dashboard", t.project.Name, t.prev, err))
			continue
		}
		r.Printf("%s rolled back to %s", t.project.Name, t.prev)
		done = append(done, fmt.Sprintf("%s to %s", t.project.Name, t.prev))
	}
	msg := cause.Error()
	if len(done) > 0 {
		msg += fmt.Sprintf(". Rolled back %s: production serves the previous release again (the database is not rolled back; expand/contract keeps the old code working)", strings.Join(done, " and "))
	}
	for _, n := range notes {
		msg += ". " + n
	}
	if len(done) > 0 {
		msg += ". " + undoHint
	}
	return fmt.Errorf("%s", msg)
}

// Live is the real ReleaseDeps: the Vercel REST API, the pinned Vercel CLI,
// Prisma against the production database, and the smoke checks.
type Live struct {
	*vercel.Client
	r      *run.Runner
	root   string
	getenv func(string) string
	token  string
	orgID  string
	dbEnv  []string
	// HTTP is the smoke checks' client; nil means smoke's default.
	HTTP *http.Client
}

var _ ReleaseDeps = (*Live)(nil)

// NewLive checks the credentials a release needs and registers the extra
// values to mask (the token and the database hosts, which Prisma prints).
func NewLive(r *run.Runner, root string, getenv func(string) string, apiBase string) (*Live, error) {
	var missing []string
	for _, k := range []string{"VERCEL_TOKEN", "VERCEL_ORG_ID", "PROD_DIRECT_URL", "PROD_DATABASE_URL"} {
		if strings.TrimSpace(getenv(k)) == "" {
			missing = append(missing, k)
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("missing %s", strings.Join(missing, ", "))
	}
	token := getenv("VERCEL_TOKEN")
	r.Mask(token, getenv("PROD_DIRECT_URL"), getenv("PROD_DATABASE_URL"))
	for _, k := range []string{"PROD_DIRECT_URL", "PROD_DATABASE_URL"} {
		if u, err := url.Parse(getenv(k)); err == nil {
			r.Mask(u.Hostname())
		}
	}
	return &Live{
		Client: vercel.NewClient(token, getenv("VERCEL_ORG_ID"), apiBase),
		r:      r,
		root:   root,
		getenv: getenv,
		token:  token,
		orgID:  getenv("VERCEL_ORG_ID"),
		dbEnv:  []string{"DIRECT_URL=" + getenv("PROD_DIRECT_URL"), "DATABASE_URL=" + getenv("PROD_DATABASE_URL")},
	}, nil
}

// APIEnv builds the API's environment and masks its secret values.
func (l *Live) APIEnv(webOrigin string) (map[string]string, error) {
	env, err := vercel.APIEnv(l.getenv, webOrigin)
	if err != nil {
		return nil, err
	}
	for _, k := range []string{"DATABASE_URL", "SMTP_PASS", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "CRON_SECRET"} {
		l.r.Mask(env[k])
	}
	return env, nil
}

// PendingMigrations asks Prisma which migrations production lacks and reads
// their SQL. `migrate status` exits non-zero when some are pending, so its
// output decides, not its exit status.
func (l *Live) PendingMigrations(ctx context.Context) ([]Migration, error) {
	out, err := l.r.Output(ctx, "", l.dbEnv, "pnpm", "--filter", "api", "exec", "prisma", "migrate", "status")
	names, found, perr := parsePending(out)
	if perr != nil {
		return nil, perr
	}
	if !found {
		if err != nil {
			return nil, fmt.Errorf("prisma migrate status failed (its errors are above): %w", err)
		}
		return nil, nil
	}
	var ms []Migration
	for _, name := range names {
		b, rerr := os.ReadFile(filepath.Join(l.root, "apps", "api", "prisma", "migrations", name, "migration.sql"))
		if rerr != nil {
			return nil, fmt.Errorf("reading migration %s: %w", name, rerr)
		}
		ms = append(ms, Migration{Name: name, SQL: string(b)})
	}
	return ms, nil
}

// Migrate runs `prisma migrate deploy` against production over the direct
// connection.
func (l *Live) Migrate(ctx context.Context) (string, error) {
	return l.r.Tee(ctx, "", l.dbEnv, "pnpm", "--filter", "api", "exec", "prisma", "migrate", "deploy")
}

// Deploy builds and deploys the project with the pinned Vercel CLI.
func (l *Live) Deploy(ctx context.Context, projectID string) (string, error) {
	return vercel.Deploy(ctx, l.r, projectID, l.orgID, l.token)
}

// WriteRewrite writes apiOrigin into apps/web/vercel.json and returns a
// function that writes the original bytes back.
func (l *Live) WriteRewrite(apiOrigin string) (func() error, error) {
	webDir := filepath.Join(l.root, "apps", "web")
	path := filepath.Join(webDir, "vercel.json")
	orig, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	restore := func() error { return os.WriteFile(path, orig, 0o644) }
	if err := vercel.WriteRewrite(webDir, apiOrigin); err != nil {
		_ = restore()
		return nil, err
	}
	return restore, nil
}

// Smoke runs the read-only smoke checks and prints one line per check.
func (l *Live) Smoke(ctx context.Context, webOrigin, apiOrigin string) error {
	results := smoke.Run(ctx, l.HTTP, webOrigin, apiOrigin)
	failed := 0
	for _, res := range results {
		if res.Err != nil {
			failed++
			l.r.Printf("FAIL %s: %v", res.Name, res.Err)
			continue
		}
		l.r.Printf("ok   %s", res.Name)
	}
	if smoke.Failed(results) {
		return fmt.Errorf("%d of %d smoke checks failed", failed, len(results))
	}
	return nil
}

// RollbackTimeout bounds all the rollback calls of one failed release. They run
// even when the release's own context was cancelled.
var RollbackTimeout = 2 * time.Minute

// printDeployed logs a finished deploy. The URL is informational: the CLI
// exited 0, so the deployment exists even if its URL couldn't be read.
func printDeployed(r *run.Runner, name, url string) {
	if url == "" {
		r.Printf("%s deployed (deployment URL not read)", name)
		return
	}
	r.Printf("%s deployed: %s", name, url)
}
