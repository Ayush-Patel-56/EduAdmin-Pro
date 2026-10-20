package run_test

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/run"
)

// TestHelperProcess is not a real test: the tests below re-run the test binary
// with it so a child process can print a string and exit with a given code.
func TestHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}
	fmt.Fprintln(os.Stdout, os.Getenv("HELPER_STDOUT"))
	// HELPER_ENV_KEYS lists variables to report as set or unset (never their values).
	for _, k := range strings.Fields(os.Getenv("HELPER_ENV_KEYS")) {
		_, ok := os.LookupEnv(k)
		fmt.Fprintf(os.Stdout, "%s=%v\n", k, ok)
	}
	fmt.Fprint(os.Stderr, os.Getenv("HELPER_STDERR"))
	code := 0
	fmt.Sscanf(os.Getenv("HELPER_EXIT"), "%d", &code)
	os.Exit(code)
}

// helper runs the helper process through r.Cmd with the given settings.
func helper(r *run.Runner, extraEnv ...string) error {
	env := append([]string{"GO_WANT_HELPER_PROCESS=1"}, extraEnv...)
	return r.Cmd(context.Background(), "", env, os.Args[0], "-test.run=^TestHelperProcess$")
}

func TestMaskFromEnv(t *testing.T) {
	got := run.MaskFromEnv([]string{
		"PROD_SMTP_PASS=abc",
		"VERCEL_TOKEN=tok",
		"HOME=/h",
		"X=postgresql://u:p@h/db",
		"Y=postgres://u:p@h/db2",
		"API_KEY=key-value",
		"DB_SECRET=shh-value",
		"PROD_HOST=prod.example.com",
		"EMPTY_TOKEN=",
		"NOEQUALS",
	})
	want := []string{"abc", "tok", "postgresql://u:p@h/db", "postgres://u:p@h/db2", "key-value", "shh-value", "prod.example.com"}
	set := map[string]bool{}
	for _, v := range got {
		set[v] = true
	}
	for _, w := range want {
		if !set[w] {
			t.Errorf("MaskFromEnv missing %q; got %v", w, got)
		}
	}
	if set["/h"] {
		t.Errorf("MaskFromEnv must not return HOME; got %v", got)
	}
	if set[""] {
		t.Errorf("MaskFromEnv must not return empty values; got %v", got)
	}
}

func TestCmdMasksSecretsInChildOutput(t *testing.T) {
	var buf bytes.Buffer
	r := run.New(t.TempDir(), &buf)
	r.Mask("s3cret-value")
	if err := helper(r, "HELPER_STDOUT=out s3cret-value out", "HELPER_STDERR=err s3cret-value no-newline"); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if strings.Contains(out, "s3cret-value") {
		t.Fatalf("secret leaked: %q", out)
	}
	if !strings.Contains(out, "out *** out") || !strings.Contains(out, "err *** no-newline") {
		t.Fatalf("both streams should be masked and kept, got %q", out)
	}
}

func TestMaskLongestFirstAndIgnoresShortValues(t *testing.T) {
	var buf bytes.Buffer
	r := run.New(t.TempDir(), &buf)
	r.Mask("", "abc", "token", "token-extended")
	if err := helper(r, "HELPER_STDOUT=abc token-extended token 1"); err != nil {
		t.Fatal(err)
	}
	// "abc" is too short to mask; the long value must be replaced whole, not
	// left as "***-extended" by the shorter one matching first.
	if got := strings.TrimSpace(buf.String()); got != "abc *** *** 1" {
		t.Fatalf("got %q", got)
	}
}

