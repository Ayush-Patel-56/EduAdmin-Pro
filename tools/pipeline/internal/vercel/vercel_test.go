package vercel_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/vercel"
)

type recorded struct {
	Method string
	Path   string
	Query  map[string][]string
	Header http.Header
	Body   map[string]any
}

// fakeVercel records every request and answers with respond.
func fakeVercel(t *testing.T, respond func(w http.ResponseWriter, r *http.Request)) (*vercel.Client, func() []recorded) {
	t.Helper()
	var mu sync.Mutex
	var got []recorded
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		rec := recorded{Method: r.Method, Path: r.URL.Path, Query: r.URL.Query(), Header: r.Header}
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &rec.Body); err != nil {
				t.Errorf("request body is not a JSON object: %s", raw)
			}
		}
		mu.Lock()
		got = append(got, rec)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		respond(w, r)
	}))
	t.Cleanup(srv.Close)
	return vercel.NewClient("tok", "team_x", srv.URL), func() []recorded {
		mu.Lock()
		defer mu.Unlock()
		return append([]recorded(nil), got...)
	}
}

func TestEnsureProjectCreatesThenPatches(t *testing.T) {
	c, reqs := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, `{"error":{"code":"not_found","message":"Project not found"}}`)
		default:
			io.WriteString(w, `{"id":"prj_1","name":"eduadmin-api"}`)
		}
	})
	p, err := c.EnsureProject(context.Background(), vercel.APISpec)
	if err != nil {
		t.Fatal(err)
	}
	if p.ID != "prj_1" || p.Name != "eduadmin-api" {
		t.Fatalf("project = %+v", p)
	}

	got := reqs()
	if len(got) != 3 {
		t.Fatalf("want GET, POST, PATCH; got %d requests: %+v", len(got), got)
	}
	want := []struct{ method, path string }{
		{"GET", "/v9/projects/eduadmin-api"},
		{"POST", "/v11/projects"},
		{"PATCH", "/v9/projects/prj_1"},
	}
	for i, w := range want {
		if got[i].Method != w.method || got[i].Path != w.path {
			t.Errorf("request %d = %s %s, want %s %s", i, got[i].Method, got[i].Path, w.method, w.path)
		}
	}
	for i, r := range got {
		if r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("request %d Authorization = %q", i, r.Header.Get("Authorization"))
		}
		if r.Query["teamId"] == nil || r.Query["teamId"][0] != "team_x" {
			t.Errorf("request %d teamId = %v", i, r.Query["teamId"])
		}
	}
	for _, i := range []int{1, 2} {
		b := got[i].Body
		if b["rootDirectory"] != "apps/api" || b["framework"] != "nestjs" {
			t.Errorf("request %d body = %v", i, b)
		}
	}
	if got[1].Body["name"] != "eduadmin-api" {
		t.Errorf("create body = %v", got[1].Body)
	}
	if got[2].Body["nodeVersion"] != "22.x" {
		t.Errorf("patch body = %v", got[2].Body)
	}
}

