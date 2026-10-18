// Reads a question-bank PDF's text (PRD import specs, HLD 10.1). The browser
// extracts the text (selectable text only: scanned pages have none); this
// turns it into questions. Format:
//
//   Subject: Physics            <- header block at the top
//   Topic: Thermodynamics
//   Difficulty: Medium
//   Type: MCQ
//   Marks: 4                    (default 4)
//   Negative Marks: -1          (default 0)
//   Source: Custom              (default PDF Upload)
//
//   1. What is the SI unit of temperature?     <- numbered "1." or "Q1."
//   (A) Celsius  (B) Kelvin  (C) Fahrenheit  (D) Rankine
//
//   ANSWER KEY                  <- the last block
//   1. B
//   2. 4 seconds                (number + answer)

export type PdfHeader = {
  subject: string;
  topic: string;
  difficulty: string;
  type: string;
  marks: string;
  negativeMarks: string;
  source: string;
};
/** `ambiguous`: the (A)-(D) markers could be split more than one way (see splitOptions). */
export type PdfQuestion = { number: number; text: string; options: string[]; answer: string | null; ambiguous?: boolean };

const HEADER_KEYS: Record<string, keyof PdfHeader> = {
  subject: 'subject',
  topic: 'topic',
  difficulty: 'difficulty',
  type: 'type',
  marks: 'marks',
  negativemarks: 'negativeMarks',
  source: 'source',
};

const QUESTION_START = /^\s*(?:Q\.?\s*)?(\d{1,3})\s*[.)]\s+(.*)$/i;
const ANSWER_KEY = /^\s*answer\s*key\s*:?\s*$/i;

/**
 * Splits the text into its header, numbered questions and answer key. Throws
 * a message the person can act on when the file isn't in the format at all;
 * problems with single questions are left for the caller to report per row.
 */
export function parseQuestionPdf(text: string): { header: PdfHeader; questions: PdfQuestion[] } {
  const lines = text.replace(/\r/g, '').replace(/ /g, ' ').split('\n').map((l) => l.trimEnd());
  const header: Partial<PdfHeader> = {};
  let i = 0;
  // The header block: "Key: value" lines before the first question.
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (QUESTION_START.test(line)) break;
    const m = /^([A-Za-z ]+?)\s*:\s*(.*)$/.exec(line);
    const key = m && HEADER_KEYS[m[1].toLowerCase().replace(/\s+/g, '')];
    if (key) header[key] = m[2].trim();
  }
  const missing = (['subject', 'topic', 'difficulty', 'type'] as const).filter((k) => !header[k]);
  if (missing.length) {
    throw new Error(`The header block at the top must give ${missing.map((k) => k[0].toUpperCase() + k.slice(1)).join(', ')}. Download the sample template to see the format.`);
  }

  const keyAt = lines.findIndex((l, j) => j >= i && ANSWER_KEY.test(l));
  const body = lines.slice(i, keyAt === -1 ? undefined : keyAt);
  const keyLines = keyAt === -1 ? [] : lines.slice(keyAt + 1);

  // Questions: from one number to the next.
  const blocks: { number: number; lines: string[] }[] = [];
  for (const line of body) {
    const m = QUESTION_START.exec(line);
    if (m) blocks.push({ number: Number(m[1]), lines: [m[2]] });
    else if (blocks.length && line.trim()) blocks[blocks.length - 1].lines.push(line.trim());
  }
  if (!blocks.length) throw new Error('No numbered questions were found. Number them 1. 2. 3. or Q1. Q2. Q3.');

  const answers = new Map<number, string>();
  for (const line of keyLines) {
    const m = /^\s*(?:Q\.?\s*)?(\d{1,3})\s*[.):-]?\s+(.+?)\s*$/i.exec(line);
    if (m) answers.set(Number(m[1]), m[2]);
  }

  const questions = blocks.map((b) => {
    const joined = b.lines.join('\n');
    const found = splitOptions(joined);
    const text = (found ? joined.slice(0, found.start) : joined).trim();
    if (found && 'ambiguous' in found) return { number: b.number, text, options: [], answer: answers.get(b.number) ?? null, ambiguous: true };
    return { number: b.number, text, options: found?.options ?? [], answer: answers.get(b.number) ?? null };
  });
  return {
    header: {
      subject: header.subject!,
      topic: header.topic!,
      difficulty: header.difficulty!,
      type: header.type!,
      marks: header.marks ?? '4',
      negativeMarks: header.negativeMarks ?? '0',
      source: header.source || 'PDF Upload',
    },
    questions,
  };
}

