package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/run"
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

func TestValidate(t *testing.T) {
	for _, tc := range []struct {
		stage string
		args  []string
		ok    bool
	}{
		{"check", nil, true}, {"e2e", nil, true}, {"setup", nil, true},
		{"setup", []string{"x"}, false}, {"nope", nil, false}, {"release", nil, false},
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
