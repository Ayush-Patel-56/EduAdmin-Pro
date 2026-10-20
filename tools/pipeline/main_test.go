package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/run"
	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/smoke"
)

func TestStageErrorRedactsSecrets(t *testing.T) {
	r := run.New(t.TempDir(), &bytes.Buffer{})
	r.Mask("tok-very-secret")
	err := errors.New(`GET https://x/?token=tok-very-secret: 500`)
	got := stageError(r, "setup", err)
	if strings.Contains(got, "tok-very-secret") {
		t.Fatalf("secret printed: %q", got)
	}
	if got != "pipeline: setup: GET https://x/?token=***: 500" {
		t.Fatalf("got %q", got)
	}
}

func TestShutdownSignalsIncludeSIGTERM(t *testing.T) {
	// GitHub Actions cancels a run with SIGTERM; it must cancel the stage
	// (so a release rolls back) rather than kill the pipeline outright.
	var interrupt, term bool
	for _, s := range shutdownSignals {
		interrupt = interrupt || s == os.Interrupt
		term = term || s == syscall.SIGTERM
	}
	if !interrupt || !term {
		t.Fatalf("shutdownSignals = %v, want os.Interrupt and SIGTERM", shutdownSignals)
	}
}

func TestValidate(t *testing.T) {
	for _, tc := range []struct {
		stage string
		args  []string
		ok    bool
	}{
		{"check", nil, true}, {"e2e", nil, true}, {"setup", nil, true},
		{"setup", []string{"x"}, false}, {"nope", nil, false},
		{"release", nil, true}, {"release", []string{"--allow-local"}, true},
		{"release", []string{"x"}, false}, {"release", []string{"--allow-local", "x"}, false},
		{"smoke", nil, false},
		{"smoke", []string{"--web", "https://w.example"}, false},
		{"smoke", []string{"--web", "https://w.example", "--api", "https://a.example"}, true},
		{"smoke", []string{"--api", "https://a.example", "--web", "https://w.example"}, true},
		{"smoke", []string{"--web=https://w.example", "--api=https://a.example"}, true},
		{"smoke", []string{"--web", "w.example", "--api", "https://a.example"}, false},
		{"smoke", []string{"--web", "https://w.example", "--api", "https://a.example", "x"}, false},
		{"smoke", []string{"--bogus"}, false},
	} {
		if err := validate(tc.stage, tc.args); (err == nil) != tc.ok {
			t.Errorf("validate(%q, %v) = %v", tc.stage, tc.args, err)
		}
	}
}

func setupEnv() map[string]string {
	return map[string]string{
		"VERCEL_TOKEN":              "vercel-token-value",
		"VERCEL_ORG_ID":             "team_x",
		"PROD_DATABASE_URL":         "postgresql://u:db-pass-value@pooler/db",
		"PROD_DIRECT_URL":           "postgresql://u:db-pass-value@direct/db",
		"PROD_SMTP_USER":            "mailer@example.com",
		"PROD_SMTP_PASS":            "smtp-pass-value",
		"PROD_MAIL_FROM":            "EduAdmin <mailer@example.com>",
		"PROD_R2_ACCOUNT_ID":        "acct",
		"PROD_R2_ACCESS_KEY_ID":     "akid-value",
		"PROD_R2_SECRET_ACCESS_KEY": "r2-secret-value",
		"PROD_R2_BUCKET":            "eduadmin-prod",
		"CRON_SECRET":               "cron-secret-value",
	}
}

func TestRunSetup(t *testing.T) {
	var mu sync.Mutex
	envByProject := map[string]map[string]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		defer mu.Unlock()
		switch {
		case r.Method == "GET" && r.URL.Path == "/v9/projects/eduadmin-api":
			io.WriteString(w, `{"id":"prj_api","name":"eduadmin-api"}`)
		case r.Method == "GET" && r.URL.Path == "/v9/projects/eduadmin-web":
			io.WriteString(w, `{"id":"prj_web","name":"eduadmin-web"}`)
		case r.Method == "PATCH":
			io.WriteString(w, `{}`)
		case r.Method == "GET" && r.URL.Path == "/v9/projects/prj_web/domains":
			io.WriteString(w, `{"domains":[{"name":"eduadmin-web.vercel.app"}]}`)
		case r.Method == "GET" && r.URL.Path == "/v9/projects/prj_api/domains":
			io.WriteString(w, `{"domains":[{"name":"eduadmin-api.vercel.app"}]}`)
		case r.Method == "POST" && r.URL.Path == "/v10/projects/prj_api/env":
			var b struct{ Key, Value string }
			json.Unmarshal(raw, &b)
			if envByProject["prj_api"] == nil {
				envByProject["prj_api"] = map[string]string{}
			}
			envByProject["prj_api"][b.Key] = b.Value
			io.WriteString(w, `{"failed":[]}`)
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer srv.Close()

	env := setupEnv()
	var out bytes.Buffer
	runner := run.New(t.TempDir(), &out)
	runner.Mask(run.MaskFromEnv(envPairs(env))...)
	err := runSetup(context.Background(), runner, &out, func(k string) string { return env[k] }, srv.URL)
	if err != nil {
		t.Fatal(err)
	}

	got := envByProject["prj_api"]
	if got["WEB_ORIGIN"] != "https://eduadmin-web.vercel.app" || got["DATABASE_URL"] != env["PROD_DATABASE_URL"] {
		t.Errorf("synced env = %v", got)
	}
	if _, ok := got["DIRECT_URL"]; ok {
		t.Error("DIRECT_URL must not be synced")
	}
	printed := out.String()
	for _, want := range []string{"eduadmin-api", "eduadmin-web", "https://eduadmin-web.vercel.app"} {
		if !strings.Contains(printed, want) {
			t.Errorf("output should mention %q:\n%s", want, printed)
		}
	}
	for _, secret := range []string{"vercel-token-value", "db-pass-value", "smtp-pass-value", "r2-secret-value", "cron-secret-value", "akid-value"} {
		if strings.Contains(printed, secret) {
			t.Errorf("output leaked %q:\n%s", secret, printed)
		}
	}
}

func TestRunSetupNeedsCredentials(t *testing.T) {
	err := runSetup(context.Background(), run.New(t.TempDir(), &bytes.Buffer{}), &bytes.Buffer{},
		func(string) string { return "" }, "http://127.0.0.1:1")
	if err == nil || !strings.Contains(err.Error(), "VERCEL_TOKEN") || !strings.Contains(err.Error(), "VERCEL_ORG_ID") {
		t.Fatalf("got %v", err)
	}
}

func envPairs(m map[string]string) []string {
	var out []string
	for k, v := range m {
		out = append(out, k+"="+v)
	}
	return out
}

func TestRunSmokeRedactsAndReports(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
	}))
	defer srv.Close()
	var out bytes.Buffer
	runner := run.New(t.TempDir(), &out)
	runner.Mask("127.0.0.1")
	smoke.Attempts, smoke.Wait = 1, 0
	defer func() { smoke.Attempts, smoke.Wait = 3, 5*time.Second }()
	err := runSmoke(context.Background(), runner, &out, nil, srv.URL, srv.URL)
	if err == nil || !strings.Contains(err.Error(), "smoke checks failed") {
		t.Fatalf("got %v", err)
	}
	if !strings.Contains(out.String(), "FAIL web shell") {
		t.Errorf("output: %s", out.String())
	}
}

