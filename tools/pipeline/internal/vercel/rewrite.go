package vercel

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const apiOriginPlaceholder = "__API_ORIGIN__"

// WriteRewrite replaces __API_ORIGIN__ in webDir/vercel.json with apiOrigin
// (without a trailing slash), so the web project's /api/* rewrite points at the
// API project. The placeholder stays in git; this only edits the CI checkout.
func WriteRewrite(webDir, apiOrigin string) error {
	apiOrigin = strings.TrimRight(strings.TrimSpace(apiOrigin), "/")
	if !strings.HasPrefix(apiOrigin, "https://") && !strings.HasPrefix(apiOrigin, "http://") {
		return fmt.Errorf("the API origin must start with https://")
	}
	path := filepath.Join(webDir, "vercel.json")
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if !strings.Contains(string(b), apiOriginPlaceholder) {
		return fmt.Errorf("%s has no %s to replace", path, apiOriginPlaceholder)
	}
	out := strings.ReplaceAll(string(b), apiOriginPlaceholder, apiOrigin)
	return os.WriteFile(path, []byte(out), 0o644)
}
