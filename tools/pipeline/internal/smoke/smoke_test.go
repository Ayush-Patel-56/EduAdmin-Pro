package smoke

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func init() {
	Wait = time.Millisecond
	Timeout = 2 * time.Second
}

const (
	realIP = "8.8.4.4"
	edgeIP = "76.76.21.21"
)

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
	ipMode                         string // "", "forged", "loopback", "private", "empty", "vary", "garbage", "edge" (through the web only)
	directIP                       string // what the API origin's /api/health/ip answers; "" means realIP
	cronStatus                     int
	meRefusal, cronRefusal         string // "", "html" (platform wall), "nocode" (JSON without statusCode)
	failFirst                      int32  // first N requests to /api/health/ready get a 503
	hang                           bool   // /api/health/ready never answers

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
			refuse(w, f.meRefusal)
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
			case "cgnat":
				ip = "100.64.1.1"
			case "documentation":
				ip = "198.51.100.9"
			case "empty":
				ip = ""
			case "garbage":
				ip = "not-an-ip"
			case "vary":
				ip = "8.8.8." + string(rune('0'+n))
			case "edge":
				// The rewrite hands the API the web edge's address: public and
				// stable, but the same for every user.
				ip = edgeIP
			}
			w.Write([]byte(`{"ip":"` + ip + `"}`))
		default:
			http.NotFound(w, r)
		}
	})
}

