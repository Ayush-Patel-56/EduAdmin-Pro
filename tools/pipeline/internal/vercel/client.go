// Package vercel is a small client for the Vercel REST API (projects, domains,
// environment variables) plus the pipeline's Vercel-specific configuration.
//
// Env values are secrets. Nothing here puts a request body, a response body or
// a value into an error or a log.
package vercel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultBase is the Vercel REST API.
const DefaultBase = "https://api.vercel.com"

// maxResponse caps how much of a response is read.
const maxResponse = 4 << 20

// Client calls the Vercel REST API as a team.
type Client struct {
	token  string
	teamID string
	base   string
	http   *http.Client
}

// NewClient returns a client that authenticates with token and acts for the
// team teamID. An empty base means the real API; tests pass an httptest URL.
func NewClient(token, teamID, base string) *Client {
	if base == "" {
		base = DefaultBase
	}
	return &Client{
		token:  token,
		teamID: teamID,
		base:   strings.TrimRight(base, "/"),
		http:   &http.Client{Timeout: 60 * time.Second},
	}
}

// APIError is a non-2xx answer from Vercel. It carries the request line, the
// status and Vercel's short error code, and nothing else from either body.
type APIError struct {
	Method string
	Path   string
	Status int
	Code   string
}

func (e *APIError) Error() string {
	msg := fmt.Sprintf("vercel: %s %s: %d %s", e.Method, e.Path, e.Status, http.StatusText(e.Status))
	if e.Code != "" {
		msg += " (" + e.Code + ")"
	}
	return msg
}

// IsNotFound reports whether err is a 404 from Vercel.
func IsNotFound(err error) bool {
	var ae *APIError
	return errors.As(err, &ae) && ae.Status == http.StatusNotFound
}

// do sends one request. query may be nil; teamId is always added. body, when
// not nil, is sent as JSON. When out is not nil a non-empty response is decoded
// into it.
func (c *Client) do(ctx context.Context, method, path string, query url.Values, body, out any) error {
	q := url.Values{}
	for k, vs := range query {
		q[k] = vs
	}
	if c.teamID != "" {
		q.Set("teamId", c.teamID)
	}

	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("vercel: %s %s: encoding the request: %w", method, path, err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path+"?"+q.Encode(), rdr)
	if err != nil {
		return fmt.Errorf("vercel: %s %s: %w", method, path, err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		// Report the cause without the URL net/http would add to it.
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return fmt.Errorf("vercel: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse))
	if err != nil {
		return fmt.Errorf("vercel: %s %s: reading the response: %w", method, path, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var e struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		return &APIError{Method: method, Path: path, Status: resp.StatusCode, Code: safeCode(e.Error.Code)}
	}
	if out != nil && len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("vercel: %s %s: decoding the response: %w", method, path, err)
		}
	}
	return nil
}

// safeCode keeps Vercel's error code only if it looks like one (a short
// identifier), so a body that echoes a value can't get into an error.
func safeCode(code string) string {
	if len(code) == 0 || len(code) > 64 {
		return ""
	}
	for _, r := range code {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
			return ""
		}
	}
	return code
}
