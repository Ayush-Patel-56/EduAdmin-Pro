package smoke

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func init() {
	Wait = time.Millisecond
	Timeout = 2 * time.Second
}

const realIP = "198.51.100.9"

// fake imitates the live site: a web origin that serves the SPA and proxies
// /api/*, and an API origin that serves the cron route. Each flag breaks one
// thing.
type fake struct {
	mu       sync.Mutex
	requests []string // "METHOD path" of everything seen, for the read-only test
	bad      []string // requests that were not plain cookie-less GETs

	noRoot, noDashboard, noRootDiv bool
	missingAsset, assetIsHTML      bool
	readyStatus                    int
	readyBody                      string
	meStatus                       int
	noNosniff, noCSP               bool
	corsReflect                    bool
	ipMode                         string // "", "forged", "loopback", "private", "empty", "vary", "garbage"
	cronStatus                     int
	failFirst                      int32 // first N requests to /api/health/ready get a 503
	hang                           bool  // /api/health/ready never answers

	ipCalls  int32
	readyHit int32
}

const indexHTML = `<!doctype html><html><head>
<link rel="stylesheet" href="/assets/index-abc.css">
<script type="module" src="/assets/index-abc.js"></script>
</head><body><div id="root"></div></body></html>`

func (f *fake) record(r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, r.Method+" "+r.URL.Path)
	if r.Method != http.MethodGet || r.Header.Get("Cookie") != "" || (r.ContentLength > 0) {
		f.bad = append(f.bad, r.Method+" "+r.URL.Path)
	}
}

func (f *fake) web() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.record(r)
		switch r.URL.Path {
		case "/", "/dashboard":
			if (r.URL.Path == "/" && f.noRoot) || (r.URL.Path == "/dashboard" && f.noDashboard) {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			if f.noRootDiv {
				w.Write([]byte("<html><body>hello</body></html>"))
				return
			}
			w.Write([]byte(indexHTML))
		case "/assets/index-abc.js":
			f.asset(w, "text/javascript")
		case "/assets/index-abc.css":
			f.asset(w, "text/css")
		case "/api/health":
			if !f.noNosniff {
				w.Header().Set("X-Content-Type-Options", "nosniff")
			}
			if !f.noCSP {
				w.Header().Set("Content-Security-Policy", "default-src 'self'")
			}
			if f.corsReflect && r.Header.Get("Origin") != "" {
				w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
			}
			w.Write([]byte(`{"status":"ok"}`))
		case "/api/health/ready":
			n := atomic.AddInt32(&f.readyHit, 1)
			if f.hang {
				<-r.Context().Done()
				return
			}
			if n <= f.failFirst {
				w.WriteHeader(503)
				return
			}
			if f.readyStatus != 0 {
				w.WriteHeader(f.readyStatus)
			}
			body := f.readyBody
			if body == "" {
				body = `{"status":"ok","database":"up"}`
			}
			w.Write([]byte(body))
		case "/api/auth/me":
			if f.meStatus != 0 {
				w.WriteHeader(f.meStatus)
				return
			}
			w.WriteHeader(401)
		case "/api/health/ip":
			n := atomic.AddInt32(&f.ipCalls, 1)
			ip := realIP
			switch f.ipMode {
			case "forged":
				ip = r.Header.Get("X-Forwarded-For")
			case "loopback":
				ip = "127.0.0.1"
			case "private":
				ip = "10.1.2.3"
			case "empty":
				ip = ""
			case "garbage":
				ip = "not-an-ip"
			case "vary":
				ip = "198.51.100." + string(rune('0'+n))
			}
			w.Write([]byte(`{"ip":"` + ip + `"}`))
		default:
			http.NotFound(w, r)
		}
	})
}

func (f *fake) asset(w http.ResponseWriter, ctype string) {
	if f.missingAsset {
		w.WriteHeader(404)
		return
	}
	if f.assetIsHTML {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(indexHTML))
		return
	}
	w.Header().Set("Content-Type", ctype)
	w.Write([]byte("/* asset */"))
}

func (f *fake) api() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.record(r)
		if r.URL.Path == "/api/internal/cron/digest" {
			if f.cronStatus != 0 {
				w.WriteHeader(f.cronStatus)
				return
			}
			w.WriteHeader(401)
			return
		}
		http.NotFound(w, r)
	})
}

// start serves f and returns the web and API origins.
func start(t *testing.T, f *fake) (web, api string) {
	t.Helper()
	ws, as := httptest.NewServer(f.web()), httptest.NewServer(f.api())
	t.Cleanup(ws.Close)
	t.Cleanup(as.Close)
	return ws.URL, as.URL
}

func byName(results []Result) map[string]error {
	m := map[string]error{}
	for _, r := range results {
		m[r.Name] = r.Err
	}
	return m
}

var allChecks = []string{"web shell", "api ready", "auth refuses", "security headers", "cors", "client ip", "cron locked"}

