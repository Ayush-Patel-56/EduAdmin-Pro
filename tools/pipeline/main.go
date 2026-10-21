// Command pipeline is the CI/CD driver for EduAdmin Pro. GitHub Actions builds
// it and runs the binary, so a cancelled run's SIGTERM reaches it (`go run` does
// not pass signals on). Locally: `go -C tools/pipeline run . <stage>`.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"

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

	ctx, stop := signal.NotifyContext(context.Background(), shutdownSignals...)
	r := run.New(root, os.Stdout)
	// Register secrets before anything can print them.
	r.Mask(run.MaskFromEnv(os.Environ())...)

	err = dispatch(ctx, r, root, stage, os.Args[2:])
	r.Close()
	stop()
	if err != nil {
		fmt.Fprintln(os.Stderr, stageError(r, stage, err))
		os.Exit(1)
	}
}

// shutdownSignals cancel the stage's context: Ctrl-C locally, and SIGTERM,
// which GitHub Actions sends when a run is cancelled. A cancelled release
// still rolls back what it deployed.
var shutdownSignals = []os.Signal{os.Interrupt, syscall.SIGTERM}

// validate rejects an unknown or unfinished stage and stray arguments.
func validate(stage string, args []string) error {
	switch stage {
	case "check", "e2e", "setup":
	case "smoke":
		_, _, err := parseSmokeArgs(args)
		return err
	case "release":
		_, err := parseReleaseArgs(args)
		return err
	default:
		return fmt.Errorf("unknown stage (%s)", usage)
	}
	if len(args) > 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(args, " "))
	}
	return nil
}

func dispatch(ctx context.Context, r *run.Runner, root, stage string, args []string) error {
	switch stage {
	case "check":
		return stages.Check(ctx, r)
	case "e2e":
		return stages.E2E(ctx, r, os.Getenv("DATABASE_URL"))
	case "setup":
		return runSetup(ctx, r, os.Stdout, os.Getenv, vercel.DefaultBase)
	case "smoke":
		web, api, err := parseSmokeArgs(args)
		if err != nil {
			return err
		}
		return runSmoke(ctx, r, os.Stdout, nil, web, api)
	case "release":
		return runRelease(ctx, r, root, os.Getenv, args, vercel.DefaultBase)
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

// parseReleaseArgs reads the only release flag, --allow-local.
func parseReleaseArgs(args []string) (allowLocal bool, err error) {
	fs := flag.NewFlagSet("release", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.BoolVar(&allowLocal, "allow-local", false, "release from somewhere other than main on GitHub Actions")
	if err := fs.Parse(args); err != nil {
		return false, fmt.Errorf("%v (usage: release [--allow-local])", err)
	}
	if fs.NArg() > 0 {
		return false, fmt.Errorf("unexpected arguments (usage: release [--allow-local])")
	}
	return allowLocal, nil
}

// checkReleaseRef refuses a release that isn't running for main, so one can't
// be started from a branch by mistake.
func checkReleaseRef(ref string, allowLocal bool) error {
	if ref == "refs/heads/main" || allowLocal {
		return nil
	}
	return fmt.Errorf("refusing to release: GITHUB_REF is not refs/heads/main. Releases run from main on GitHub Actions; to release from this machine on purpose, pass --allow-local")
}

// runRelease checks it may run, then ships the checkout to production.
func runRelease(ctx context.Context, r *run.Runner, root string, getenv func(string) string, args []string, apiBase string) error {
	allowLocal, err := parseReleaseArgs(args)
	if err != nil {
		return err
	}
	if err := checkReleaseRef(getenv("GITHUB_REF"), allowLocal); err != nil {
		return err
	}
	live, err := stages.NewLive(r, root, getenv, apiBase)
	if err != nil {
		return err
	}
	return stages.Release(ctx, r, live)
}
