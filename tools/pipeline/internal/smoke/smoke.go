// Package smoke runs read-only checks against the live site after a release.
// It sends GET requests only: no cookies, no bodies. Error messages are short
// and safe to log; they never contain a response body, and the client-ip check
// never prints an address.
package smoke

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
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

// forgedIPs are sent as X-Forwarded-For, one per call of the client ip check.
var forgedIPs = []string{"203.0.113.7", "198.51.100.23"}

const (
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
// and apiOrigin (hit directly for the cron check and the client ip comparison). The client is copied, never
// modified: the copy follows no redirects (a 3xx must not let another host
// answer for the site under test) and keeps no cookies. A nil client gets a
// plain one.
func Run(ctx context.Context, client *http.Client, webOrigin, apiOrigin string) []Result {
	c := http.Client{}
	if client != nil {
		c = *client
	}
	c.Jar = nil
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	s := &site{
		client: &c,
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
		return nil, fmt.Errorf("request failed: %s", transportClass(err))
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if err != nil {
		return nil, fmt.Errorf("reading response: %s", transportClass(err))
	}
	return &response{status: resp.StatusCode, header: resp.Header, body: body}, nil
}

// transportClass reduces a transport failure to a coarse class. Go's own error
// text carries the remote address ("dial tcp 76.76.21.21:443: ..."), and CI
// logs must never show an address.
func transportClass(err error) string {
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	text := strings.ToLower(err.Error())
	var (
		dns     *net.DNSError
		netErr  net.Error
		verify  *tls.CertificateVerificationError
		record  tls.RecordHeaderError
		alert   tls.AlertError
		unknown x509.UnknownAuthorityError
		host    x509.HostnameError
		invalid x509.CertificateInvalidError
	)
	switch {
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &netErr) && netErr.Timeout():
		return "timeout"
	case errors.As(err, &dns):
		return "DNS lookup failed"
	case errors.As(err, &verify), errors.As(err, &record), errors.As(err, &alert),
		errors.As(err, &unknown), errors.As(err, &host), errors.As(err, &invalid),
		strings.Contains(text, "tls:"), strings.Contains(text, "x509:"):
		return "TLS error"
	case strings.Contains(text, "connection refused"), strings.Contains(text, "actively refused"):
		return "connection refused"
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF),
		strings.Contains(text, "connection reset"), strings.Contains(text, "forcibly closed"),
		strings.Contains(text, "broken pipe"):
		return "connection reset"
	}
	return "request failed"
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

// expectRefusal requires the app's own 401, not just any 401 (a platform
// protection wall answers 401 with HTML): status 401, a JSON content type and
// a body whose statusCode is 401, as NestJS's UnauthorizedException sends. The
// body is never echoed.
func expectRefusal(path string, r *response) error {
	if err := expectStatus(path, r, http.StatusUnauthorized); err != nil {
		return err
	}
	mt, _, _ := mime.ParseMediaType(r.header.Get("Content-Type"))
	var body struct {
		StatusCode int `json:"statusCode"`
	}
	if mt != "application/json" || json.Unmarshal(r.body, &body) != nil || body.StatusCode != http.StatusUnauthorized {
		return fmt.Errorf("%s: 401 is not the app's JSON refusal", path)
	}
	return nil
}

// authRefuses: a request with no session cookie is turned away by the app.
func (s *site) authRefuses(ctx context.Context) error {
	const path = "/api/auth/me"
	r, err := s.get(ctx, s.web+path, nil)
	if err != nil {
		return err
	}
	return expectRefusal(path, r)
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

// Ranges that are never a caller's public address, beyond what netip's own
// predicates cover.
var nonPublic = func() []netip.Prefix {
	var out []netip.Prefix
	for _, p := range []string{
		"0.0.0.0/8", "100.64.0.0/10", "198.18.0.0/15", "240.0.0.0/4",
		"192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "2001:db8::/32",
	} {
		out = append(out, netip.MustParsePrefix(p))
	}
	return out
}()

// notPublicReason returns why addr cannot be a real public client address, or
// "" if it can. It never includes the address.
func notPublicReason(addr netip.Addr) string {
	addr = addr.Unmap()
	if addr.IsLoopback() {
		return "loopback"
	}
	if !addr.IsGlobalUnicast() || addr.IsPrivate() {
		return "private or not routable"
	}
	for _, p := range nonPublic {
		if p.Contains(addr) {
			return "private or not routable"
		}
	}
	return ""
}

// clientIP: the API sees the real client address. Two calls carry different
// forged X-Forwarded-For values; both must answer with the same public address
// that is neither forged value (a header echoed back, or a proxy hop). Each
// call is made through the web rewrite and to the API origin directly (with
// the same forged header), and the two answers must match: behind the rewrite
// the API could otherwise see the web edge's address, the same for every user,
// which is public and stable too.
func (s *site) clientIP(ctx context.Context) error {
	var first netip.Addr
	for i, xff := range forgedIPs {
		viaWeb, err := s.seenIP(ctx, s.web, xff)
		if err != nil {
			return err
		}
		direct, err := s.seenIP(ctx, s.api, xff)
		if err != nil {
			return fmt.Errorf("direct to the api: %w", err)
		}
		if viaWeb != direct {
			return fmt.Errorf("/api/health/ip: ip through the web rewrite differed from the api's direct answer (the api may see the web edge, not the caller)")
		}
		if i == 0 {
			first = viaWeb
		} else if viaWeb != first {
			return fmt.Errorf("/api/health/ip: ip differed between calls")
		}
	}
	return nil
}

// seenIP asks origin's /api/health/ip which address it sees, sending xff as a
// forged X-Forwarded-For, and checks the answer is a public address that is
// not a forged one. Errors never include the address.
func (s *site) seenIP(ctx context.Context, origin, xff string) (netip.Addr, error) {
	const path = "/api/health/ip"
	r, err := s.get(ctx, origin+path, map[string]string{"X-Forwarded-For": xff})
	if err != nil {
		return netip.Addr{}, err
	}
	if err := expectStatus(path, r, http.StatusOK); err != nil {
		return netip.Addr{}, err
	}
	var body struct {
		IP string `json:"ip"`
	}
	if err := json.Unmarshal(r.body, &body); err != nil {
		return netip.Addr{}, fmt.Errorf("%s: response is not JSON", path)
	}
	if body.IP == "" {
		return netip.Addr{}, fmt.Errorf("%s: ip is empty", path)
	}
	addr, err := netip.ParseAddr(body.IP)
	if err != nil {
		return netip.Addr{}, fmt.Errorf("%s: ip is not an address", path)
	}
	addr = addr.Unmap()
	for _, f := range forgedIPs {
		if addr == netip.MustParseAddr(f) {
			return netip.Addr{}, fmt.Errorf("%s: ip matched a forged X-Forwarded-For", path)
		}
	}
	if why := notPublicReason(addr); why != "" {
		return netip.Addr{}, fmt.Errorf("%s: ip is %s", path, why)
	}
	return addr, nil
}

// cronLocked: the digest endpoint, hit on the API origin itself, refuses a
// request without the bearer secret.
func (s *site) cronLocked(ctx context.Context) error {
	const path = "/api/internal/cron/digest"
	r, err := s.get(ctx, s.api+path, nil)
	if err != nil {
		return err
	}
	return expectRefusal(path, r)
}
