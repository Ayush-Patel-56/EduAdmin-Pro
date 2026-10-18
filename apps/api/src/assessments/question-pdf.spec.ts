import { parseQuestionPdf } from './question-pdf.js';

const MCQ = `Subject: Physics
Topic: Thermodynamics
Difficulty: Medium
Type: MCQ
Marks: 4
Negative Marks: -1
Source: Custom

1. What is the SI unit of temperature?
(A) Celsius
(B) Kelvin
(C) Fahrenheit
(D) Rankine

Q2. Which thermodynamic process occurs
at constant temperature?
(A) Adiabatic (B) Isochoric (C) Isothermal (D) Isobaric

ANSWER KEY
1. B
Q2. (C)`;

describe('question PDF text', () => {
  it('reads the header, numbered questions (1. or Q1.), options on their own lines or one line, and the answer key', () => {
    const out = parseQuestionPdf(MCQ);
    expect(out.header).toEqual({ subject: 'Physics', topic: 'Thermodynamics', difficulty: 'Medium', type: 'MCQ', marks: '4', negativeMarks: '-1', source: 'Custom' });
    expect(out.questions).toEqual([
      { number: 1, text: 'What is the SI unit of temperature?', options: ['Celsius', 'Kelvin', 'Fahrenheit', 'Rankine'], answer: 'B' },
      { number: 2, text: 'Which thermodynamic process occurs\nat constant temperature?', options: ['Adiabatic', 'Isochoric', 'Isothermal', 'Isobaric'], answer: '(C)' },
    ]);
  });

  it('defaults Marks to 4, Negative Marks to 0 and Source to PDF Upload; numerical answers keep their unit text', () => {
    const out = parseQuestionPdf('Subject: Physics\nTopic: Kinematics\nDifficulty: Easy\nType: Numerical\n\n1. How long does the fall take?\n\nANSWER KEY\n1. 4 seconds');
    expect(out.header).toMatchObject({ marks: '4', negativeMarks: '0', source: 'PDF Upload' });
    expect(out.questions).toEqual([{ number: 1, text: 'How long does the fall take?', options: [], answer: '4 seconds' }]);
  });

  it('"(A)" and "(B)" inside the question text stay in it, with options on the next line or the same line', () => {
    const head = 'Subject: Physics\nTopic: Grammar\nDifficulty: Easy\nType: MCQ\n\n';
    const nextLine = parseQuestionPdf(`${head}1. Which of these is (A) a noun or (B) a verb?\n(A) run (B) dog (C) blue (D) fast\n\nANSWER KEY\n1. B`);
    expect(nextLine.questions[0]).toEqual({ number: 1, text: 'Which of these is (A) a noun or (B) a verb?', options: ['run', 'dog', 'blue', 'fast'], answer: 'B' });
    const sameLine = parseQuestionPdf(`${head}1. Which of these is (A) a noun or (B) a verb? (A) run (B) dog (C) blue (D) fast\n\nANSWER KEY\n1. B`);
    expect(sameLine.questions[0]).toEqual(nextLine.questions[0]);
    const ownLines = parseQuestionPdf(`${head}Q1. Pick (A) or (B):\n(A) run\n(B) dog\n(C) blue\n(D) fast`);
    expect(ownLines.questions[0]).toMatchObject({ text: 'Pick (A) or (B):', options: ['run', 'dog', 'blue', 'fast'] });
  });

  it('an option that names others ("Both (A) and (B)") stays whole; without a full (A)-(D) run there are no options', () => {
    const head = 'Subject: Physics\nTopic: Heat\nDifficulty: Easy\nType: MCQ\n\n';
    const out = parseQuestionPdf(`${head}1. Which are scalars?\n(A) Mass\n(B) Speed\n(C) Velocity\n(D) Both (A) and (B)`);
    expect(out.questions[0]).toMatchObject({ text: 'Which are scalars?', options: ['Mass', 'Speed', 'Velocity', 'Both (A) and (B)'] });
    const partial = parseQuestionPdf(`${head}1. Only two?\n(A) one (B) two`);
    expect(partial.questions[0]).toMatchObject({ text: 'Only two?\n(A) one (B) two', options: [] });
  });

  it('an earlier option naming later letters on one line is ambiguous (flagged, not guessed); on separate lines it reads cleanly', () => {
    const head = 'Subject: Physics\nTopic: Heat\nDifficulty: Easy\nType: MCQ\n\n';
    const oneLine = parseQuestionPdf(`${head}1. Choose one\n(A) Both (B) and (C) (B) x (C) y (D) z`);
    expect(oneLine.questions[0]).toMatchObject({ text: 'Choose one', options: [], ambiguous: true });
    const ownLines = parseQuestionPdf(`${head}1. Choose one\n(A) Both (B) and (C)\n(B) x\n(C) y\n(D) z`);
    expect(ownLines.questions[0]).toEqual({ number: 1, text: 'Choose one', options: ['Both (B) and (C)', 'x', 'y', 'z'], answer: null });
  });

  it('options (A) to (C) without a (D) are no options (the MCQ is then reported as missing one)', () => {
    const out = parseQuestionPdf('Subject: Physics\nTopic: Heat\nDifficulty: Easy\nType: MCQ\n\n1. Three only?\n(A) a\n(B) b\n(C) c');
    expect(out.questions[0]).toMatchObject({ options: [] });
    expect(out.questions[0].ambiguous).toBeUndefined();
  });

  it('a question missing from the answer key has no answer (reported per row by the caller)', () => {
    expect(parseQuestionPdf(MCQ.replace('Q2. (C)', '')).questions[1].answer).toBeNull();
  });

  it('refuses a file without the header block or without numbered questions, saying how to fix it', () => {
    expect(() => parseQuestionPdf('1. What?\n(A) a (B) b (C) c (D) d')).toThrow('The header block at the top must give Subject, Topic, Difficulty, Type');
    expect(() => parseQuestionPdf('Subject: Physics\nTopic: X\nDifficulty: Easy\nType: MCQ\nJust some text')).toThrow('No numbered questions were found');
  });
});