func TestEnsureProjectSkipsCreateWhenItExists(t *testing.T) {
	c, reqs := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"id":"prj_9","name":"eduadmin-web"}`)
	})
	p, err := c.EnsureProject(context.Background(), vercel.WebSpec)
	if err != nil {
		t.Fatal(err)
	}
	if p.ID != "prj_9" {
		t.Fatalf("project = %+v", p)
	}
	got := reqs()
	if len(got) != 2 || got[0].Method != "GET" || got[1].Method != "PATCH" || got[1].Path != "/v9/projects/prj_9" {
		t.Fatalf("want GET then PATCH, got %+v", got)
	}
	if got[1].Body["framework"] != "vite" || got[1].Body["rootDirectory"] != "apps/web" {
		t.Fatalf("patch body = %v", got[1].Body)
	}
}

func TestErrorHasMethodPathStatusButNoBodyOrValues(t *testing.T) {
	c, _ := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		io.WriteString(w, `{"error":{"code":"forbidden","message":"echo of super-secret-value"}}`)
	})
	err := c.SyncEnv(context.Background(), "prj_1", map[string]string{"SMTP_PASS": "super-secret-value"})
	if err == nil {
		t.Fatal("expected an error")
	}
	msg := err.Error()
	for _, want := range []string{"POST", "/v10/projects/prj_1/env", "403"} {
		if !strings.Contains(msg, want) {
			t.Errorf("error %q should contain %q", msg, want)
		}
	}
	if strings.Contains(msg, "super-secret-value") {
		t.Errorf("error leaked a value: %q", msg)
	}
}

func TestSyncEnvSendsSensitiveProductionOnly(t *testing.T) {
	c, reqs := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		io.WriteString(w, `{"created":{},"failed":[]}`)
	})
	vars := map[string]string{"DATABASE_URL": "postgres://a", "NODE_ENV": "production", "CRON_SECRET": "abc"}
	if err := c.SyncEnv(context.Background(), "prj_1", vars); err != nil {
		t.Fatal(err)
	}
	got := reqs()
	if len(got) != len(vars) {
		t.Fatalf("want one call per key, got %d", len(got))
	}
	seen := map[string]string{}
	for _, r := range got {
		if r.Method != "POST" || r.Path != "/v10/projects/prj_1/env" {
			t.Errorf("unexpected request %s %s", r.Method, r.Path)
		}
		if r.Query["upsert"] == nil || r.Query["upsert"][0] != "true" {
			t.Errorf("upsert query = %v", r.Query["upsert"])
		}
		if r.Body["type"] != "sensitive" {
			t.Errorf("type = %v", r.Body["type"])
		}
		target, _ := r.Body["target"].([]any)
		if len(target) != 1 || target[0] != "production" {
			t.Errorf("target = %v", r.Body["target"])
		}
		seen[r.Body["key"].(string)] = r.Body["value"].(string)
	}
	for k, v := range vars {
		if seen[k] != v {
			t.Errorf("%s = %q, want %q", k, seen[k], v)
		}
	}
}

func TestSyncEnvReportsFailedKeysWithoutValues(t *testing.T) {
	c, _ := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		io.WriteString(w, `{"failed":[{"error":{"code":"bad_request","message":"bad value hunter2-pass","value":"hunter2-pass"}}]}`)
	})
	err := c.SyncEnv(context.Background(), "prj_1", map[string]string{"SMTP_PASS": "hunter2-pass"})
	if err == nil {
		t.Fatal("a failed entry in a 2xx response must be an error")
	}
	if !strings.Contains(err.Error(), "SMTP_PASS") || strings.Contains(err.Error(), "hunter2-pass") {
		t.Fatalf("error should name the key and not the value: %v", err)
	}
}

func TestProductionOrigin(t *testing.T) {
	c, reqs := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"domains":[
			{"name":"eduadmin-web-team.vercel.app","verified":true},
			{"name":"old.vercel.app","verified":true,"redirect":"eduadmin-web.vercel.app"},
			{"name":"example.com","verified":true},
			{"name":"eduadmin-web.vercel.app","verified":true}
		],"pagination":{"count":4}}`)
	})
	got, err := c.ProductionOrigin(context.Background(), "prj_2")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://eduadmin-web.vercel.app" {
		t.Fatalf("origin = %q", got)
	}
	r := reqs()[0]
	if r.Method != "GET" || r.Path != "/v9/projects/prj_2/domains" {
		t.Fatalf("request = %s %s", r.Method, r.Path)
	}
	if r.Query["production"] == nil || r.Query["production"][0] != "true" {
		t.Fatalf("query = %v", r.Query)
	}
}

