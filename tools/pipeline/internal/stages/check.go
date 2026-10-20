// Package stages holds the pipeline's stages. Each one drives the runner and
// is tested by recording the commands it would run.
package stages

import (
	"context"
	"fmt"
	"strings"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/run"
)

// pipelineDir is the Go module that holds this program, relative to the repo root.
const pipelineDir = "tools/pipeline"

// webTimezones are the zones the web tests run under: one with a half-hour
// offset, one behind UTC, and the furthest ahead (UTC+14). Date handling that
// only works in the developer's own zone shows up here.
var webTimezones = []string{"Asia/Kolkata", "America/Los_Angeles", "Pacific/Kiritimati"}

// Check runs every static check and test suite that needs no database:
// typecheck, lint, API and web unit tests, the build, and the Go checks for
// this program. It stops at the first failure.
func Check(ctx context.Context, r *run.Runner) error {
	r.Stage("typecheck")
	if err := r.Cmd(ctx, "", nil, "pnpm", "--filter", "api", "exec", "tsc", "--noEmit"); err != nil {
		return err
	}
	if err := r.Cmd(ctx, "", nil, "pnpm", "--filter", "web", "exec", "tsc", "-b"); err != nil {
		return err
	}

	r.Stage("lint")
	if err := r.Cmd(ctx, "", nil, "pnpm", "lint"); err != nil {
		return err
	}

	r.Stage("api unit tests")
	if err := r.Cmd(ctx, "", nil, "pnpm", "--filter", "api", "test"); err != nil {
		return err
	}

	for _, tz := range webTimezones {
		r.Stage("web unit tests (TZ=" + tz + ")")
		// TZ goes to the child only; the parent's environment is untouched.
		if err := r.Cmd(ctx, "", []string{"TZ=" + tz}, "pnpm", "--filter", "web", "test"); err != nil {
			return err
		}
	}

	r.Stage("build")
	if err := r.Cmd(ctx, "", nil, "pnpm", "build"); err != nil {
		return err
	}

	r.Stage("go checks")
	if err := r.Cmd(ctx, pipelineDir, nil, "go", "vet", "./..."); err != nil {
		return err
	}
	listed, err := r.Output(ctx, pipelineDir, nil, "gofmt", "-l", ".")
	if err != nil {
		return err
	}
	if files := strings.Fields(listed); len(files) > 0 {
		return fmt.Errorf("gofmt: these files are not formatted: %s", strings.Join(files, ", "))
	}
	return r.Cmd(ctx, pipelineDir, nil, "go", "test", "./...")
}
