package stages

import (
	"fmt"
	"regexp"
	"strings"
)

// Migration is a Prisma migration not yet applied to production.
type Migration struct {
	Name string // folder name under apps/api/prisma/migrations
	SQL  string // its migration.sql
}

var (
	dropTable  = regexp.MustCompile(`\bDROP\s+TABLE\b`)
	dropColumn = regexp.MustCompile(`\bDROP\s+COLUMN\b`)
	dropType   = regexp.MustCompile(`\bDROP\s+TYPE\b`)
	alterTable = regexp.MustCompile(`\bALTER\s+(TABLE|TYPE)\b`)
	renameWord = regexp.MustCompile(`\bRENAME\b(\s+(\S+))?`)
	// A migration folder name: no separators, so it can't leave the folder.
	migrationName = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
)

// RiskyStatements returns the kind of each statement in sql that removes or
// renames something the running code may still use: "DROP TABLE",
// "DROP COLUMN", "DROP TYPE" or "RENAME" (ALTER TABLE/TYPE ... RENAME). One
// entry per risky statement, in order. `--` comments are ignored, and so are
// statements that only drop a constraint, index, default or NOT NULL, or
// rename a constraint. It returns kinds rather than the SQL so a warning
// doesn't print the migration's text.
func RiskyStatements(sql string) []string {
	var code strings.Builder
	for _, line := range strings.Split(sql, "\n") {
		if i := strings.Index(line, "--"); i >= 0 {
			line = line[:i]
		}
		code.WriteString(line)
		code.WriteByte('\n')
	}
	var kinds []string
	for _, stmt := range strings.Split(code.String(), ";") {
		s := strings.ToUpper(strings.Join(strings.Fields(stmt), " "))
		switch {
		case dropTable.MatchString(s):
			kinds = append(kinds, "DROP TABLE")
		case dropColumn.MatchString(s):
			kinds = append(kinds, "DROP COLUMN")
		case dropType.MatchString(s):
			kinds = append(kinds, "DROP TYPE")
		case alterTable.MatchString(s) && renamesSomethingUsed(s):
			kinds = append(kinds, "RENAME")
		}
	}
	return kinds
}

// renamesSomethingUsed reports whether an ALTER statement renames anything
// other than a constraint.
func renamesSomethingUsed(stmt string) bool {
	for _, m := range renameWord.FindAllStringSubmatch(stmt, -1) {
		if m[2] != "CONSTRAINT" {
			return true
		}
	}
	return false
}

// parsePending reads the unapplied migration names out of `prisma migrate
// status` output. found is false when the output has no such list.
func parsePending(out string) (names []string, found bool, err error) {
	lines := strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n")
	for i, line := range lines {
		if !strings.HasSuffix(strings.TrimSpace(line), "have not yet been applied:") {
			continue
		}
		for _, l := range lines[i+1:] {
			l = strings.TrimSpace(l)
			if l == "" {
				break
			}
			if !migrationName.MatchString(l) {
				return nil, true, fmt.Errorf("prisma migrate status listed an unexpected migration name")
			}
			names = append(names, l)
		}
		return names, true, nil
	}
	return nil, false, nil
}

// isLockTimeout reports whether migrate output shows a lock timeout: Postgres
// cancelling a statement on lock_timeout, or Prisma giving up on its advisory
// lock.
func isLockTimeout(out string) bool {
	o := strings.ToLower(out)
	return strings.Contains(o, "lock timeout") || strings.Contains(o, "lock_timeout") ||
		strings.Contains(o, "advisory lock")
}

// migrateError explains a failed `prisma migrate deploy`. The command's output
// is already in the log; this adds what state production is in and what to do.
func migrateError(out string, err error) error {
	msg := "prisma migrate deploy failed (its output is above), so nothing was deployed and the site still runs the previous release"
	if isLockTimeout(out) {
		msg += ". It timed out waiting for a lock: a long-running query held a table it needed. Wait for a quiet moment"
	}
	msg += ". If a migration was left marked as failed, check which of its statements took effect, then mark it rolled back with `pnpm --filter api exec prisma migrate resolve --rolled-back <migration>` against PROD_DIRECT_URL (see docs/deploy.md) and run the release again"
	return fmt.Errorf("%s: %w", msg, err)
}
