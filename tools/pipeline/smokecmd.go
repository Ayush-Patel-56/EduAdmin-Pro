package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/run"
	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/smoke"
)

// parseSmokeArgs reads `--web URL --api URL`. Both are required origins.
func parseSmokeArgs(args []string) (web, api string, err error) {
	fs := flag.NewFlagSet("smoke", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&web, "web", "", "web origin, e.g. https://eduadmin-web.vercel.app")
	fs.StringVar(&api, "api", "", "API origin, e.g. https://eduadmin-api.vercel.app")
	if err := fs.Parse(args); err != nil {
		return "", "", fmt.Errorf("%v (usage: smoke --web URL --api URL)", err)
	}
	if fs.NArg() > 0 {
		return "", "", fmt.Errorf("unexpected arguments (usage: smoke --web URL --api URL)")
	}
	for _, o := range []struct{ flag, val string }{{"--web", web}, {"--api", api}} {
		if o.val == "" {
			return "", "", fmt.Errorf("missing %s (usage: smoke --web URL --api URL)", o.flag)
		}
		if u, perr := url.Parse(o.val); perr != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return "", "", fmt.Errorf("%s must be an http(s) origin", o.flag)
		}
	}
	return web, api, nil
}

// runSmoke runs the smoke checks and prints one line per check. A nil client
// gets smoke's default. Every line goes through the runner's masker, since the
// text comes from network errors.
func runSmoke(ctx context.Context, r *run.Runner, out io.Writer, client *http.Client, web, api string) error {
	r.Stage("smoke")
	results := smoke.Run(ctx, client, web, api)
	failed := 0
	for _, res := range results {
		if res.Err != nil {
			failed++
			fmt.Fprintln(out, r.Redact(fmt.Sprintf("FAIL %s: %v", res.Name, res.Err)))
			continue
		}
		fmt.Fprintf(out, "ok   %s\n", res.Name)
	}
	if smoke.Failed(results) {
		return fmt.Errorf("%d of %d smoke checks failed", failed, len(results))
	}
	return nil
}
