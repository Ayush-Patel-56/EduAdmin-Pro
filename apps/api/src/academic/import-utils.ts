/** What every bulk import returns, both for the preview and after applying. */
export type ImportPreview = {
  /** false for a dry run (preview only). */
  applied: boolean;
  created: number;
  updated: number;
  skipped: number;
  rows: {
    row: number;
    label: string;
    action: 'create' | 'update' | 'error';
    errors: string[];
  }[];
};

/** "Physics, Chemistry" / "A; B" / one per line -> ["Physics", "Chemistry"]. */
export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  return value
    .split(/[,;\n]/)
    .map((v) => v.trim().replace(/\s+/g, ' '))
    .filter((v) => {
      const key = v.toLowerCase();
      if (!v || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Accepts YYYY-MM-DD (the template format) or DD-MM-YYYY / DD/MM/YYYY. */
export function parseImportDate(
  value: string | undefined,
  label: string,
  errors: string[],
): Date | null {
  const text = value?.trim();
  if (!text) return null;
  let iso = text;
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (dmy)
    iso = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T00:00:00Z`)
    : null;
  if (
    !date ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== iso
  ) {
    errors.push(`${label} must be a date like 2026-04-01`);
    return null;
  }
  return date;
}
