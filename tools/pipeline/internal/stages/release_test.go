package stages_test

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/run"
	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/stages"
	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/vercel"
)

func TestRiskyStatements(t *testing.T) {
	for _, tc := range []struct {
		sql  string
		want []string
	}{
		{`ALTER TABLE "Student" DROP COLUMN "x";`, []string{"DROP COLUMN"}},
		{`alter table "A" rename to "B";`, []string{"RENAME"}},
		{`ALTER TABLE "A" RENAME COLUMN "a" TO "b";`, []string{"RENAME"}},
		{`DROP TABLE "Old";`, []string{"DROP TABLE"}},
		{`DROP TYPE "Role_old";`, []string{"DROP TYPE"}},
		{"ALTER TABLE \"A\"\n  RENAME TO \"B\";", []string{"RENAME"}},
		{`ALTER TYPE "Role" RENAME VALUE 'A' TO 'B';`, []string{"RENAME"}},
		{`ALTER TABLE "A" DROP CONSTRAINT "A_x_fkey";`, nil},
		{`ALTER TABLE "A" ALTER COLUMN "b" DROP NOT NULL;`, nil},
		{`ALTER TABLE "A" ALTER COLUMN "b" DROP DEFAULT;`, nil},
		{`DROP INDEX "A_b_key";`, nil},
		{`ALTER TABLE "A" ADD COLUMN "renamed_at" TIMESTAMP, ADD COLUMN "rename_reason" TEXT;`, nil},
		{`ALTER TABLE "A" RENAME CONSTRAINT "A_pkey" TO "B_pkey";`, nil},
		{"-- DROP TABLE \"A\";\nCREATE TABLE \"B\" (id int);", nil},
		{`CREATE TABLE "B" (id int); -- then DROP COLUMN later`, nil},
		{"ALTER TABLE \"A\" ADD COLUMN \"c\" TEXT;\nALTER TABLE \"A\" DROP COLUMN \"d\";\nDROP TABLE \"E\";", []string{"DROP COLUMN", "DROP TABLE"}},
	} {
		got := stages.RiskyStatements(tc.sql)
		if strings.Join(got, ",") != strings.Join(tc.want, ",") {
			t.Errorf("RiskyStatements(%q) = %v, want %v", tc.sql, got, tc.want)
		}
	}
}

// fakeDeps records the release's calls in order. Projects are named by their
// short label ("api", "web") in the steps.
type fakeDeps struct {
	steps       []string
	rolledBack  map[string]bool
	prev        map[string]string // label -> deployment; absent means none yet
	pending     []stages.Migration
	migrateOut  string
	migrateErr  error
	deployErr   map[string]error
	rewriteErr  error
	smokeErr    error
	rollbacks   []string // "label deployment"
	smokeArgs   [2]string
	rewriteTo   string
	noURL       bool       // Deploy succeeds but returns no URL
	onSmoke     func()     // runs when smoke starts
	rollbackCtx []ctxState // the context each Rollback got, as it was then
}

func label(id string) string { return strings.TrimPrefix(id, "prj_") }

func (f *fakeDeps) EnsureProject(_ context.Context, spec vercel.ProjectSpec) (vercel.Project, error) {
	l := strings.TrimPrefix(spec.Name, "eduadmin-")
	f.steps = append(f.steps, "ensure "+l)
	return vercel.Project{ID: "prj_" + l, Name: spec.Name}, nil
}

func (f *fakeDeps) EnsureDomain(_ context.Context, id, name string) error {
	f.steps = append(f.steps, "domain "+label(id))
	return nil
}

func (f *fakeDeps) ProductionOrigin(_ context.Context, id string) (string, error) {
	return "https://eduadmin-" + label(id) + ".vercel.app", nil
}

func (f *fakeDeps) RolledBack(_ context.Context, id string) (bool, error) {
	f.steps = append(f.steps, "rolledBack "+label(id))
	return f.rolledBack[label(id)], nil
}

func (f *fakeDeps) PreviousProduction(_ context.Context, id string) (string, bool, error) {
	f.steps = append(f.steps, "previous "+label(id))
	d, ok := f.prev[label(id)]
	return d, ok, nil
}

func (f *fakeDeps) APIEnv(webOrigin string) (map[string]string, error) {
	return map[string]string{"WEB_ORIGIN": webOrigin}, nil
}

func (f *fakeDeps) PendingMigrations(context.Context) ([]stages.Migration, error) {
	f.steps = append(f.steps, "pending migrations")
	return f.pending, nil
}

func (f *fakeDeps) Migrate(context.Context) (string, error) {
	f.steps = append(f.steps, "migrate")
	return f.migrateOut, f.migrateErr
}

