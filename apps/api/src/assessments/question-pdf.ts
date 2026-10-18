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
export type PdfQuestion = { number: number; text: string; options: string[]; answer: string | null };

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
    return { number: b.number, text: (found ? joined.slice(0, found.start) : joined).trim(), options: found?.options ?? [], answer: answers.get(b.number) ?? null };
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

/**
 * Finds the options in a question's text: the last "(A)" that is followed by
 * "(B)", "(C)" and "(D)" in that order, each option running to the next
 * letter. So "(A)"/"(B)" inside the question ("Is it (A) a noun or (B) a
 * verb?") stay in its text, and an option such as "(D) Both (A) and (B)"
 * stays whole. Options can sit one per line or several on a line. Null when
 * there is no full A-D run (an MCQ is then reported as missing options).
 */
export function splitOptions(text: string): { start: number; options: string[] } | null {
  const at = (letter: string) => [...text.matchAll(MARKERS[letter])].map((m) => ({ index: m.index, end: m.index + m[0].length }));
  const [as, bs, cs, ds] = ['A', 'B', 'C', 'D'].map(at);
  for (let k = as.length - 1; k >= 0; k--) {
    const a = as[k];
    const b = bs.find((m) => m.index >= a.end);
    const c = b && cs.find((m) => m.index >= b.end);
    const d = c && ds.find((m) => m.index >= c.end);
    if (!b || !c || !d) continue;
    return { start: a.index, options: [clean(text.slice(a.end, b.index)), clean(text.slice(b.end, c.index)), clean(text.slice(c.end, d.index)), clean(text.slice(d.end))] };
  }
  return null;
}
