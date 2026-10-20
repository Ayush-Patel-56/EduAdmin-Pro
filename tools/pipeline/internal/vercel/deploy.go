package vercel

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/run"
)

// VercelCLIVersion is the Vercel CLI the pipeline builds and deploys with.
// Bump it deliberately: a new CLI can change how projects build.
const VercelCLIVersion = "62.7.0"

// Deploy builds the project on this machine and deploys the result to
// production with the pinned Vercel CLI, run from the repo root (the projects'
// root directories are set in Vercel). The token, project and team go to the
// CLI in its environment, never on the command line. It returns the
// deployment's own URL, which the CLI prints as the last line of stdout, or
// "" (with a warning) if that line is missing: the URL is for the log only.
func Deploy(ctx context.Context, r *run.Runner, projectID, orgID, token string) (string, error) {
	r.Mask(token)
	env := []string{
		"VERCEL_TOKEN=" + token,
		"VERCEL_PROJECT_ID=" + projectID,
		"VERCEL_ORG_ID=" + orgID,
	}
	cli := []string{"dlx", "vercel@" + VercelCLIVersion}
	if err := r.Cmd(ctx, "", env, "pnpm", append(cli, "pull", "--yes", "--environment=production")...); err != nil {
		return "", fmt.Errorf("vercel pull: %w", err)
	}
	if err := r.Cmd(ctx, "", env, "pnpm", append(cli, "build", "--prod")...); err != nil {
		return "", fmt.Errorf("vercel build: %w", err)
	}
	out, err := r.Output(ctx, "", env, "pnpm", append(cli, "deploy", "--prebuilt", "--prod")...)
	if err != nil {
		return "", fmt.Errorf("vercel deploy: %w", err)
	}
	// The CLI exited 0, so the deployment exists. Its URL is for the log only;
	// nothing depends on it, so a missing one is a warning, not a failure.
	u := lastURLLine(out)
	if u == "" {
		r.Printf("::warning::vercel deploy succeeded but its deployment URL could not be read from the CLI output")
	}
	return u, nil
}

// lastURLLine returns the last line of out that is nothing but an https URL.
func lastURLLine(out string) string {
	lines := strings.Split(out, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" || strings.ContainsAny(line, " \t") {
			continue
		}
		if u, err := url.Parse(line); err == nil && u.Scheme == "https" && u.Host != "" {
			return line
		}
	}
	return ""
}

// RolledBack reports whether the project is in an Instant Rollback state. While
// it is, Vercel does not move production domains to new deployments, so a
// release would deploy without going live.
//
// It reads lastAliasRequest from Vercel's "Find a project" response (the field
// the Vercel CLI's rollback status reads): the project is rolled back when the
// last alias request was a rollback that succeeded or is still running. Undo
// Rollback and `vercel promote` make the last request a promote, which clears
// it. lastRollbackTarget is ignored: its schema is an object with no
// documented fields.
func (c *Client) RolledBack(ctx context.Context, projectID string) (bool, error) {
	var p struct {
		LastAliasRequest *struct {
			Type      string `json:"type"`
			JobStatus string `json:"jobStatus"`
		} `json:"lastAliasRequest"`
	}
	if err := c.do(ctx, "GET", "/v9/projects/"+url.PathEscape(projectID), nil, nil, &p); err != nil {
		return false, err
	}
	req := p.LastAliasRequest
	if req == nil || req.Type != "rollback" {
		return false, nil
	}
	switch req.JobStatus {
	case "pending", "in-progress", "succeeded":
		return true, nil
	}
	return false, nil
}

// PreviousProduction returns the deployment the project's production domain
// serves right now. Call it before deploying, so it names what to roll back
// to. ok is false when the project has never had a production deployment.
//
// It asks the production *.vercel.app alias which deployment it points at,
// rather than taking the newest READY production deployment: after a rollback
// that was undone by promoting the older deployment, the newest one is the bad
// release, and rolling back to it would put the bad release back.
func (c *Client) PreviousProduction(ctx context.Context, projectID string) (deploymentID string, ok bool, err error) {
	names, err := c.vercelAppDomains(ctx, projectID)
	if err != nil {
		return "", false, err
	}
	if len(names) == 0 {
		return "", false, nil
	}
	var alias struct {
		DeploymentID string `json:"deploymentId"`
	}
	err = c.do(ctx, "GET", "/v4/aliases/"+url.PathEscape(names[0]), url.Values{"projectId": {projectID}}, nil, &alias)
	if IsNotFound(err) {
		// The domain exists but no deployment has been aliased to it yet.
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return alias.DeploymentID, alias.DeploymentID != "", nil
}

// Rollback points the project's production domains back at deploymentID
// (Instant Rollback). Afterwards Vercel stops assigning production domains to
// new deployments until someone undoes the rollback (Undo Rollback in the
// dashboard, or `vercel promote`).
func (c *Client) Rollback(ctx context.Context, projectID, deploymentID string) error {
	return c.do(ctx, "POST", "/v1/projects/"+url.PathEscape(projectID)+"/rollback/"+url.PathEscape(deploymentID), nil, nil, nil)
}
