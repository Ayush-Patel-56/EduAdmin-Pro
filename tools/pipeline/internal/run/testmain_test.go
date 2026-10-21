package run_test

import (
	"os"
	"testing"
)

// TestMain clears GITHUB_ACTIONS so run.New does not switch on the Actions log
// commands (::add-mask:: and ::group::) when these tests run on a runner; they
// read the same output the assertions check.
func TestMain(m *testing.M) {
	os.Unsetenv("GITHUB_ACTIONS")
	os.Exit(m.Run())
}
