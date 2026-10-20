package vercel

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

// SyncEnv writes vars to the project's production environment as Sensitive
// (write-only) variables, one request per key, replacing any existing value.
// Errors name the key, never the value.
func (c *Client) SyncEnv(ctx context.Context, projectID string, vars map[string]string) error {
	keys := make([]string, 0, len(vars))
	for k := range vars {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	path := "/v10/projects/" + url.PathEscape(projectID) + "/env"
	for _, k := range keys {
		var resp struct {
			Failed []struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			} `json:"failed"`
		}
		err := c.do(ctx, "POST", path, url.Values{"upsert": {"true"}}, map[string]any{
			"key":    k,
			"value":  vars[k],
			"type":   "sensitive",
			"target": []string{"production"},
		}, &resp)
		if err != nil {
			return fmt.Errorf("setting %s: %w", k, err)
		}
		if len(resp.Failed) > 0 {
			msg := fmt.Sprintf("vercel: setting %s was rejected", k)
			if code := safeCode(resp.Failed[0].Error.Code); code != "" {
				msg += " (" + code + ")"
			}
			return fmt.Errorf("%s", msg)
		}
	}
	return nil
}

// secretSources are the GitHub Environment secrets the API's production
// environment is built from. PROD_DIRECT_URL is required here even though it is
// not sent to Vercel (migrations use it from the pipeline), so a missing one
// is caught when the environment is set up rather than at the first release.
var secretSources = []string{
	"PROD_DATABASE_URL", "PROD_DIRECT_URL",
	"PROD_SMTP_USER", "PROD_SMTP_PASS", "PROD_MAIL_FROM",
	"PROD_R2_ACCOUNT_ID", "PROD_R2_ACCESS_KEY_ID", "PROD_R2_SECRET_ACCESS_KEY", "PROD_R2_BUCKET",
	"CRON_SECRET",
}

var digitsOnly = regexp.MustCompile(`^\d+$`)

// APIEnv builds the API project's production environment from the secrets in
// getenv and the web project's origin. It fails listing every missing secret.
// DIRECT_URL is deliberately absent: the running API only uses DATABASE_URL.
// Two optional, non-secret settings come from getenv too: TRUST_PROXY (the
// proxy hop count, default 1) and DIGEST_ENABLED ("true" or "false", default
// "true"; false stops the digest emails, which the cron would otherwise send).
func APIEnv(getenv func(string) string, webOrigin string) (map[string]string, error) {
	var missing []string
	for _, k := range secretSources {
		if strings.TrimSpace(getenv(k)) == "" {
			missing = append(missing, k)
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("missing secrets: %s", strings.Join(missing, ", "))
	}
	webOrigin = strings.TrimRight(strings.TrimSpace(webOrigin), "/")
	if webOrigin == "" {
		return nil, fmt.Errorf("the web origin is empty")
	}
	trust := strings.TrimSpace(getenv("TRUST_PROXY"))
	if trust == "" {
		trust = "1"
	}
	if !digitsOnly.MatchString(trust) {
		return nil, fmt.Errorf("TRUST_PROXY must be the number of proxy hops, e.g. 1")
	}
	digest := strings.TrimSpace(getenv("DIGEST_ENABLED"))
	if digest == "" {
		digest = "true"
	}
	if digest != "true" && digest != "false" {
		return nil, fmt.Errorf("DIGEST_ENABLED must be true or false")
	}

	return map[string]string{
		"NODE_ENV":                   "production",
		"DATABASE_URL":               getenv("PROD_DATABASE_URL"),
		"WEB_ORIGIN":                 webOrigin,
		"TRUST_PROXY":                trust,
		"REQUIRE_EMAIL_VERIFICATION": "true",
		"SMTP_HOST":                  "smtp.gmail.com",
		"SMTP_PORT":                  "465",
		"SMTP_USER":                  getenv("PROD_SMTP_USER"),
		"SMTP_PASS":                  getenv("PROD_SMTP_PASS"),
		"MAIL_FROM":                  getenv("PROD_MAIL_FROM"),
		"R2_ACCOUNT_ID":              getenv("PROD_R2_ACCOUNT_ID"),
		"R2_ACCESS_KEY_ID":           getenv("PROD_R2_ACCESS_KEY_ID"),
		"R2_SECRET_ACCESS_KEY":       getenv("PROD_R2_SECRET_ACCESS_KEY"),
		"R2_BUCKET":                  getenv("PROD_R2_BUCKET"),
		"DIGEST_ENABLED":             digest,
		"DIGEST_HOUR_IST":            "19",
		"CRON_SECRET":                getenv("CRON_SECRET"),
	}, nil
}