// refuse writes a 401 the way the app (or, if broken, something else) would.
func refuse(w http.ResponseWriter, mode string) {
	switch mode {
	case "html":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(401)
		w.Write([]byte("<html><body>Authentication Required</body></html>"))
	case "nocode":
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(401)
		w.Write([]byte(`{"message":"Unauthorized"}`))
	default:
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(401)
		w.Write([]byte(`{"statusCode":401,"message":"Unauthorized"}`))
	}
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
		if r.URL.Path == "/api/health/ip" {
			ip := f.directIP
			if ip == "" {
				ip = realIP
			}
			w.Write([]byte(`{"ip":"` + ip + `"}`))
			return
		}
		if r.URL.Path == "/api/internal/cron/digest" {
			if f.cronStatus != 0 {
				w.WriteHeader(f.cronStatus)
				return
			}
			refuse(w, f.cronRefusal)
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
		{"ip cgnat", "client ip", func(f *fake) { f.ipMode = "cgnat" }},
		{"ip documentation range", "client ip", func(f *fake) { f.ipMode = "documentation" }},
		{"ip is the web edge's", "client ip", func(f *fake) { f.ipMode = "edge" }},
		{"ip direct is private", "client ip", func(f *fake) { f.directIP = "10.0.0.1" }},
		{"me html 401", "auth refuses", func(f *fake) { f.meRefusal = "html" }},
		{"me json without statusCode", "auth refuses", func(f *fake) { f.meRefusal = "nocode" }},
		{"cron html 401", "cron locked", func(f *fake) { f.cronRefusal = "html" }},
		{"cron json without statusCode", "cron locked", func(f *fake) { f.cronRefusal = "nocode" }},
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
	var sawOrigin, sawXFF, sawXFF2 atomic.Bool
	ws := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" && r.Header.Get("Origin") == "https://evil.example" {
			sawOrigin.Store(true)
		}
		if r.URL.Path == "/api/health/ip" {
			xff := r.Header.Get("X-Forwarded-For")
			if xff == "203.0.113.7" {
				sawXFF.Store(true)
			}
			if xff == "198.51.100.23" {
				sawXFF2.Store(true)
			}
			w.Write([]byte(`{"ip":"8.8.4.4"}`))
			return
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
	if !sawXFF2.Load() {
		t.Error("client ip check did not send a second, different X-Forwarded-For")
	}
	if !sawXFF.Load() {
		t.Error("client ip check did not send X-Forwarded-For: 203.0.113.7")
	}
}

func TestClientIPComparesRewriteWithDirect(t *testing.T) {
	// The rewrite path answers a different, stable public address than the
	// API answers directly: the API is seeing the web edge, so it fails, and
	// the message names neither address.
	f := &fake{ipMode: "edge"}
	web, api := start(t, f)
	err := byName(Run(context.Background(), nil, web, api))["client ip"]
	if err == nil || !strings.Contains(err.Error(), "differed from the api's direct answer") {
		t.Fatalf("got %v", err)
	}
	for _, addr := range []string{realIP, edgeIP} {
		if strings.Contains(err.Error(), addr) {
			t.Errorf("error contains %s: %q", addr, err)
		}
	}
	// The same address both ways passes.
	f = &fake{directIP: realIP}
	web, api = start(t, f)
	if err := byName(Run(context.Background(), nil, web, api))["client ip"]; err != nil {
		t.Fatal(err)
	}
}

func TestClientIPDirectCallSendsForgedHeader(t *testing.T) {
	var sawXFF atomic.Int32
	as := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health/ip" {
			if x := r.Header.Get("X-Forwarded-For"); x == "203.0.113.7" || x == "198.51.100.23" {
				sawXFF.Add(1)
			}
			w.Write([]byte(`{"ip":"` + realIP + `"}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer as.Close()
	web, _ := start(t, &fake{})
	if err := byName(Run(context.Background(), nil, web, as.URL))["client ip"]; err != nil {
		t.Fatal(err)
	}
	if sawXFF.Load() != 2 {
		t.Fatalf("the api origin got %d calls with a forged X-Forwarded-For, want 2", sawXFF.Load())
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
	if msg := got["api ready"].Error(); !strings.Contains(msg, "timeout") || strings.Contains(msg, "127.0.0.1") {
		t.Errorf("want a bare timeout, got %q", msg)
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
		for _, addr := range []string{"203.0.113.7", "127.0.0.1", "10.1.2.3", "8.8.", "198.51.100.23"} {
			if strings.Contains(err.Error(), addr) {
				t.Errorf("%s: error contains %s: %q", mode, addr, err)
			}
		}
	}
}

func TestTransportErrorPrintsNoAddress(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	u := srv.URL
	port := strings.TrimPrefix(u, "http://127.0.0.1:")
	srv.Close() // nothing is listening now
	Attempts = 1
	defer func() { Attempts = 3 }()
	for _, r := range Run(context.Background(), nil, u, u) {
		if r.Err == nil {
			t.Errorf("%s should fail", r.Name)
			continue
		}
		msg := r.Err.Error()
		for _, bad := range []string{u, "127.0.0.1", "localhost", port, "dial", "tcp"} {
			if strings.Contains(msg, bad) {
				t.Errorf("%s: error contains %q: %v", r.Name, bad, msg)
			}
		}
		if !strings.Contains(msg, "connection refused") {
			t.Errorf("%s: want class 'connection refused', got %v", r.Name, msg)
		}
	}
}

func TestTransportClass(t *testing.T) {
	addrErr := func(inner error) error {
		return &url.Error{Op: "Get", URL: "https://76.76.21.21/x", Err: &net.OpError{
			Op: "dial", Net: "tcp", Addr: &net.TCPAddr{IP: net.ParseIP("76.76.21.21"), Port: 443}, Err: inner}}
	}
	for _, tc := range []struct {
		name string
		err  error
		want string
	}{
		{"refused", addrErr(syscall.ECONNREFUSED), "connection refused"},
		{"refused text", addrErr(errors.New("connectex: No connection could be made because the target machine actively refused it.")), "connection refused"},
		{"reset", addrErr(syscall.ECONNRESET), "connection reset"},
		{"eof", &url.Error{Op: "Get", URL: "https://x", Err: io.EOF}, "connection reset"},
		{"deadline", &url.Error{Op: "Get", URL: "https://x", Err: context.DeadlineExceeded}, "timeout"},
		{"net timeout", addrErr(&net.DNSError{IsTimeout: true}), "timeout"},
		{"dns", addrErr(&net.DNSError{Err: "no such host", Name: "x.example"}), "DNS lookup failed"},
		{"tls verify", &url.Error{Op: "Get", URL: "https://x", Err: &tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}}, "TLS error"},
		{"tls text", addrErr(errors.New("tls: handshake failure")), "TLS error"},
		{"canceled", &url.Error{Op: "Get", URL: "https://x", Err: context.Canceled}, "canceled"},
		{"other", addrErr(errors.New("weird failure at 76.76.21.21:443")), "request failed"},
	} {
		if got := transportClass(tc.err); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
		if got := transportClass(tc.err); strings.Contains(got, "76.76") || strings.Contains(got, "443") {
			t.Errorf("%s: class leaks an address: %q", tc.name, got)
		}
	}
}

func TestNotPublicReason(t *testing.T) {
	for _, tc := range []struct {
		ip   string
		want string // "" means acceptable
	}{
		{"8.8.8.8", ""},
		{"93.184.216.34", ""},
		{"2606:4700:4700::1111", ""},
		{"::ffff:8.8.8.8", ""},
		{"127.0.0.1", "loopback"},
		{"::1", "loopback"},
		{"::ffff:127.0.0.1", "loopback"},
		{"10.0.0.1", "private or not routable"},
		{"192.168.1.1", "private or not routable"},
		{"172.16.0.1", "private or not routable"},
		{"fd00::1", "private or not routable"},
		{"::ffff:10.0.0.1", "private or not routable"},
		{"169.254.1.1", "private or not routable"},
		{"fe80::1", "private or not routable"},
		{"0.0.0.0", "private or not routable"},
		{"::", "private or not routable"},
		{"100.64.0.1", "private or not routable"},
		{"100.127.255.254", "private or not routable"},
		{"198.18.0.1", "private or not routable"},
		{"198.19.255.255", "private or not routable"},
		{"192.0.2.1", "private or not routable"},
		{"198.51.100.9", "private or not routable"},
		{"203.0.113.7", "private or not routable"},
		{"2001:db8::1", "private or not routable"},
		{"224.0.0.1", "private or not routable"},
		{"ff02::1", "private or not routable"},
		{"255.255.255.255", "private or not routable"},
		{"240.0.0.1", "private or not routable"},
		{"100.128.0.1", ""}, // just outside 100.64.0.0/10
	} {
		got := notPublicReason(netip.MustParseAddr(tc.ip))
		if got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.ip, got, tc.want)
		}
	}
}

// redirectTo returns a server that answers every request with a 302 to target.
func redirectTo(t *testing.T, target string) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target+r.URL.Path, http.StatusFound)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestRedirectsAreNotFollowed(t *testing.T) {
	// "elsewhere" is a healthy copy of the site on another host. A redirect to
	// it must fail the status check, not pass on its answer.
	other, otherAPI := start(t, &fake{})
	_ = otherAPI
	web, api := start(t, &fake{})

	got := byName(Run(context.Background(), nil, redirectTo(t, other), api))
	if got["web shell"] == nil {
		t.Error("web shell followed a redirect to another host")
	}
	got = byName(Run(context.Background(), nil, web, redirectTo(t, otherAPI)))
	if got["cron locked"] == nil {
		t.Error("cron locked followed a redirect to another host")
	}
}

func TestCallerClientIsNotMutated(t *testing.T) {
	jar := &cookieJarStub{}
	mine := &http.Client{Jar: jar}
	web, api := start(t, &fake{})
	Run(context.Background(), mine, web, api)
	if mine.CheckRedirect != nil || mine.Jar != jar {
		t.Error("the caller's client was modified")
	}
}

type cookieJarStub struct{}

func (*cookieJarStub) SetCookies(*url.URL, []*http.Cookie) {}
func (*cookieJarStub) Cookies(*url.URL) []*http.Cookie     { return nil }

func TestTrailingSlashOnOrigins(t *testing.T) {
	web, api := start(t, &fake{})
	if Failed(Run(context.Background(), nil, web+"/", api+"/")) {
		t.Error("trailing slashes should be tolerated")
	}
}
