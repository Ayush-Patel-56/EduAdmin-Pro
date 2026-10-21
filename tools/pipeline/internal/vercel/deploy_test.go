package vercel_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"testing"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/run"
	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/vercel"
)

func TestEnsureDomainKeepsExistingDomain(t *testing.T) {
	c, reqs := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"domains":[{"name":"eduadmin-web.vercel.app"}]}`)
	})
	if err := c.EnsureDomain(context.Background(), "prj_web", "eduadmin-web"); err != nil {
		t.Fatal(err)
	}
	got := reqs()
	if len(got) != 1 || got[0].Method != "GET" || got[0].Path != "/v9/projects/prj_web/domains" {
		t.Fatalf("want one GET of the domains, got %+v", got)
	}
}

func TestEnsureDomainAddsProjectDomain(t *testing.T) {
	c, reqs := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			io.WriteString(w, `{"domains":[{"name":"example.com"}]}`)
			return
		}
		io.WriteString(w, `{"name":"eduadmin-api.vercel.app","verified":true}`)
	})
	if err := c.EnsureDomain(context.Background(), "prj_api", "eduadmin-api"); err != nil {
		t.Fatal(err)
	}
	got := reqs()
	if len(got) != 2 || got[1].Method != "POST" || got[1].Path != "/v10/projects/prj_api/domains" {
		t.Fatalf("want GET then POST /v10/projects/prj_api/domains, got %+v", got)
	}
	if got[1].Body["name"] != "eduadmin-api.vercel.app" || len(got[1].Body) != 1 {
		t.Fatalf("body = %v", got[1].Body)
	}
	if got[1].Query["teamId"] == nil || got[1].Query["teamId"][0] != "team_x" {
		t.Fatalf("teamId = %v", got[1].Query["teamId"])
	}
}

func TestEnsureDomainRefusedSaysRenameTheProject(t *testing.T) {
	c, _ := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			io.WriteString(w, `{"domains":[]}`)
			return
		}
		w.WriteHeader(http.StatusConflict)
		io.WriteString(w, `{"error":{"code":"domain_taken","message":"owned by someone-private@example.com"}}`)
	})
	err := c.EnsureDomain(context.Background(), "prj_api", "eduadmin-api")
	if err == nil {
		t.Fatal("expected an error")
	}
	msg := err.Error()
	for _, want := range []string{"eduadmin-api.vercel.app", "rename", "409"} {
		if !strings.Contains(msg, want) {
			t.Errorf("error %q should contain %q", msg, want)
		}
	}
	if strings.Contains(msg, "someone-private") {
		t.Errorf("error leaked the response body: %q", msg)
	}
}

func TestRolledBack(t *testing.T) {
	for _, tc := range []struct {
		body string
		want bool
	}{
		{`{"id":"prj_1","lastAliasRequest":{"type":"rollback","jobStatus":"succeeded","fromDeploymentId":"dpl_b","toDeploymentId":"dpl_a","requestedAt":1}}`, true},
		{`{"id":"prj_1","lastAliasRequest":{"type":"rollback","jobStatus":"in-progress"}}`, true},
		{`{"id":"prj_1","lastAliasRequest":{"type":"rollback","jobStatus":"pending"}}`, true},
		{`{"id":"prj_1","lastAliasRequest":{"type":"rollback","jobStatus":"failed"}}`, false},
		{`{"id":"prj_1","lastAliasRequest":{"type":"rollback","jobStatus":"skipped"}}`, false},
		{`{"id":"prj_1","lastAliasRequest":{"type":"promote","jobStatus":"succeeded"}}`, false},
		{`{"id":"prj_1","lastAliasRequest":null}`, false},
		{`{"id":"prj_1"}`, false},
		// lastRollbackTarget is ignored either way.
		{`{"id":"prj_1","lastRollbackTarget":{},"lastAliasRequest":{"type":"promote","jobStatus":"succeeded"}}`, false},
		{`{"id":"prj_1","lastRollbackTarget":null,"lastAliasRequest":{"type":"rollback","jobStatus":"succeeded"}}`, true},
	} {
		c, reqs := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
			io.WriteString(w, tc.body)
		})
		got, err := c.RolledBack(context.Background(), "prj_1")
		if err != nil {
			t.Fatal(err)
		}
		if got != tc.want {
			t.Errorf("RolledBack(%s) = %v, want %v", tc.body, got, tc.want)
		}
		if r := reqs()[0]; r.Method != "GET" || r.Path != "/v9/projects/prj_1" {
			t.Errorf("request = %s %s", r.Method, r.Path)
		}
	}
}

func TestPreviousProductionIsWhatTheDomainServes(t *testing.T) {
	c, reqs := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/domains") {
			io.WriteString(w, `{"domains":[{"name":"eduadmin-web-team.vercel.app"},{"name":"eduadmin-web.vercel.app"}]}`)
			return
		}
		io.WriteString(w, `{"alias":"eduadmin-web.vercel.app","deploymentId":"dpl_live","projectId":"prj_1","uid":"a1"}`)
	})
	id, ok, err := c.PreviousProduction(context.Background(), "prj_1")
	if err != nil || !ok || id != "dpl_live" {
		t.Fatalf("got %q %v %v", id, ok, err)
	}
	got := reqs()
	if len(got) != 2 {
		t.Fatalf("requests: %+v", got)
	}
	if got[1].Method != "GET" || got[1].Path != "/v4/aliases/eduadmin-web.vercel.app" {
		t.Fatalf("request = %s %s", got[1].Method, got[1].Path)
	}
	if got[1].Query["projectId"] == nil || got[1].Query["projectId"][0] != "prj_1" {
		t.Errorf("projectId = %v", got[1].Query["projectId"])
	}
}

func TestPreviousProductionNoneYet(t *testing.T) {
	for name, respond := range map[string]func(w http.ResponseWriter, r *http.Request){
		"no domain": func(w http.ResponseWriter, r *http.Request) {
			io.WriteString(w, `{"domains":[]}`)
		},
		"alias not found": func(w http.ResponseWriter, r *http.Request) {
			if strings.HasSuffix(r.URL.Path, "/domains") {
				io.WriteString(w, `{"domains":[{"name":"eduadmin-api.vercel.app"}]}`)
				return
			}
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, `{"error":{"code":"not_found"}}`)
		},
		"alias without deployment": func(w http.ResponseWriter, r *http.Request) {
			if strings.HasSuffix(r.URL.Path, "/domains") {
				io.WriteString(w, `{"domains":[{"name":"eduadmin-api.vercel.app"}]}`)
				return
			}
			io.WriteString(w, `{"alias":"eduadmin-api.vercel.app","deploymentId":null}`)
		},
	} {
		c, _ := fakeVercel(t, respond)
		id, ok, err := c.PreviousProduction(context.Background(), "prj_1")
		if err != nil || ok || id != "" {
			t.Errorf("%s: got %q %v %v", name, id, ok, err)
		}
	}
}

func TestPreviousProductionPassesOtherErrors(t *testing.T) {
	c, _ := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/domains") {
			io.WriteString(w, `{"domains":[{"name":"eduadmin-api.vercel.app"}]}`)
			return
		}
		w.WriteHeader(http.StatusForbidden)
	})
	if _, _, err := c.PreviousProduction(context.Background(), "prj_1"); err == nil {
		t.Fatal("a 403 must be an error, not 'no deployment'")
	}
}

func TestRollbackPostsToRollbackEndpoint(t *testing.T) {
	c, reqs := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})
	if err := c.Rollback(context.Background(), "prj_1", "dpl_a"); err != nil {
		t.Fatal(err)
	}
	r := reqs()[0]
	if r.Method != "POST" || r.Path != "/v1/projects/prj_1/rollback/dpl_a" {
		t.Fatalf("request = %s %s", r.Method, r.Path)
	}
}

func TestRollbackErrorHasNoBody(t *testing.T) {
	c, _ := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusPaymentRequired)
		io.WriteString(w, `{"error":{"code":"plan","message":"private detail"}}`)
	})
	err := c.Rollback(context.Background(), "prj_1", "dpl_a")
	if err == nil || strings.Contains(err.Error(), "private detail") || !strings.Contains(err.Error(), "402") {
		t.Fatalf("got %v", err)
	}
}

type cmdRec struct {
	args []string
	dir  string
	env  []string
}

func deployRunner(stdout string, failOn string) (*run.Runner, *[]cmdRec, *bytes.Buffer) {
	var out bytes.Buffer
	r := run.New("/repo", &out)
	var cmds []cmdRec
	r.Exec = func(cmd *exec.Cmd) error {
		cmds = append(cmds, cmdRec{args: cmd.Args, dir: cmd.Dir, env: cmd.Env})
		line := strings.Join(cmd.Args, " ")
		if failOn != "" && strings.Contains(line, failOn) {
			return errors.New("exit status 1")
		}
		if strings.Contains(line, " deploy ") && cmd.Stdout != nil {
			io.WriteString(cmd.Stdout, stdout)
		}
		return nil
	}
	return r, &cmds, &out
}

func TestDeployRunsPinnedCLIWithTokenInEnvOnly(t *testing.T) {
	r, cmds, _ := deployRunner("Vercel CLI 62.7.0\nhttps://eduadmin-api-abc123-team.vercel.app\n", "")
	url, err := vercel.Deploy(context.Background(), r, "prj_api", "team_x", "secret-token-value")
	if err != nil {
		t.Fatal(err)
	}
	if url != "https://eduadmin-api-abc123-team.vercel.app" {
		t.Fatalf("url = %q", url)
	}
	want := []string{
		"pnpm dlx vercel@62.7.0 pull --yes --environment=production",
		"pnpm dlx vercel@62.7.0 build --prod",
		"pnpm dlx vercel@62.7.0 deploy --prebuilt --prod",
	}
	if len(*cmds) != len(want) {
		t.Fatalf("got %d commands: %+v", len(*cmds), *cmds)
	}
	if vercel.VercelCLIVersion != "62.7.0" {
		t.Fatalf("VercelCLIVersion = %q", vercel.VercelCLIVersion)
	}
	for i, c := range *cmds {
		line := strings.Join(c.args, " ")
		if line != want[i] {
			t.Errorf("command %d = %q, want %q", i, line, want[i])
		}
		if strings.Contains(line, "secret-token-value") {
			t.Errorf("token on the command line: %q", line)
		}
		if strings.ReplaceAll(c.dir, "\\", "/") != "/repo" {
			t.Errorf("command %d dir = %q, want the repo root", i, c.dir)
		}
		for _, kv := range []string{"VERCEL_TOKEN=secret-token-value", "VERCEL_PROJECT_ID=prj_api", "VERCEL_ORG_ID=team_x"} {
			if !hasKV(c.env, kv) {
				t.Errorf("command %d env lacks %s", i, strings.SplitN(kv, "=", 2)[0])
			}
		}
	}
}

func TestDeployTakesLastURLLine(t *testing.T) {
	r, _, _ := deployRunner("https://first.vercel.app\nsome text https://not-a-line.vercel.app\nhttps://second.vercel.app\n\n", "")
	url, err := vercel.Deploy(context.Background(), r, "p", "o", "tok-1234")
	if err != nil || url != "https://second.vercel.app" {
		t.Fatalf("got %q %v", url, err)
	}
}

func TestDeployWithoutURLStillSucceeds(t *testing.T) {
	// The CLI exited 0, so the deployment exists: a missing URL is a warning.
	r, _, out := deployRunner("nothing useful\n", "")
	url, err := vercel.Deploy(context.Background(), r, "p", "o", "tok-1234")
	if err != nil || url != "" {
		t.Fatalf("got %q %v", url, err)
	}
	if !strings.Contains(out.String(), "::warning::") || !strings.Contains(out.String(), "URL") {
		t.Fatalf("expected a warning, output: %q", out.String())
	}
}

func TestDeployStopsAtFirstFailure(t *testing.T) {
	r, cmds, _ := deployRunner("", " build ")
	_, err := vercel.Deploy(context.Background(), r, "p", "o", "tok-1234")
	if err == nil {
		t.Fatal("expected an error")
	}
	if len(*cmds) != 2 {
		t.Fatalf("deploy must not run after a failed build: %+v", *cmds)
	}
}

func hasKV(env []string, kv string) bool {
	for _, e := range env {
		if e == kv {
			return true
		}
	}
	return false
}
