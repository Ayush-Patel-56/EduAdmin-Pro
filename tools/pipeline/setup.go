package main

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/run"
	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/vercel"
)

// runSetup creates or updates both Vercel projects and writes the API project's
// production environment. It is safe to run again. It prints project names and
// the web origin only, never an env value.
func runSetup(ctx context.Context, r *run.Runner, out io.Writer, getenv func(string) string, apiBase string) error {
	token, team := getenv("VERCEL_TOKEN"), getenv("VERCEL_ORG_ID")
	var missing []string
	if token == "" {
		missing = append(missing, "VERCEL_TOKEN")
	}
	if team == "" {
		missing = append(missing, "VERCEL_ORG_ID")
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing %s", strings.Join(missing, ", "))
	}
	r.Mask(token)
	c := vercel.NewClient(token, team, apiBase)

	r.Stage("vercel projects")
	api, err := c.EnsureProject(ctx, vercel.APISpec)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "project %s ready\n", api.Name)
	web, err := c.EnsureProject(ctx, vercel.WebSpec)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "project %s ready\n", web.Name)

	// A project that has never been deployed has no *.vercel.app domain yet,
	// and the API's WEB_ORIGIN needs the web one now.
	for _, p := range []vercel.Project{api, web} {
		if err := c.EnsureDomain(ctx, p.ID, p.Name); err != nil {
			return err
		}
	}

	webOrigin, err := c.ProductionOrigin(ctx, web.ID)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "web origin %s\n", webOrigin)

	env, err := vercel.APIEnv(getenv, webOrigin)
	if err != nil {
		return err
	}
	// The values are secrets and the ones that aren't are short; mask the
	// secret ones explicitly so no later error can print them.
	for _, k := range []string{"DATABASE_URL", "SMTP_PASS", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "CRON_SECRET"} {
		r.Mask(env[k])
	}

	r.Stage("api environment")
	if err := c.SyncEnv(ctx, api.ID, env); err != nil {
		return err
	}
	fmt.Fprintf(out, "%s: %d production variables written\n", api.Name, len(env))
	return nil
}