func TestHealthySitePasses(t *testing.T) {
	web, api := start(t, &fake{})
	results := Run(context.Background(), nil, web, api)
	if len(results) != len(allChecks) {
		t.Fatalf("got %d results, want %d", len(results), len(allChecks))
	}
	for i, r := range results {
		if r.Name != allChecks[i] {
			t.Errorf("result %d is %q, want %q", i, r.Name, allChecks[i])
		}
		if r.Err != nil {
			t.Errorf("%s failed: %v", r.Name, r.Err)
		}
	}
	if Failed(results) {
		t.Error("Failed reported true for a healthy site")
	}
}

func TestEachBreakageFailsOnlyItsCheck(t *testing.T) {
	for _, tc := range []struct {
		name   string
		check  string
		break_ func(*fake)
	}{
		{"root missing", "web shell", func(f *fake) { f.noRoot = true }},
		{"dashboard missing", "web shell", func(f *fake) { f.noDashboard = true }},
		{"no root div", "web shell", func(f *fake) { f.noRootDiv = true }},
		{"asset 404", "web shell", func(f *fake) { f.missingAsset = true }},
		{"asset served as html", "web shell", func(f *fake) { f.assetIsHTML = true }},
		{"ready 503", "api ready", func(f *fake) { f.readyStatus = 503 }},
		{"database down", "api ready", func(f *fake) { f.readyBody = `{"status":"ok","database":"down"}` }},
		{"ready not json", "api ready", func(f *fake) { f.readyBody = `<html>oops</html>` }},
		{"me open", "auth refuses", func(f *fake) { f.meStatus = 200 }},
		{"me 500", "auth refuses", func(f *fake) { f.meStatus = 500 }},
		{"no nosniff", "security headers", func(f *fake) { f.noNosniff = true }},
		{"no csp", "security headers", func(f *fake) { f.noCSP = true }},
		{"cors reflects origin", "cors", func(f *fake) { f.corsReflect = true }},
		{"ip forged", "client ip", func(f *fake) { f.ipMode = "forged" }},
		{"ip loopback", "client ip", func(f *fake) { f.ipMode = "loopback" }},
		{"ip private", "client ip", func(f *fake) { f.ipMode = "private" }},
		{"ip empty", "client ip", func(f *fake) { f.ipMode = "empty" }},
		{"ip garbage", "client ip", func(f *fake) { f.ipMode = "garbage" }},
		{"ip varies", "client ip", func(f *fake) { f.ipMode = "vary" }},
		{"cron open", "cron locked", func(f *fake) { f.cronStatus = 200 }},
		{"cron 500", "cron locked", func(f *fake) { f.cronStatus = 500 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &fake{}
			tc.break_(f)
			web, api := start(t, f)
			results := Run(context.Background(), nil, web, api)
			if !Failed(results) {
				t.Fatal("Failed reported false")
			}
			got := byName(results)
			for _, name := range allChecks {
				if name == tc.check && got[name] == nil {
					t.Errorf("%s should have failed", name)
				}
				if name != tc.check && got[name] != nil {
					t.Errorf("%s should have passed, got %v", name, got[name])
				}
			}
		})
	}
}

func TestCronCheckUsesAPIOrigin(t *testing.T) {
	// The web origin has no cron route (404). A check that went there would
	// fail; one that goes to the API origin sees 401.
	web, api := start(t, &fake{})
	got := byName(Run(context.Background(), nil, web, api))
	if got["cron locked"] != nil {
		t.Fatal(got["cron locked"])
	}
	// Pointing the "api" origin at the web server must fail the check.
	got = byName(Run(context.Background(), nil, web, web))
	if got["cron locked"] == nil {
		t.Fatal("cron check did not use the api origin")
	}
}

func TestCORSSendsForeignOriginAndIPSendsForgedHeader(t *testing.T) {
	var sawOrigin, sawXFF atomic.Bool
	ws := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" && r.Header.Get("Origin") == "https://evil.example" {
			sawOrigin.Store(true)
		}
		if r.URL.Path == "/api/health/ip" && r.Header.Get("X-Forwarded-For") == "203.0.113.7" {
			sawXFF.Store(true)
		}
		http.NotFound(w, r)
	}))
	defer ws.Close()
	Attempts = 1
	defer func() { Attempts = 3 }()
	Run(context.Background(), nil, ws.URL, ws.URL)
	if !sawOrigin.Load() {
		t.Error("cors check did not send Origin: https://evil.example")
	}
	if !sawXFF.Load() {
		t.Error("client ip check did not send X-Forwarded-For: 203.0.113.7")
	}
}

func TestReadOnly(t *testing.T) {
	f := &fake{}
	web, api := start(t, f)
	Run(context.Background(), nil, web, api)
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.requests) == 0 {
		t.Fatal("no requests seen")
	}
	if len(f.bad) > 0 {
		t.Fatalf("non-GET, cookie or body requests: %v", f.bad)
	}
}

