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
)

const usage = "usage: pipeline <check|e2e|release|smoke|setup>"

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
	stage := os.Args[1]
	if err := dispatch(stage, os.Args[2:]); err != nil {
		fmt.Fprintf(os.Stderr, "pipeline: %s: %v\n", stage, err)
		os.Exit(1)
	}
}

func dispatch(stage string, args []string) error {
	switch stage {
	case "check", "e2e":
	case "release", "smoke", "setup":
		return fmt.Errorf("not implemented yet")
	default:
		return fmt.Errorf("unknown stage (%s)", usage)
	}
	if len(args) > 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(args, " "))
	}

	root, err := repoRoot()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	r := run.New(root, os.Stdout)
	defer r.Close()
	// Register secrets before anything can print them.
	r.Mask(run.MaskFromEnv(os.Environ())...)

	switch stage {
	case "check":
		return stages.Check(ctx, r)
	case "e2e":
		return stages.E2E(ctx, r, os.Getenv("DATABASE_URL"))
	}
	return nil
}

func repoRoot() (string, error) {
	out, err := exec.Command("git", "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return "", fmt.Errorf("finding the repo root with git: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}