const MARKERS: Record<string, RegExp> = { A: /\(\s*A\s*\)/g, B: /\(\s*B\s*\)/g, C: /\(\s*C\s*\)/g, D: /\(\s*D\s*\)/g };
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

type Marker = { index: number; end: number; lineStart: boolean };
type Run = [Marker, Marker, Marker, Marker];

/**
 * Finds the options in a question's text, each option running to the next
 * letter:
 *  1. When every option starts its own line, that run is the options (so any
 *     "(A)"/"(B)" inside the question or an option is just text), unless
 *     another full (A)-(D) run follows it: then the lines were a list in the
 *     question ("Match the following: (A) Force / (B) Energy / …") and the
 *     run after it is the options, read as in 2.
 *  2. Otherwise the last "(A)" followed by "(B)", "(C)" and "(D)" starts them,
 *     and each later letter is read two ways: its last marker that still
 *     leaves the rest in order, and its first. When both readings agree the
 *     split is clear ("Is it (A) a noun or (B) a verb? (A) run (B) dog …",
 *     "(D) Both (A) and (B)"); when they differ ("(A) Both (B) and (C) (B) x
 *     (C) y (D) z") the question is ambiguous and the caller asks for one
 *     option per line rather than guessing.
 * Null when there is no full A-D run (an MCQ is then reported as missing options).
 */
export function splitOptions(text: string): { start: number; options: string[] } | { start: number; ambiguous: true } | null {
  const at = (letter: string): Marker[] =>
    [...text.matchAll(MARKERS[letter])].map((m) => ({ index: m.index, end: m.index + m[0].length, lineStart: /(^|\n)[ \t]*$/.test(text.slice(0, m.index)) }));
  const [as, bs, cs, ds] = ['A', 'B', 'C', 'D'].map(at);
  const after = (list: Marker[], m: Marker) => list.filter((x) => x.index >= m.end);
  const options = ([a, b, c, d]: Run) => [clean(text.slice(a.end, b.index)), clean(text.slice(b.end, c.index)), clean(text.slice(c.end, d.index)), clean(text.slice(d.end))];

  // 1. One option per line.
  const lines = (list: Marker[]) => list.filter((m) => m.lineStart);
  for (const a of lines(as).reverse()) {
    const b = after(lines(bs), a)[0];
    const c = b && after(lines(cs), b)[0];
    const d = c && after(lines(ds), c)[0];
    if (!b || !c || !d) continue;
    const runAfter = after(as, d).some((a2) => after(bs, a2).some((b2) => after(cs, b2).some((c2) => after(ds, c2).length > 0)));
    if (!runAfter) return { start: a.index, options: options([a, b, c, d]) };
    break;
  }

  // 2. Several on a line: the last (A) with a full run after it, then each letter read last-fit and first-fit.
  const fits = (b: Marker, c?: Marker) => (c ? after(ds, c).length > 0 : after(cs, b).some((x) => after(ds, x).length > 0));
  const a = [...as].reverse().find((m) => after(bs, m).some((b) => fits(b)));
  if (!a) return null;
  const read = (pick: <T>(list: T[]) => T | undefined): Run => {
    const b = pick(after(bs, a).filter((x) => fits(x)))!;
    const c = pick(after(cs, b).filter((x) => fits(b, x)))!;
    const d = after(ds, c)[0];
    return [a, b, c, d];
  };
  const last = read((list) => list.at(-1));
  const first = read((list) => list[0]);
  if (last.some((m, i) => m.index !== first[i].index)) return { start: a.index, ambiguous: true };
  return { start: a.index, options: options(last) };
}