func TestNoCookiesKept(t *testing.T) {
	// A server that sets a cookie must not see it come back, even with the
	// default client.
	var sawCookie atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != "" {
			sawCookie.Store(true)
		}
		http.SetCookie(w, &http.Cookie{Name: "s", Value: "1"})
		http.NotFound(w, r)
	}))
	defer srv.Close()
	Attempts = 1
	defer func() { Attempts = 3 }()
	Run(context.Background(), nil, srv.URL, srv.URL)
	if sawCookie.Load() {
		t.Error("a cookie was sent back")
	}
}

func TestRetriesUntilDeploymentAnswers(t *testing.T) {
	f := &fake{failFirst: 2}
	web, api := start(t, f)
	got := byName(Run(context.Background(), nil, web, api))
	if got["api ready"] != nil {
		t.Fatalf("api ready should pass on the third attempt: %v", got["api ready"])
	}
	if n := atomic.LoadInt32(&f.readyHit); n != 3 {
		t.Errorf("ready was hit %d times, want 3", n)
	}
}

func TestGivesUpAfterThreeAttempts(t *testing.T) {
	f := &fake{readyStatus: 503}
	web, api := start(t, f)
	got := byName(Run(context.Background(), nil, web, api))
	if got["api ready"] == nil {
		t.Fatal("api ready should fail")
	}
	if n := atomic.LoadInt32(&f.readyHit); n != 3 {
		t.Errorf("ready was hit %d times, want 3", n)
	}
}

func TestPerRequestTimeout(t *testing.T) {
	oldT, oldA := Timeout, Attempts
	Timeout, Attempts = 50*time.Millisecond, 1
	defer func() { Timeout, Attempts = oldT, oldA }()
	f := &fake{hang: true}
	web, api := start(t, f)
	began := time.Now()
	got := byName(Run(context.Background(), nil, web, api))
	if got["api ready"] == nil {
		t.Fatal("api ready should time out")
	}
	if time.Since(began) > 3*time.Second {
		t.Errorf("took %v", time.Since(began))
	}
}

func TestStopsWhenContextCancelled(t *testing.T) {
	oldW := Wait
	Wait = time.Minute
	defer func() { Wait = oldW }()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	web, api := start(t, &fake{readyStatus: 503})
	done := make(chan struct{})
	go func() { Run(ctx, nil, web, api); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run ignored the cancelled context")
	}
}

func TestErrorsAreShortAndSafe(t *testing.T) {
	// Bodies carry a marker that must never appear in an error, and the client
	// ip check must not print any address.
	const marker = "SECRET-BODY-MARKER"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/health/ip":
			w.Write([]byte(`{"ip":"203.0.113.7","note":"` + marker + `"}`))
		default:
			w.WriteHeader(500)
			w.Write([]byte(marker + marker + marker))
		}
	}))
	defer srv.Close()
	Attempts = 1
	defer func() { Attempts = 3 }()
	results := Run(context.Background(), nil, srv.URL, srv.URL)
	if !Failed(results) {
		t.Fatal("expected failures")
	}
	for _, r := range results {
		if r.Err == nil {
			continue
		}
		msg := r.Err.Error()
		if strings.Contains(msg, marker) {
			t.Errorf("%s: error contains a response body: %q", r.Name, msg)
		}
		if strings.Contains(msg, "203.0.113.7") {
			t.Errorf("%s: error contains an ip: %q", r.Name, msg)
		}
		if len(msg) > 200 {
			t.Errorf("%s: error is %d chars", r.Name, len(msg))
		}
	}
}

func TestIPMessagesNameTheProblemNotTheAddress(t *testing.T) {
	for mode, want := range map[string]string{
		"forged":   "forged",
		"loopback": "loopback",
		"private":  "private",
		"vary":     "differed",
	} {
		f := &fake{ipMode: mode}
		web, api := start(t, f)
		err := byName(Run(context.Background(), nil, web, api))["client ip"]
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: got %v, want mention of %q", mode, err, want)
			continue
		}
		for _, addr := range []string{"203.0.113.7", "127.0.0.1", "10.1.2.3", "198.51.100."} {
			if strings.Contains(err.Error(), addr) {
				t.Errorf("%s: error contains %s: %q", mode, addr, err)
			}
		}
	}
}

func TestTransportErrorDoesNotRepeatURL(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close() // nothing is listening now
	Attempts = 1
	defer func() { Attempts = 3 }()
	for _, r := range Run(context.Background(), nil, url, url) {
		if r.Err == nil {
			t.Errorf("%s should fail", r.Name)
		} else if strings.Contains(r.Err.Error(), url) {
			t.Errorf("%s: error repeats the URL: %v", r.Name, r.Err)
		}
	}
}

func TestTrailingSlashOnOrigins(t *testing.T) {
	web, api := start(t, &fake{})
	if Failed(Run(context.Background(), nil, web+"/", api+"/")) {
		t.Error("trailing slashes should be tolerated")
	}
}