func (f *fakeDeps) SyncEnv(_ context.Context, id string, vars map[string]string) error {
	f.steps = append(f.steps, "sync env "+label(id))
	return nil
}

func (f *fakeDeps) Deploy(_ context.Context, id string) (string, error) {
	f.steps = append(f.steps, "deploy "+label(id))
	if err := f.deployErr[label(id)]; err != nil {
		return "", err
	}
	if f.noURL {
		return "", nil
	}
	return "https://eduadmin-" + label(id) + "-abc.vercel.app", nil
}

func (f *fakeDeps) WriteRewrite(apiOrigin string) (func() error, error) {
	f.steps = append(f.steps, "write rewrite")
	f.rewriteTo = apiOrigin
	if f.rewriteErr != nil {
		return nil, f.rewriteErr
	}
	return func() error {
		f.steps = append(f.steps, "restore rewrite")
		return nil
	}, nil
}

func (f *fakeDeps) Smoke(_ context.Context, web, api string) error {
	f.steps = append(f.steps, "smoke")
	if f.onSmoke != nil {
		f.onSmoke()
	}
	f.smokeArgs = [2]string{web, api}
	return f.smokeErr
}

func (f *fakeDeps) Rollback(ctx context.Context, id, deployment string) error {
	_, hasDeadline := ctx.Deadline()
	f.rollbackCtx = append(f.rollbackCtx, ctxState{err: ctx.Err(), hasDeadline: hasDeadline})
	f.steps = append(f.steps, "rollback "+label(id))
	f.rollbacks = append(f.rollbacks, label(id)+" "+deployment)
	return nil
}

func newFake() *fakeDeps {
	return &fakeDeps{prev: map[string]string{"api": "dpl_api_prev", "web": "dpl_web_prev"}}
}

func release(t *testing.T, f *fakeDeps) (error, string) {
	t.Helper()
	var out bytes.Buffer
	r := run.New("/repo", &out)
	err := stages.Release(context.Background(), r, f)
	return err, out.String()
}

func countPrefix(steps []string, prefix string) int {
	n := 0
	for _, s := range steps {
		if strings.HasPrefix(s, prefix) {
			n++
		}
	}
	return n
}

func TestReleaseOrder(t *testing.T) {
	f := newFake()
	f.pending = []stages.Migration{
		{Name: "20261101000000_add_x", SQL: `ALTER TABLE "A" ADD COLUMN "x" TEXT;`},
		{Name: "20261102000000_drop_y", SQL: `ALTER TABLE "A" DROP COLUMN "y_secret_column";`},
	}
	err, out := release(t, f)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"ensure api", "domain api",
		"ensure web", "domain web",
		"rolledBack api", "rolledBack web",
		"previous api", "previous web",
		"pending migrations",
		"migrate",
		"sync env api",
		"deploy api",
		"write rewrite",
		"deploy web",
		"restore rewrite",
		"smoke",
	}
	if strings.Join(f.steps, "\n") != strings.Join(want, "\n") {
		t.Fatalf("steps:\n%s\nwant:\n%s", strings.Join(f.steps, "\n"), strings.Join(want, "\n"))
	}
	if f.rewriteTo != "https://eduadmin-api.vercel.app" {
		t.Errorf("rewrite target = %q", f.rewriteTo)
	}
	if f.smokeArgs != [2]string{"https://eduadmin-web.vercel.app", "https://eduadmin-api.vercel.app"} {
		t.Errorf("smoke origins = %v", f.smokeArgs)
	}
	if !strings.Contains(out, "::warning::") || !strings.Contains(out, "20261102000000_drop_y") || !strings.Contains(out, "DROP COLUMN") {
		t.Errorf("expected a ::warning:: naming the migration and DROP COLUMN:\n%s", out)
	}
	if strings.Contains(out, "y_secret_column") {
		t.Errorf("the warning should name the statement kind, not print the SQL:\n%s", out)
	}
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "::warning::") && strings.Contains(line, "20261101000000_add_x") {
			t.Errorf("an additive migration must not be warned about: %s", line)
		}
	}
	if len(f.rollbacks) != 0 {
		t.Errorf("unexpected rollbacks: %v", f.rollbacks)
	}
}

func TestReleaseStopsWhenRolledBack(t *testing.T) {
	f := newFake()
	f.rolledBack = map[string]bool{"web": true}
	err, _ := release(t, f)
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, want := range []string{"Undo Rollback", "vercel promote", "eduadmin-web"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error should contain %q: %v", want, err)
		}
	}
	if countPrefix(f.steps, "migrate") != 0 || countPrefix(f.steps, "deploy") != 0 || countPrefix(f.steps, "sync env") != 0 {
		t.Fatalf("nothing may change after the rollback check fails: %v", f.steps)
	}
}

