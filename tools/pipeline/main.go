// Command pipeline is the CI/CD driver for EduAdmin Pro. GitHub Actions calls
// it as `go -C tools/pipeline run . <stage>`.
package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"strings"

	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/run"
	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/stages"
	"github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline/internal/vercel"
)

const usage = "usage: pipeline <check|e2e|release|smoke|setup>"

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
	stage := os.Args[1]
	// Nothing secret exists yet, so these errors print as they are.
	if err := validate(stage, os.Args[2:]); err != nil {
		fmt.Fprintf(os.Stderr, "pipeline: %s: %v\n", stage, err)
		os.Exit(1)
	}
	root, err := repoRoot()
	if err != nil {
		fmt.Fprintf(os.Stderr, "pipeline: %s: %v\n", stage, err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	r := run.New(root, os.Stdout)
	// Register secrets before anything can print them.
	r.Mask(run.MaskFromEnv(os.Environ())...)

	err = dispatch(ctx, r, stage)
	r.Close()
	stop()
	if err != nil {
		fmt.Fprintln(os.Stderr, stageError(r, stage, err))
		os.Exit(1)
	}
}

// validate rejects an unknown or unfinished stage and stray arguments.
func validate(stage string, args []string) error {
	switch stage {
	case "check", "e2e", "setup":
	case "release", "smoke":
		return fmt.Errorf("not implemented yet")
	default:
		return fmt.Errorf("unknown stage (%s)", usage)
	}
	if len(args) > 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(args, " "))
	}
	return nil
}

func dispatch(ctx context.Context, r *run.Runner, stage string) error {
	switch stage {
	case "check":
		return stages.Check(ctx, r)
	case "e2e":
		return stages.E2E(ctx, r, os.Getenv("DATABASE_URL"))
	case "setup":
		return runSetup(ctx, r, os.Stdout, os.Getenv, vercel.DefaultBase)
	}
	return nil
}

// stageError formats a failed stage's error for the log. It goes through the
// runner's masker so an error that wraps a URL or a response can't print a
// secret.
func stageError(r *run.Runner, stage string, err error) string {
	return fmt.Sprintf("pipeline: %s: %s", stage, r.Redact(err.Error()))
}

func repoRoot() (string, error) {
	out, err := exec.Command("git", "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return "", fmt.Errorf("finding the repo root with git: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}
