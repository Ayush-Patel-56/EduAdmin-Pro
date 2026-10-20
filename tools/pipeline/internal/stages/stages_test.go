package stages_test

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/run"
	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/stages"
)

type recorded struct {
	line string // "name arg arg"
	dir  string
	env  []string
}

// recorder returns a runner whose commands are recorded, not executed. stdout
// maps a command line to what that command "prints".
func recorder(stdout map[string]string) (*run.Runner, *[]recorded) {
	r := run.New("/repo", &bytes.Buffer{})
	var cmds []recorded
	r.Exec = func(cmd *exec.Cmd) error {
		line := strings.Join(cmd.Args, " ")
		cmds = append(cmds, recorded{line: line, dir: cmd.Dir, env: cmd.Env})
		if s, ok := stdout[line]; ok && cmd.Stdout != nil {
			cmd.Stdout.Write([]byte(s))
		}
		return nil
	}
	return r, &cmds
}

func lines(cmds []recorded) []string {
	var out []string
	for _, c := range cmds {
		out = append(out, c.line)
	}
	return out
}

func hasEnv(c recorded, kv string) bool {
	for _, e := range c.env {
		if e == kv {
			return true
		}
	}
	return false
}

func TestE2ERefusesNonLocalDatabase(t *testing.T) {
	for _, u := range []string{
		"postgresql://u:p@ep-x.neon.tech/db",
		"postgresql://u:p@localhost.evil.com/db",
		"postgresql://u:p@10.0.0.5/db",
		"",
		"not a url \x7f",
	} {
		r, cmds := recorder(nil)
		err := stages.E2E(context.Background(), r, u)
		if err == nil || !strings.Contains(err.Error(), "throwaway") {
			t.Errorf("E2E(%q) should refuse with a 'throwaway' error, got %v", u, err)
		}
		if len(*cmds) != 0 {
			t.Errorf("E2E(%q) ran commands: %v", u, lines(*cmds))
		}
		if err != nil && strings.Contains(err.Error(), "p@") {
			t.Errorf("error leaks the credentials: %v", err)
		}
	}
}

func TestE2EAllowsLocalDatabases(t *testing.T) {
	for _, u := range []string{
		"postgresql://postgres:postgres@localhost:5432/eduadmin",
		"postgres://postgres:postgres@127.0.0.1:5432/eduadmin",
		"postgresql://postgres:postgres@[::1]:5432/eduadmin",
	} {
		r, cmds := recorder(nil)
		if err := stages.E2E(context.Background(), r, u); err != nil {
			t.Fatalf("E2E(%q): %v", u, err)
		}
		want := []string{
			"pnpm --filter api exec prisma migrate deploy",
			"pnpm --filter api test:e2e",
			"pnpm --filter api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code",
		}
		got := lines(*cmds)
		if strings.Join(got, "\n") != strings.Join(want, "\n") {
			t.Fatalf("commands:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
		}
		for _, c := range *cmds {
			if !hasEnv(c, "DATABASE_URL="+u) || !hasEnv(c, "DIRECT_URL="+u) {
				t.Errorf("%q missing DATABASE_URL/DIRECT_URL in env", c.line)
			}
		}
	}
}

func TestCheckRunsEverySuite(t *testing.T) {
	before, had := os.LookupEnv("TZ")
	r, cmds := recorder(nil)
	if err := stages.Check(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"pnpm --filter api exec tsc --noEmit",
		"pnpm --filter web exec tsc -b",
		"pnpm lint",
		"pnpm --filter api test",
		"pnpm --filter web test",
		"pnpm --filter web test",
		"pnpm --filter web test",
		"pnpm build",
		"go vet ./...",
		"gofmt -l .",
		"go test ./...",
	}
	got := lines(*cmds)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("commands:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}

	// Web tests run once per timezone, set on the child only.
	tzs := []string{"TZ=Asia/Kolkata", "TZ=America/Los_Angeles", "TZ=Pacific/Kiritimati"}
	n := 0
	for _, c := range *cmds {
		if c.line != "pnpm --filter web test" {
			continue
		}
		if !hasEnv(c, tzs[n]) {
			t.Errorf("web test #%d should run with %s, env has no such entry", n+1, tzs[n])
		}
		n++
	}
	for _, c := range (*cmds)[:4] {
		for _, e := range c.env {
			if strings.HasPrefix(e, "TZ=") && !strings.Contains(os.Getenv("TZ"), e[3:]) {
				t.Errorf("%q should not have its TZ forced", c.line)
			}
		}
	}
	if after, has := os.LookupEnv("TZ"); after != before || has != had {
		t.Errorf("Check changed the parent TZ: %q -> %q", before, after)
	}

	// The Go checks run inside tools/pipeline; everything else at the root.
	for _, c := range (*cmds)[8:] {
		if !strings.HasSuffix(strings.ReplaceAll(c.dir, "\\", "/"), "tools/pipeline") {
			t.Errorf("%q should run in tools/pipeline, ran in %q", c.line, c.dir)
		}
	}
	for _, c := range (*cmds)[:8] {
		if strings.ReplaceAll(c.dir, "\\", "/") != "/repo" {
			t.Errorf("%q should run in the repo root, ran in %q", c.line, c.dir)
		}
	}
}

func TestCheckFailsWhenGofmtListsFiles(t *testing.T) {
	r, cmds := recorder(map[string]string{"gofmt -l .": "main.go\n"})
	err := stages.Check(context.Background(), r)
	if err == nil || !strings.Contains(err.Error(), "gofmt") || !strings.Contains(err.Error(), "main.go") {
		t.Fatalf("expected a gofmt error naming main.go, got %v", err)
	}
	for _, c := range *cmds {
		if c.line == "go test ./..." {
			t.Fatal("go test ran after gofmt failed")
		}
	}
}

func TestCheckStopsAtFirstFailure(t *testing.T) {
	r := run.New("/repo", &bytes.Buffer{})
	var n int
	r.Exec = func(cmd *exec.Cmd) error {
		n++
		return exec.ErrNotFound
	}
	if err := stages.Check(context.Background(), r); err == nil {
		t.Fatal("expected an error")
	}
	if n != 1 {
		t.Fatalf("ran %d commands, want 1", n)
	}
}
