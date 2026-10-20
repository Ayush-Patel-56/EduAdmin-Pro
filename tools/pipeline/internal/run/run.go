// Package run executes child processes for the pipeline and keeps registered
// secrets out of everything it prints. The repository is public, so CI logs
// are public too: masking here is a security requirement.
package run

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const (
	maskMarker = "***"
	// Shorter values ("1", "yes") would corrupt unrelated output when masked.
	minMaskLen = 4
)

// Runner runs commands, streaming their output through the secret masker.
type Runner struct {
	// Exec runs a prepared command. It defaults to cmd.Run; tests replace it
	// to record commands instead of executing them.
	Exec func(cmd *exec.Cmd) error

	root    string
	out     io.Writer
	actions bool // running on GitHub Actions

	mu      sync.Mutex
	secrets []string // longest first
	inGroup bool
}

// New returns a Runner that runs commands relative to repoRoot and writes to out.
func New(repoRoot string, out io.Writer) *Runner {
	return &Runner{
		root:    repoRoot,
		out:     &syncWriter{w: out},
		actions: os.Getenv("GITHUB_ACTIONS") == "true",
	}
}

// Mask registers secret values to be replaced with *** in everything the
// runner prints. Empty values and values shorter than 4 characters are
// ignored. On GitHub Actions each value is also registered with the runner via
// ::add-mask:: so the platform masks it in logs of other steps too.
func (r *Runner) Mask(values ...string) {
	for _, v := range values {
		for _, s := range maskCandidates(v) {
			if r.addSecret(s) && r.actions {
				// Written to the raw writer: this line must not be masked.
				fmt.Fprintf(r.out, "::add-mask::%s\n", s)
			}
		}
	}
}

// maskCandidates expands a value into the strings to register: each line of a
// multi-line value (masking works line by line), and the password of a
// database URL, which can show up on its own in error messages.
func maskCandidates(v string) []string {
	var out []string
	for _, line := range strings.FieldsFunc(v, func(c rune) bool { return c == '\n' || c == '\r' }) {
		out = append(out, line)
		if hasDatabaseScheme(line) {
			if u, err := url.Parse(line); err == nil && u.User != nil {
				if pw, ok := u.User.Password(); ok {
					out = append(out, pw)
				}
			}
		}
	}
	return out
}

func hasDatabaseScheme(v string) bool {
	return strings.HasPrefix(v, "postgres://") || strings.HasPrefix(v, "postgresql://")
}

// addSecret reports whether s was newly registered.
func (r *Runner) addSecret(s string) bool {
	if len(s) < minMaskLen {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, have := range r.secrets {
		if have == s {
			return false
		}
	}
	r.secrets = append(r.secrets, s)
	sort.SliceStable(r.secrets, func(i, j int) bool { return len(r.secrets[i]) > len(r.secrets[j]) })
	return true
}

func (r *Runner) mask(line string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, s := range r.secrets {
		line = strings.ReplaceAll(line, s, maskMarker)
	}
	return line
}

// Stage announces the start of a pipeline stage. On GitHub Actions it opens a
// collapsible log group (closing the previous one).
func (r *Runner) Stage(name string) {
	name = r.mask(name)
	r.Close()
	if r.actions {
		fmt.Fprintf(r.out, "::group::%s\n", name)
		r.mu.Lock()
		r.inGroup = true
		r.mu.Unlock()
	}
	fmt.Fprintf(r.out, "==> %s\n", name)
}

// Close ends the log group opened by the last Stage, if any.
func (r *Runner) Close() {
	r.mu.Lock()
	open := r.inGroup
	r.inGroup = false
	r.mu.Unlock()
	if open {
		fmt.Fprintln(r.out, "::endgroup::")
	}
}

// Cmd runs name with args in dir (relative to the repo root; "" is the root).
// env entries ("KEY=value") are added to the parent environment for the child
// only. Combined stdout and stderr stream to the runner's output, masked.
// On failure the error names the command but never its arguments or env.
func (r *Runner) Cmd(ctx context.Context, dir string, env []string, name string, args ...string) error {
	w := newLineMasker(r)
	defer w.flush()
	cmd := r.command(ctx, dir, env, name, args)
	cmd.Stdout = w
	cmd.Stderr = w
	return r.run(cmd, name)
}

// Output runs the command like Cmd but returns its stdout instead of
// streaming it. Stderr still streams, masked. The returned text is not masked:
// it is for the caller, not the log.
func (r *Runner) Output(ctx context.Context, dir string, env []string, name string, args ...string) (string, error) {
	w := newLineMasker(r)
	defer w.flush()
	var stdout bytes.Buffer
	cmd := r.command(ctx, dir, env, name, args)
	cmd.Stdout = &stdout
	cmd.Stderr = w
	err := r.run(cmd, name)
	return stdout.String(), err
}

func (r *Runner) command(ctx context.Context, dir string, env []string, name string, args []string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = r.root
	if dir != "" {
		cmd.Dir = dir
		if !filepath.IsAbs(dir) {
			cmd.Dir = filepath.Join(r.root, dir)
		}
	}
	// A later duplicate key wins, so env overrides the parent's values.
	cmd.Env = append(os.Environ(), env...)
	return cmd
}

func (r *Runner) run(cmd *exec.Cmd, name string) error {
	execute := r.Exec
	if execute == nil {
		execute = func(c *exec.Cmd) error { return c.Run() }
	}
	if err := execute(cmd); err != nil {
		return fmt.Errorf("%s: %w", filepath.Base(name), err)
	}
	return nil
}

// MaskFromEnv returns the values in environ ("KEY=value" entries) that look
// like secrets: keys ending in _TOKEN, _KEY, _SECRET or _PASS, keys starting
// with PROD_, and any value that is a postgres:// or postgresql:// URL.
func MaskFromEnv(environ []string) []string {
	var out []string
	for _, kv := range environ {
		key, value, ok := strings.Cut(kv, "=")
		if !ok || value == "" {
			continue
		}
		key = strings.ToUpper(key)
		if strings.HasSuffix(key, "_TOKEN") || strings.HasSuffix(key, "_KEY") ||
			strings.HasSuffix(key, "_SECRET") || strings.HasSuffix(key, "_PASS") ||
			strings.HasPrefix(key, "PROD_") || hasDatabaseScheme(value) {
			out = append(out, value)
		}
	}
	return out
}

// syncWriter serialises writes so stdout and stderr lines never interleave.
type syncWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (s *syncWriter) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.w.Write(p)
}

// lineMasker buffers child output into lines and writes each one masked, so a
// secret split across two writes is still caught.
type lineMasker struct {
	r   *Runner
	mu  sync.Mutex
	buf []byte
}

func newLineMasker(r *Runner) *lineMasker { return &lineMasker{r: r} }

func (m *lineMasker) Write(p []byte) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.buf = append(m.buf, p...)
	for {
		i := bytes.IndexByte(m.buf, '\n')
		if i < 0 {
			break
		}
		m.emit(string(m.buf[:i]))
		m.buf = m.buf[i+1:]
	}
	return len(p), nil
}

// flush writes a trailing partial line (output with no final newline), ending
// it so the next thing printed starts on a fresh line.
func (m *lineMasker) flush() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.buf) > 0 {
		m.emit(string(m.buf))
		m.buf = nil
	}
}

func (m *lineMasker) emit(line string) {
	io.WriteString(m.r.out, m.r.mask(line)+"\n")
}
