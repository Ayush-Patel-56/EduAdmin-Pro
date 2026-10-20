// Package smoke runs read-only checks against the live site after a release.
// It sends GET requests only: no cookies, no bodies. Error messages are short
// and safe to log; they never contain a response body, and the client-ip check
// never prints an address.
package smoke

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Tunables. A fresh deployment can take a moment to answer, so each check is
// attempted several times. Tests shorten these.
var (
	Attempts = 3
	Wait     = 5 * time.Second
	Timeout  = 15 * time.Second
)

const (
	forgedIP   = "203.0.113.7"
	evilOrigin = "https://evil.example"
	maxBody    = 2 << 20 // reading more than this from any response is pointless
)

// Result is the outcome of one check. Err is nil when the check passed.
type Result struct {
	Name string
	Err  error
}

// Failed reports whether any check failed.
func Failed(results []Result) bool {
	for _, r := range results {
		if r.Err != nil {
			return true
		}
	}
	return false
}

type check struct {
	name string
	fn   func(s *site, ctx context.Context) error
}

// site holds the origins under test.
type site struct {
	client *http.Client
	web    string
	api    string
}

var checks = []check{
	{"web shell", (*site).webShell},
	{"api ready", (*site).apiReady},
	{"auth refuses", (*site).authRefuses},
	{"security headers", (*site).securityHeaders},
	{"cors", (*site).cors},
	{"client ip", (*site).clientIP},
	{"cron locked", (*site).cronLocked},
}

// Run executes every check against webOrigin (which proxies /api/* to the API)
// and apiOrigin (hit directly for the cron check). A nil client gets a plain
// one with no cookie jar.
func Run(ctx context.Context, client *http.Client, webOrigin, apiOrigin string) []Result {
	if client == nil {
		client = &http.Client{}
	}
	s := &site{
		client: client,
		web:    strings.TrimRight(webOrigin, "/"),
		api:    strings.TrimRight(apiOrigin, "/"),
	}
	results := make([]Result, 0, len(checks))
	for _, c := range checks {
		results = append(results, Result{Name: c.name, Err: attempt(ctx, s, c)})
	}
	return results
}

// attempt runs a check up to Attempts times, waiting between tries, and
// returns the last error.
func attempt(ctx context.Context, s *site, c check) error {
	var err error
	for i := 0; i < max(Attempts, 1); i++ {
		if i > 0 {
			select {
			case <-ctx.Done():
				return err
			case <-time.After(Wait):
			}
		}
		if err = c.fn(s, ctx); err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return err
		}
	}
	return err
}

type response struct {
	status int
	header http.Header
	body   []byte
}

// get sends one GET. The body is read (capped) and the connection released.
func (s *site) get(ctx context.Context, rawURL string, headers map[string]string) (*response, error) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, errors.New("bad URL")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		// The *url.Error text repeats the URL; keep just the cause.
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return nil, fmt.Errorf("request failed: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if err != nil {
		return nil, fmt.Errorf("reading response: %v", err)
	}
	return &response{status: resp.StatusCode, header: resp.Header, body: body}, nil
}

func expectStatus(path string, r *response, want int) error {
	if r.status != want {
		return fmt.Errorf("%s: status %d, want %d", path, r.status, want)
	}
	return nil
}

var assetRef = regexp.MustCompile(`(?:src|href)\s*=\s*["'](/assets/[^"'?#]+\.(?:js|css))["']`)

// webShell: the SPA answers on / and a deep link, and every script and
// stylesheet it references is really served (not the index page again).
func (s *site) webShell(ctx context.Context) error {
	assets := map[string]bool{}
	for _, path := range []string{"/", "/dashboard"} {
		r, err := s.get(ctx, s.web+path, nil)
		if err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		if err := expectStatus(path, r, http.StatusOK); err != nil {
			return err
		}
		if !strings.Contains(string(r.body), `<div id="root">`) {
			return fmt.Errorf(`%s: no <div id="root">`, path)
		}
		for _, m := range assetRef.FindAllStringSubmatch(string(r.body), -1) {
			assets[m[1]] = true
		}
	}
	if len(assets) == 0 {
		return errors.New("index page references no /assets/ scripts or styles")
	}
	for _, path := range sortedKeys(assets) {
		r, err := s.get(ctx, s.web+path, nil)
		if err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		if err := expectStatus(path, r, http.StatusOK); err != nil {
			return err
		}
		// A rewrite to index.html would answer 200 for a missing file.
		if ct := r.header.Get("Content-Type"); strings.HasPrefix(strings.ToLower(ct), "text/html") {
			return fmt.Errorf("%s: served as HTML, not an asset", path)
		}
	}
	return nil
}

func sortedKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// apiReady: through the web origin's rewrite, the API reports its database up.
func (s *site) apiReady(ctx context.Context) error {
	const path = "/api/health/ready"
	r, err := s.get(ctx, s.web+path, nil)
	if err != nil {
		return err
	}
	if err := expectStatus(path, r, http.StatusOK); err != nil {
		return err
	}
	var body struct {
		Database string `json:"database"`
	}
	if err := json.Unmarshal(r.body, &body); err != nil {
		return fmt.Errorf("%s: response is not JSON", path)
	}
	if body.Database != "up" {
		return fmt.Errorf("%s: database is not up", path)
	}
	return nil
}

// authRefuses: a request with no session cookie is turned away.
func (s *site) authRefuses(ctx context.Context) error {
	const path = "/api/auth/me"
	r, err := s.get(ctx, s.web+path, nil)
	if err != nil {
		return err
	}
	return expectStatus(path, r, http.StatusUnauthorized)
}

// securityHeaders: helmet's headers survive the rewrite.
func (s *site) securityHeaders(ctx context.Context) error {
	const path = "/api/health"
	r, err := s.get(ctx, s.web+path, nil)
	if err != nil {
		return err
	}
	if err := expectStatus(path, r, http.StatusOK); err != nil {
		return err
	}
	if !strings.EqualFold(strings.TrimSpace(r.header.Get("X-Content-Type-Options")), "nosniff") {
		return fmt.Errorf("%s: missing x-content-type-options: nosniff", path)
	}
	if strings.TrimSpace(r.header.Get("Content-Security-Policy")) == "" {
		return fmt.Errorf("%s: missing content-security-policy", path)
	}
	return nil
}

// cors: a foreign origin is not echoed back as allowed.
func (s *site) cors(ctx context.Context) error {
	const path = "/api/health"
	r, err := s.get(ctx, s.web+path, map[string]string{"Origin": evilOrigin})
	if err != nil {
		return err
	}
	if r.header.Get("Access-Control-Allow-Origin") == evilOrigin {
		return fmt.Errorf("%s: access-control-allow-origin allows a foreign origin", path)
	}
	return nil
}

// clientIP: the API sees the real client address, not a loopback or private
// proxy hop, a forged X-Forwarded-For, or a value that changes between calls.
func (s *site) clientIP(ctx context.Context) error {
	const path = "/api/health/ip"
	forged := netip.MustParseAddr(forgedIP)
	var first netip.Addr
	for i := 0; i < 2; i++ {
		r, err := s.get(ctx, s.web+path, map[string]string{"X-Forwarded-For": forgedIP})
		if err != nil {
			return err
		}
		if err := expectStatus(path, r, http.StatusOK); err != nil {
			return err
		}
		var body struct {
			IP string `json:"ip"`
		}
		if err := json.Unmarshal(r.body, &body); err != nil {
			return fmt.Errorf("%s: response is not JSON", path)
		}
		if body.IP == "" {
			return fmt.Errorf("%s: ip is empty", path)
		}
		addr, err := netip.ParseAddr(body.IP)
		if err != nil {
			return fmt.Errorf("%s: ip is not an address", path)
		}
		addr = addr.Unmap()
		switch {
		case addr == forged:
			return fmt.Errorf("%s: ip matched the forged X-Forwarded-For", path)
		case addr.IsLoopback():
			return fmt.Errorf("%s: ip is loopback", path)
		case addr.IsPrivate(), addr.IsLinkLocalUnicast(), addr.IsUnspecified():
			return fmt.Errorf("%s: ip is private or not routable", path)
		}
		if i == 0 {
			first = addr
		} else if addr != first {
			return fmt.Errorf("%s: ip differed between calls", path)
		}
	}
	return nil
}

// cronLocked: the digest endpoint, hit on the API origin itself, refuses a
// request without the bearer secret.
func (s *site) cronLocked(ctx context.Context) error {
	const path = "/api/internal/cron/digest"
	r, err := s.get(ctx, s.api+path, nil)
	if err != nil {
		return err
	}
	return expectStatus(path, r, http.StatusUnauthorized)
}