func TestReleaseMigrationFailureDeploysNothing(t *testing.T) {
	f := newFake()
	f.migrateOut = "Error: P3018\nERROR: canceling statement due to lock timeout\n"
	f.migrateErr = errors.New("pnpm: exit status 1")
	err, _ := release(t, f)
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, want := range []string{"migrate resolve --rolled-back", "lock"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error should contain %q: %v", want, err)
		}
	}
	if countPrefix(f.steps, "deploy") != 0 || countPrefix(f.steps, "sync env") != 0 || len(f.rollbacks) != 0 {
		t.Fatalf("a failed migration must deploy nothing: %v", f.steps)
	}
}

func TestSmokeFailureRollsBackBoth(t *testing.T) {
	f := newFake()
	f.smokeErr = errors.New("2 of 8 smoke checks failed")
	err, _ := release(t, f)
	if err == nil {
		t.Fatal("expected an error")
	}
	want := []string{"api dpl_api_prev", "web dpl_web_prev"}
	if strings.Join(f.rollbacks, ",") != strings.Join(want, ",") {
		t.Fatalf("rollbacks = %v, want %v", f.rollbacks, want)
	}
	for _, s := range []string{"smoke checks failed", "rolled back", "eduadmin-api", "eduadmin-web", "Undo Rollback", "vercel promote"} {
		if !strings.Contains(err.Error(), s) {
			t.Errorf("error should contain %q: %v", s, err)
		}
	}
}

func TestWebDeployFailureRollsBackAPI(t *testing.T) {
	f := newFake()
	f.deployErr = map[string]error{"web": errors.New("vercel build: pnpm: exit status 1")}
	err, _ := release(t, f)
	if err == nil {
		t.Fatal("expected an error")
	}
	if strings.Join(f.rollbacks, ",") != "api dpl_api_prev" {
		t.Fatalf("rollbacks = %v, want only the API", f.rollbacks)
	}
	if countPrefix(f.steps, "smoke") != 0 {
		t.Errorf("smoke must not run after a failed deploy: %v", f.steps)
	}
	if countPrefix(f.steps, "restore rewrite") != 1 {
		t.Errorf("vercel.json must be restored after a failed web deploy: %v", f.steps)
	}
	for _, s := range []string{"eduadmin-api", "rolled back", "vercel promote"} {
		if !strings.Contains(err.Error(), s) {
			t.Errorf("error should contain %q: %v", s, err)
		}
	}
}

func TestRewriteFailureRollsBackAPI(t *testing.T) {
	f := newFake()
	f.rewriteErr = errors.New("apps/web/vercel.json has no __API_ORIGIN__ to replace")
	err, _ := release(t, f)
	if err == nil {
		t.Fatal("expected an error")
	}
	if strings.Join(f.rollbacks, ",") != "api dpl_api_prev" || countPrefix(f.steps, "deploy web") != 0 {
		t.Fatalf("steps %v, rollbacks %v", f.steps, f.rollbacks)
	}
}

func TestAPIDeployFailureRollsBackNothing(t *testing.T) {
	f := newFake()
	f.deployErr = map[string]error{"api": errors.New("vercel build: pnpm: exit status 1")}
	err, _ := release(t, f)
	if err == nil {
		t.Fatal("expected an error")
	}
	if len(f.rollbacks) != 0 || countPrefix(f.steps, "deploy web") != 0 {
		t.Fatalf("steps %v, rollbacks %v", f.steps, f.rollbacks)
	}
}

func TestFirstReleaseSmokeFailure(t *testing.T) {
	f := newFake()
	f.prev = map[string]string{}
	f.smokeErr = errors.New("1 of 8 smoke checks failed")
	err, _ := release(t, f)
	if err == nil {
		t.Fatal("expected an error")
	}
	if len(f.rollbacks) != 0 {
		t.Fatalf("there is nothing to roll back to, got %v", f.rollbacks)
	}
	if !strings.Contains(err.Error(), "no earlier production deployment to roll back to") {
		t.Fatalf("got %v", err)
	}
	if strings.Contains(err.Error(), "Undo Rollback") {
		t.Errorf("nothing was rolled back, so there is nothing to undo: %v", err)
	}
}

// --- the live implementation, with commands recorded instead of run ---