func TestProductionOriginErrorsWithoutVercelAppDomain(t *testing.T) {
	c, _ := fakeVercel(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"domains":[{"name":"example.com"}],"pagination":{"count":1}}`)
	})
	if _, err := c.ProductionOrigin(context.Background(), "prj_2"); err == nil {
		t.Fatal("expected an error")
	}
}

func envOf(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestAPIEnvListsMissingSecrets(t *testing.T) {
	_, err := vercel.APIEnv(envOf(map[string]string{"PROD_DATABASE_URL": "postgres://x"}), "https://web.vercel.app")
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, name := range []string{"PROD_DIRECT_URL", "PROD_SMTP_USER", "PROD_SMTP_PASS", "PROD_MAIL_FROM",
		"PROD_R2_ACCOUNT_ID", "PROD_R2_ACCESS_KEY_ID", "PROD_R2_SECRET_ACCESS_KEY", "PROD_R2_BUCKET", "CRON_SECRET"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error should list %s: %v", name, err)
		}
	}
	if strings.Contains(err.Error(), "PROD_DATABASE_URL") {
		t.Errorf("PROD_DATABASE_URL is set and must not be listed: %v", err)
	}
}

func fullEnv() map[string]string {
	return map[string]string{
		"PROD_DATABASE_URL":         "postgresql://u:p@pooler/db",
		"PROD_DIRECT_URL":           "postgresql://u:p@direct/db",
		"PROD_SMTP_USER":            "mailer@example.com",
		"PROD_SMTP_PASS":            "smtp-pass",
		"PROD_MAIL_FROM":            "EduAdmin <mailer@example.com>",
		"PROD_R2_ACCOUNT_ID":        "acct",
		"PROD_R2_ACCESS_KEY_ID":     "akid",
		"PROD_R2_SECRET_ACCESS_KEY": "r2-secret",
		"PROD_R2_BUCKET":            "eduadmin-prod",
		"CRON_SECRET":               "cron-secret",
	}
}

func TestAPIEnvValues(t *testing.T) {
	env, err := vercel.APIEnv(envOf(fullEnv()), "https://eduadmin-web.vercel.app/")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"NODE_ENV":                   "production",
		"DATABASE_URL":               "postgresql://u:p@pooler/db",
		"WEB_ORIGIN":                 "https://eduadmin-web.vercel.app",
		"TRUST_PROXY":                "1",
		"REQUIRE_EMAIL_VERIFICATION": "true",
		"SMTP_HOST":                  "smtp.gmail.com",
		"SMTP_PORT":                  "465",
		"SMTP_USER":                  "mailer@example.com",
		"SMTP_PASS":                  "smtp-pass",
		"MAIL_FROM":                  "EduAdmin <mailer@example.com>",
		"R2_ACCOUNT_ID":              "acct",
		"R2_ACCESS_KEY_ID":           "akid",
		"R2_SECRET_ACCESS_KEY":       "r2-secret",
		"R2_BUCKET":                  "eduadmin-prod",
		"DIGEST_ENABLED":             "true",
		"DIGEST_HOUR_IST":            "19",
		"CRON_SECRET":                "cron-secret",
	}
	for k, v := range want {
		if env[k] != v {
			t.Errorf("%s = %q, want %q", k, env[k], v)
		}
	}
	if len(env) != len(want) {
		t.Errorf("unexpected extra variables: %v", env)
	}
	if _, ok := env["DIRECT_URL"]; ok {
		t.Error("DIRECT_URL is for migrations only and must not be sent to the API project")
	}
}

func TestAPIEnvTrustProxyFromEnvironment(t *testing.T) {
	m := fullEnv()
	m["TRUST_PROXY"] = "2"
	env, err := vercel.APIEnv(envOf(m), "https://w.vercel.app")
	if err != nil {
		t.Fatal(err)
	}
	if env["TRUST_PROXY"] != "2" {
		t.Fatalf("TRUST_PROXY = %q", env["TRUST_PROXY"])
	}
	m["TRUST_PROXY"] = "one"
	if _, err := vercel.APIEnv(envOf(m), "https://w.vercel.app"); err == nil {
		t.Fatal("a non-numeric TRUST_PROXY must be refused (the API would not boot)")
	}
}

func TestAPIEnvDigestEnabledFromEnvironment(t *testing.T) {
	m := fullEnv()
	for _, tc := range []struct{ in, want string }{{"", "true"}, {"true", "true"}, {"false", "false"}, {" false ", "false"}} {
		m["DIGEST_ENABLED"] = tc.in
		env, err := vercel.APIEnv(envOf(m), "https://w.vercel.app")
		if err != nil {
			t.Fatalf("DIGEST_ENABLED=%q: %v", tc.in, err)
		}
		if env["DIGEST_ENABLED"] != tc.want {
			t.Errorf("DIGEST_ENABLED=%q gave %q, want %q", tc.in, env["DIGEST_ENABLED"], tc.want)
		}
	}
	for _, bad := range []string{"no", "False", "0", "off"} {
		m["DIGEST_ENABLED"] = bad
		if _, err := vercel.APIEnv(envOf(m), "https://w.vercel.app"); err == nil {
			t.Errorf("DIGEST_ENABLED=%q must be refused: the API only treats exactly \"false\" as off", bad)
		}
	}
}

func TestAPIEnvNeedsWebOrigin(t *testing.T) {
	if _, err := vercel.APIEnv(envOf(fullEnv()), ""); err == nil {
		t.Fatal("expected an error for an empty web origin")
	}
}

func TestWriteRewriteTrimsSlash(t *testing.T) {
	dir := t.TempDir()
	src := `{"rewrites":[{"source":"/api/:path*","destination":"__API_ORIGIN__/api/:path*"}]}`
	path := filepath.Join(dir, "vercel.json")
	if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := vercel.WriteRewrite(dir, "https://eduadmin-api.vercel.app/"); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(path)
	if !strings.Contains(string(b), `"https://eduadmin-api.vercel.app/api/:path*"`) {
		t.Fatalf("got %s", b)
	}
	if strings.Contains(string(b), "//api") || strings.Contains(string(b), "__API_ORIGIN__") {
		t.Fatalf("got %s", b)
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatalf("result is not valid JSON: %v", err)
	}
}

func TestWriteRewriteRefusesMissingPlaceholder(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "vercel.json"), []byte(`{}`), 0o644)
	if err := vercel.WriteRewrite(dir, "https://x.vercel.app"); err == nil {
		t.Fatal("a vercel.json without the placeholder must be an error, not a silent no-op")
	}
	if err := vercel.WriteRewrite(dir, ""); err == nil {
		t.Fatal("an empty origin must be an error")
	}
}

func TestRepoWebVercelJSONHasPlaceholder(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "apps", "web", "vercel.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "__API_ORIGIN__/api/:path*") {
		t.Fatal("apps/web/vercel.json must contain the __API_ORIGIN__ placeholder")
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
}