func TestRunSmokePrintsNoOKWhenDown(t *testing.T) {
	// A server that is down: every check fails, nothing prints "ok".
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	var out bytes.Buffer
	smoke.Attempts, smoke.Wait = 1, 0
	defer func() { smoke.Attempts, smoke.Wait = 3, 5*time.Second }()
	if err := runSmoke(context.Background(), run.New(t.TempDir(), &out), &out, nil, url, url); err == nil {
		t.Fatal("expected failure")
	}
	if strings.Contains(out.String(), "ok   ") {
		t.Errorf("output: %s", out.String())
	}
}

func TestReleaseRefusesOutsideMain(t *testing.T) {
	for _, tc := range []struct {
		ref        string
		allowLocal bool
		ok         bool
	}{
		{"refs/heads/main", false, true},
		{"", false, false},
		{"refs/heads/deploy-pipeline", false, false},
		{"refs/heads/main-old", false, false},
		{"refs/pull/12/merge", false, false},
		{"", true, true},
		{"refs/heads/feature", true, true},
	} {
		err := checkReleaseRef(tc.ref, tc.allowLocal)
		if (err == nil) != tc.ok {
			t.Errorf("checkReleaseRef(%q, %v) = %v", tc.ref, tc.allowLocal, err)
		}
		if err != nil && !strings.Contains(err.Error(), "--allow-local") {
			t.Errorf("the refusal should say how to run it locally: %v", err)
		}
	}
}

func TestRunReleaseRefusesBeforeAnyRequest(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer srv.Close()
	env := setupEnv()
	env["GITHUB_REF"] = "refs/heads/feature"
	err := runRelease(context.Background(), run.New(t.TempDir(), &bytes.Buffer{}), t.TempDir(),
		func(k string) string { return env[k] }, nil, srv.URL)
	if err == nil || hits != 0 {
		t.Fatalf("err = %v, requests = %d", err, hits)
	}
}

func TestRunSetupAddsMissingDomain(t *testing.T) {
	var mu sync.Mutex
	var added []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		defer mu.Unlock()
		switch {
		case r.Method == "GET" && r.URL.Path == "/v9/projects/eduadmin-api":
			io.WriteString(w, `{"id":"prj_api","name":"eduadmin-api"}`)
		case r.Method == "GET" && r.URL.Path == "/v9/projects/eduadmin-web":
			io.WriteString(w, `{"id":"prj_web","name":"eduadmin-web"}`)
		case r.Method == "PATCH":
			io.WriteString(w, `{}`)
		case r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/domains"):
			proj := strings.Split(r.URL.Path, "/")[3]
			name := strings.TrimPrefix(proj, "prj_")
			for _, a := range added {
				if a == "eduadmin-"+name+".vercel.app" {
					io.WriteString(w, `{"domains":[{"name":"`+a+`"}]}`)
					return
				}
			}
			io.WriteString(w, `{"domains":[]}`)
		case r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/domains"):
			var b struct{ Name string }
			json.Unmarshal(raw, &b)
			added = append(added, b.Name)
			io.WriteString(w, `{}`)
		case r.Method == "POST" && r.URL.Path == "/v10/projects/prj_api/env":
			io.WriteString(w, `{"failed":[]}`)
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer srv.Close()
	env := setupEnv()
	var out bytes.Buffer
	if err := runSetup(context.Background(), run.New(t.TempDir(), &out), &out, func(k string) string { return env[k] }, srv.URL); err != nil {
		t.Fatal(err)
	}
	if strings.Join(added, ",") != "eduadmin-api.vercel.app,eduadmin-web.vercel.app" {
		t.Fatalf("added = %v", added)
	}
	if !strings.Contains(out.String(), "web origin https://eduadmin-web.vercel.app") {
		t.Errorf("output: %s", out.String())
	}
}
