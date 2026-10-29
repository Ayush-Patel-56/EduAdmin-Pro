// Pure rules of Feedback Management (PRD 4.12): direction and category names
// as people write them in a sheet, and the Sentiment Keywords drawn from what
// was actually written (never sample words).

// Student -> Teacher comes only through a batch's feedback link, never an import.
export const FEEDBACK_DIRECTIONS = ['TEACHER_TO_MANAGEMENT', 'MANAGEMENT_TO_TEACHER', 'STUDENT_TO_TEACHER'] as const;
export const FEEDBACK_CATEGORIES = ['ACADEMICS', 'DISCIPLINE', 'PUNCTUALITY', 'TEACHING_QUALITY', 'ADMINISTRATION', 'GENERAL'] as const;
export const FEEDBACK_STATUSES = ['SUBMITTED', 'REVIEWED', 'ACTIONED', 'DISMISSED'] as const;
export type FeedbackDirection = (typeof FEEDBACK_DIRECTIONS)[number];
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  ACADEMICS: 'Academics',
  DISCIPLINE: 'Discipline',
  PUNCTUALITY: 'Punctuality',
  TEACHING_QUALITY: 'Teaching Quality',
  ADMINISTRATION: 'Administration',
  GENERAL: 'General',
};
export const DIRECTION_LABELS: Record<FeedbackDirection, string> = {
  TEACHER_TO_MANAGEMENT: 'Teacher -> Management',
  MANAGEMENT_TO_TEACHER: 'Management -> Teacher',
  STUDENT_TO_TEACHER: 'Student -> Teacher',
};

const letters = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '');

/** "Teacher -> Management", "teacher → management", "Teacher to Management", "TEACHER_TO_MANAGEMENT". */
export function parseDirection(text: string | undefined): FeedbackDirection | null {
  const key = letters(text ?? '');
  if (key === 'teachermanagement' || key === 'teachertomanagement') return 'TEACHER_TO_MANAGEMENT';
  if (key === 'managementteacher' || key === 'managementtoteacher') return 'MANAGEMENT_TO_TEACHER';
  return null;
}

/** "Teaching Quality", "teaching_quality", "TEACHING QUALITY". Blank is General. */
export function parseCategory(text: string | undefined): FeedbackCategory | null {
  const key = letters(text ?? '');
  if (!key) return 'GENERAL';
  return FEEDBACK_CATEGORIES.find((c) => letters(c) === key) ?? null;
}

/** Categories whose name contains the search text (3+ letters), so "acad" finds Academics. */
export function categoriesMatching(text: string): FeedbackCategory[] {
  const key = letters(text);
  return key.length >= 3 ? FEEDBACK_CATEGORIES.filter((c) => letters(CATEGORY_LABELS[c]).includes(key)) : [];
}

/** A target cell that means every teacher, rather than one. */
export function isAllFaculty(text: string | undefined): boolean {
  return ['', 'all', 'allfaculty', 'allteachers', 'everyone', 'staff', 'allstaff'].includes(letters(text ?? ''));
}

// Words that say nothing about the topic on their own.
const STOPWORDS = new Set(
  (
    'a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing ' +
    'down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not ' +
    'now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this ' +
    'those through to too under until up very was we were what when where which while who whom why will with would you your yours ' +
    'get got make made much many really well good great nice ok okay thank thanks please hello hi sir madam maam dear also one two three ' +
    'teacher teachers management school student students class classes feedback ' +
    // Contractions say nothing on their own either.
    "it's i'm i've i'd i'll you're you've we're we've they're they've that's there's what's let's " +
    "don't doesn't didn't can't couldn't won't wouldn't isn't aren't wasn't weren't hasn't haven't shouldn't"

  ).split(' '),
);

export type Keyword = { phrase: string; mentions: number; averageRating: number };

/**
 * The topics most written about: words and two-word phrases (stopwords left
 * out), ranked by how many entries mention them. A topic needs at least two
 * entries, so one stray word never shows as a trend; a phrase hides the
 * single words it is made of when it is mentioned as often.
 */
export function sentimentKeywords(entries: { content: string; rating: number }[], limit = 8): Keyword[] {
  const seen = new Map<string, { entries: number; ratingSum: number }>();
  for (const e of entries) {
    // Letters of any script (so Hindi counts too), with ' and - inside a word; curly ’ is read as '.
    const words = e.content.toLowerCase().replace(/\u2019/g, "'").match(/[\p{L}\p{M}][\p{L}\p{M}'-]*[\p{L}\p{M}]|\p{L}/gu) ?? [];
    const topics = new Set<string>();
    words.forEach((w, i) => {
      if (w.length < 3 || STOPWORDS.has(w)) return;
      topics.add(w);
      const next = words[i + 1];
      if (next && next.length >= 3 && !STOPWORDS.has(next)) topics.add(`${w} ${next}`);
    });
    for (const t of topics) {
      const s = seen.get(t) ?? { entries: 0, ratingSum: 0 };
      s.entries += 1;
      s.ratingSum += e.rating;
      seen.set(t, s);
    }
  }
  const ranked = [...seen.entries()]
    .filter(([, s]) => s.entries >= 2)
    .sort((a, b) => b[1].entries - a[1].entries || b[0].split(' ').length - a[0].split(' ').length || a[0].localeCompare(b[0]));
  const out: Keyword[] = [];
  for (const [phrase, s] of ranked) {
    if (out.length >= limit) break;
    const words = phrase.split(' ');
    // "doubt clearing" (3 entries) makes "doubt" (3) and "clearing" (3) redundant.
    const covered = words.length === 1 && out.some((k) => k.phrase.toLowerCase().split(' ').includes(phrase) && k.mentions >= s.entries);
    if (covered) continue;
    out.push({ phrase: words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), mentions: s.entries, averageRating: Math.round((s.ratingSum / s.entries) * 10) / 10 });
  }
  return out;
}