func liveRunner(t *testing.T, root string, stdout map[string]string, fail map[string]bool) (*run.Runner, *[]recorded, *bytes.Buffer) {
	t.Helper()
	var out bytes.Buffer
	r := run.New(root, &out)
	var cmds []recorded
	r.Exec = func(cmd *exec.Cmd) error {
		line := strings.Join(cmd.Args, " ")
		cmds = append(cmds, recorded{line: line, dir: cmd.Dir, env: cmd.Env})
		if s, ok := stdout[line]; ok && cmd.Stdout != nil {
			cmd.Stdout.Write([]byte(s))
		}
		if fail[line] {
			return errors.New("exit status 1")
		}
		return nil
	}
	return r, &cmds, &out
}

func liveEnv() map[string]string {
	return map[string]string{
		"VERCEL_TOKEN":      "vercel-token-value",
		"VERCEL_ORG_ID":     "team_x",
		"PROD_DATABASE_URL": "postgresql://u:db-pass@ep-pooled.example.neon.tech/neondb",
		"PROD_DIRECT_URL":   "postgresql://u:db-pass@ep-direct.example.neon.tech/neondb",
	}
}

func newLive(t *testing.T, r *run.Runner, root string) *stages.Live {
	t.Helper()
	env := liveEnv()
	l, err := stages.NewLive(r, root, func(k string) string { return env[k] }, "http://127.0.0.1:1")
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func TestNewLiveNeedsCredentials(t *testing.T) {
	_, err := stages.NewLive(run.New(t.TempDir(), &bytes.Buffer{}), t.TempDir(), func(string) string { return "" }, "")
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, k := range []string{"VERCEL_TOKEN", "VERCEL_ORG_ID", "PROD_DIRECT_URL", "PROD_DATABASE_URL"} {
		if !strings.Contains(err.Error(), k) {
			t.Errorf("error should list %s: %v", k, err)
		}
	}
}

const statusCmd = "pnpm --filter api exec prisma migrate status"

func TestLivePendingMigrationsParsesStatus(t *testing.T) {
	root := t.TempDir()
	for name, sql := range map[string]string{
		"20261101000000_add_x":  `ALTER TABLE "A" ADD COLUMN "x" TEXT;`,
		"20261102000000_drop_y": `ALTER TABLE "A" DROP COLUMN "y";`,
	} {
		dir := filepath.Join(root, "apps", "api", "prisma", "migrations", name)
		os.MkdirAll(dir, 0o755)
		os.WriteFile(filepath.Join(dir, "migration.sql"), []byte(sql), 0o644)
	}
	status := "Loaded Prisma config from prisma.config.ts.\n" +
		"Prisma schema loaded from prisma/schema.prisma\n" +
		"40 migrations found in prisma/migrations\n" +
		"Following migrations have not yet been applied:\n" +
		"20261101000000_add_x\n20261102000000_drop_y\n\n" +
		"To apply migrations in development run prisma migrate dev.\n" +
		"To apply migrations in production run prisma migrate deploy.\n"
	// migrate status exits non-zero when migrations are pending: that's data.
	r, cmds, _ := liveRunner(t, root, map[string]string{statusCmd: status}, map[string]bool{statusCmd: true})
	l := newLive(t, r, root)
	got, err := l.PendingMigrations(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Name != "20261101000000_add_x" || got[1].Name != "20261102000000_drop_y" ||
		!strings.Contains(got[1].SQL, "DROP COLUMN") {
		t.Fatalf("got %+v", got)
	}
	c := (*cmds)[0]
	if c.line != statusCmd {
		t.Fatalf("ran %q", c.line)
	}
	env := liveEnv()
	if !hasEnv(c, "DIRECT_URL="+env["PROD_DIRECT_URL"]) || !hasEnv(c, "DATABASE_URL="+env["PROD_DATABASE_URL"]) {
		t.Error("migrate status must run against the production database")
	}
}

func TestLivePendingMigrationsUpToDate(t *testing.T) {
	root := t.TempDir()
	r, _, _ := liveRunner(t, root, map[string]string{statusCmd: "Database schema is up to date!\n"}, nil)
	got, err := newLive(t, r, root).PendingMigrations(context.Background())
	if err != nil || len(got) != 0 {
		t.Fatalf("got %v %v", got, err)
	}
}

func TestLivePendingMigrationsFailsOnUnknownError(t *testing.T) {
	root := t.TempDir()
	r, _, _ := liveRunner(t, root, nil, map[string]bool{statusCmd: true})
	if _, err := newLive(t, r, root).PendingMigrations(context.Background()); err == nil {
		t.Fatal("a failed status with no pending list must be an error")
	}
}

func TestLivePendingMigrationsRejectsOddNames(t *testing.T) {
	root := t.TempDir()
	status := "Following migration have not yet been applied:\n../../../etc/passwd\n\n"
	r, _, _ := liveRunner(t, root, map[string]string{statusCmd: status}, map[string]bool{statusCmd: true})
	if _, err := newLive(t, r, root).PendingMigrations(context.Background()); err == nil {
		t.Fatal("a migration name with a path in it must be refused")
	}
}

func TestLiveMigrateRunsDeployAgainstProduction(t *testing.T) {
	root := t.TempDir()
	r, cmds, out := liveRunner(t, root, nil, nil)
	l := newLive(t, r, root)
	if _, err := l.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	c := (*cmds)[0]
	if c.line != "pnpm --filter api exec prisma migrate deploy" {
		t.Fatalf("ran %q", c.line)
	}
	env := liveEnv()
	if !hasEnv(c, "DIRECT_URL="+env["PROD_DIRECT_URL"]) || !hasEnv(c, "DATABASE_URL="+env["PROD_DATABASE_URL"]) {
		t.Error("migrate deploy must run against the production database")
	}
	// The database host is masked too: Prisma prints it.
	r.Printf("Datasource db: PostgreSQL database neondb at ep-direct.example.neon.tech")
	if strings.Contains(out.String(), "ep-direct.example.neon.tech") {
		t.Errorf("database host printed: %s", out.String())
	}
}

func TestLiveWriteRewriteRestoresOriginal(t *testing.T) {
	root := t.TempDir()
	webDir := filepath.Join(root, "apps", "web")
	os.MkdirAll(webDir, 0o755)
	orig := "{\r\n  \"rewrites\": [{ \"source\": \"/api/:path*\", \"destination\": \"__API_ORIGIN__/api/:path*\" }]\r\n}\r\n"
	path := filepath.Join(webDir, "vercel.json")
	os.WriteFile(path, []byte(orig), 0o644)

	r, _, _ := liveRunner(t, root, nil, nil)
	restore, err := newLive(t, r, root).WriteRewrite("https://eduadmin-api.vercel.app")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(path)
	if !strings.Contains(string(b), "https://eduadmin-api.vercel.app/api/:path*") {
		t.Fatalf("rewrite not written: %s", b)
	}
	if err := restore(); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(path)
	if string(b) != orig {
		t.Fatalf("vercel.json not restored byte for byte: %q", b)
	}
}

func TestLiveWriteRewriteFailureLeavesFileAlone(t *testing.T) {
	root := t.TempDir()
	webDir := filepath.Join(root, "apps", "web")
	os.MkdirAll(webDir, 0o755)
	os.WriteFile(filepath.Join(webDir, "vercel.json"), []byte(`{}`), 0o644)
	r, _, _ := liveRunner(t, root, nil, nil)
	if _, err := newLive(t, r, root).WriteRewrite("https://x.vercel.app"); err == nil {
		t.Fatal("a missing placeholder must be an error")
	}
	b, _ := os.ReadFile(filepath.Join(webDir, "vercel.json"))
	if string(b) != `{}` {
		t.Fatalf("file changed: %s", b)
	}
}

func TestRollbackSurvivesCancelledRelease(t *testing.T) {
	f := newFake()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// Ctrl-C (or a cancelled workflow) arrives during smoke, which then fails.
	f.onSmoke = cancel
	f.smokeErr = errors.New("smoke checks failed: context canceled")
	err := stages.Release(ctx, run.New("/repo", &bytes.Buffer{}), f)
	if err == nil {
		t.Fatal("expected an error")
	}
	if len(f.rollbackCtx) != 2 {
		t.Fatalf("want both projects rolled back, got %v", f.rollbacks)
	}
	for i, c := range f.rollbackCtx {
		if c.err != nil {
			t.Errorf("rollback %d got a cancelled context: %v", i, c.err)
		}
		if !c.hasDeadline {
			t.Errorf("rollback %d context should be bounded by a timeout", i)
		}
	}
	if !strings.Contains(err.Error(), "Rolled back") {
		t.Errorf("got %v", err)
	}
}

func TestReleaseContinuesWhenDeployURLUnreadable(t *testing.T) {
	f := newFake()
	f.noURL = true
	err, out := release(t, f)
	if err != nil {
		t.Fatal(err)
	}
	if countPrefix(f.steps, "smoke") != 1 || countPrefix(f.steps, "deploy web") != 1 || len(f.rollbacks) != 0 {
		t.Fatalf("steps %v, rollbacks %v", f.steps, f.rollbacks)
	}
	if !strings.Contains(out, "eduadmin-api deployed (deployment URL not read)") {
		t.Errorf("output: %s", out)
	}
}

type ctxState struct {
	err         error
	hasDeadline bool
}