func TestMaskRegistersPasswordOfDatabaseURL(t *testing.T) {
	var buf bytes.Buffer
	r := run.New(t.TempDir(), &buf)
	r.Mask("postgresql://user:hunter2-pass@host/db")
	if err := helper(r, "HELPER_STDOUT=password is hunter2-pass here"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(buf.String(), "hunter2-pass") {
		t.Fatalf("password leaked: %q", buf.String())
	}
}

func TestRedactReplacesMaskedValues(t *testing.T) {
	r := run.New(t.TempDir(), &bytes.Buffer{})
	r.Mask("s3cret-value", "abc")
	err := fmt.Errorf("GET /x: 500 body=%q", "oops s3cret-value oops abc")
	got := r.Redact(err.Error())
	if strings.Contains(got, "s3cret-value") {
		t.Fatalf("secret survived: %q", got)
	}
	if !strings.Contains(got, "oops *** oops abc") {
		t.Fatalf("expected masked text and untouched short value, got %q", got)
	}
}

func TestMaskSkipsPasswordOfLocalDatabaseURL(t *testing.T) {
	const local = "postgresql://postgres:postgres@localhost:5432/test"
	const remote = "postgresql://user:hunter2-pass@ep-1.neon.tech/db"
	var buf bytes.Buffer
	r := run.New(t.TempDir(), &buf)
	r.Mask(run.MaskFromEnv([]string{"DATABASE_URL=" + local, "PROD_DATABASE_URL=" + remote})...)

	// The throwaway local password must not turn every "postgres" into ***.
	if got := r.Redact("postgres is up on " + local); got != "postgres is up on ***" {
		t.Fatalf("local URL: got %q", got)
	}
	// A real host's password is still masked on its own.
	if got := r.Redact("bad password hunter2-pass"); got != "bad password ***" {
		t.Fatalf("remote URL: got %q", got)
	}
	for _, u := range []string{
		"postgres://u:longpassword@127.0.0.1/db",
		"postgres://u:longpassword@[::1]:5432/db",
	} {
		r := run.New(t.TempDir(), &bytes.Buffer{})
		r.Mask(u)
		if got := r.Redact("longpassword " + u); got != "longpassword ***" {
			t.Fatalf("%s: got %q", u, got)
		}
	}
}

func TestCmdReturnsErrorWithExitCode(t *testing.T) {
	var buf bytes.Buffer
	r := run.New(t.TempDir(), &buf)
	err := helper(r, "HELPER_EXIT=3", "SECRET_ENV=do-not-leak-me")
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "exit status 3") {
		t.Fatalf("error should mention exit status 3: %v", err)
	}
	if strings.Contains(err.Error(), "do-not-leak-me") {
		t.Fatalf("error leaked the env: %v", err)
	}
}

func TestOutputReturnsStdout(t *testing.T) {
	var buf bytes.Buffer
	r := run.New(t.TempDir(), &buf)
	out, err := r.Output(context.Background(), "", []string{"GO_WANT_HELPER_PROCESS=1", "HELPER_STDOUT=hello"}, os.Args[0], "-test.run=^TestHelperProcess$")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(out) != "hello" {
		t.Fatalf("got %q", out)
	}
}

func TestExecHookReceivesCommandWithEnvAndDir(t *testing.T) {
	root := t.TempDir()
	r := run.New(root, &bytes.Buffer{})
	var got *exec.Cmd
	r.Exec = func(cmd *exec.Cmd) error { got = cmd; return nil }
	if err := r.Cmd(context.Background(), "sub", []string{"TZ=Asia/Kolkata"}, "pnpm", "lint"); err != nil {
		t.Fatal(err)
	}
	if got == nil || len(got.Args) != 2 || got.Args[1] != "lint" {
		t.Fatalf("unexpected command: %+v", got)
	}
	if !strings.HasSuffix(strings.ReplaceAll(got.Dir, "\\", "/"), "/sub") {
		t.Fatalf("dir should be relative to the root, got %q", got.Dir)
	}
	found := false
	for _, e := range got.Env {
		if e == "TZ=Asia/Kolkata" {
			found = true
		}
	}
	if !found {
		t.Fatal("TZ not in child env")
	}
}

func TestCmdChildDoesNotInheritSecrets(t *testing.T) {
	t.Setenv("PROD_X", "prod-x-value")
	t.Setenv("VERCEL_TOKEN", "parent-token")
	t.Setenv("CRON_SECRET", "cron-value")
	t.Setenv("SOME_API_KEY", "key-value")
	t.Setenv("SMTP_PASS", "pass-value")
	t.Setenv("PIPELINE_PLAIN", "plain")
	var buf bytes.Buffer
	r := run.New(t.TempDir(), &buf)
	keys := "PROD_X VERCEL_TOKEN CRON_SECRET SOME_API_KEY SMTP_PASS PIPELINE_PLAIN PATH PROD_PASSED"
	if err := helper(r, "HELPER_ENV_KEYS="+keys, "PROD_PASSED=explicit"); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	for _, want := range []string{
		"PROD_X=false", "VERCEL_TOKEN=false", "CRON_SECRET=false", "SOME_API_KEY=false", "SMTP_PASS=false",
		"PIPELINE_PLAIN=true", "PATH=true", "PROD_PASSED=true",
	} {
		if !strings.Contains(out, want+"\n") {
			t.Errorf("child env: want %s, got %q", want, out)
		}
	}

	// A secret the call passes explicitly does reach the child.
	buf.Reset()
	if err := helper(r, "HELPER_ENV_KEYS=VERCEL_TOKEN", "VERCEL_TOKEN=explicit-token"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "VERCEL_TOKEN=true\n") {
		t.Errorf("an explicitly passed VERCEL_TOKEN must reach the child, got %q", buf.String())
	}
}

func TestCommandSetsWaitDelay(t *testing.T) {
	r := run.New(t.TempDir(), &bytes.Buffer{})
	var got *exec.Cmd
	r.Exec = func(cmd *exec.Cmd) error { got = cmd; return nil }
	if err := r.Cmd(context.Background(), "", nil, "pnpm", "lint"); err != nil {
		t.Fatal(err)
	}
	if got.WaitDelay <= 0 || got.WaitDelay != run.WaitDelay {
		t.Fatalf("WaitDelay = %v, want %v so a grandchild holding the pipe can't stall the pipeline", got.WaitDelay, run.WaitDelay)
	}
}

func TestStageOutput(t *testing.T) {
	t.Setenv("GITHUB_ACTIONS", "")
	var plain bytes.Buffer
	run.New("", &plain).Stage("lint")
	if plain.String() != "==> lint\n" {
		t.Fatalf("got %q", plain.String())
	}

	t.Setenv("GITHUB_ACTIONS", "true")
	var gh bytes.Buffer
	r := run.New("", &gh)
	r.Stage("one")
	r.Stage("two")
	r.Close()
	want := "::group::one\n==> one\n::endgroup::\n::group::two\n==> two\n::endgroup::\n"
	if gh.String() != want {
		t.Fatalf("got %q want %q", gh.String(), want)
	}
}

func TestMaskEmitsAddMaskOnGitHubActions(t *testing.T) {
	t.Setenv("GITHUB_ACTIONS", "true")
	var buf bytes.Buffer
	r := run.New("", &buf)
	r.Mask("s3cret-value", "xy")
	// The marker line itself must not be masked into "::add-mask::***".
	if buf.String() != "::add-mask::s3cret-value\n" {
		t.Fatalf("got %q", buf.String())
	}
}

func TestTeeStreamsMaskedAndReturnsBothStreams(t *testing.T) {
	var buf bytes.Buffer
	r := run.New(t.TempDir(), &buf)
	r.Mask("hunter2-secret")
	out, err := r.Tee(context.Background(), "", []string{"GO_WANT_HELPER_PROCESS=1",
		"HELPER_STDOUT=out hunter2-secret", "HELPER_STDERR=lock timeout\n", "HELPER_EXIT=1"},
		os.Args[0], "-test.run=^TestHelperProcess$")
	if err == nil {
		t.Fatal("expected the exit status as an error")
	}
	if !strings.Contains(out, "out hunter2-secret") || !strings.Contains(out, "lock timeout") {
		t.Fatalf("Tee should return stdout and stderr, got %q", out)
	}
	if strings.Contains(buf.String(), "hunter2-secret") || !strings.Contains(buf.String(), "out ***") {
		t.Fatalf("streamed output not masked: %q", buf.String())
	}
	if !strings.Contains(buf.String(), "lock timeout") {
		t.Fatalf("stderr should stream too: %q", buf.String())
	}
}

func TestPrintfMasks(t *testing.T) {
	var buf bytes.Buffer
	r := run.New(t.TempDir(), &buf)
	r.Mask("hunter2-secret")
	r.Printf("value %s and %d", "hunter2-secret", 3)
	if buf.String() != "value *** and 3\n" {
		t.Fatalf("got %q", buf.String())
	}
}
