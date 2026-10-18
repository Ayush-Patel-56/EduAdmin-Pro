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

  it('a question missing from the answer key has no answer (reported per row by the caller)', () => {
    expect(parseQuestionPdf(MCQ.replace('Q2. (C)', '')).questions[1].answer).toBeNull();
  });

  it('refuses a file without the header block or without numbered questions, saying how to fix it', () => {
    expect(() => parseQuestionPdf('1. What?\n(A) a (B) b (C) c (D) d')).toThrow('The header block at the top must give Subject, Topic, Difficulty, Type');
    expect(() => parseQuestionPdf('Subject: Physics\nTopic: X\nDifficulty: Easy\nType: MCQ\nJust some text')).toThrow('No numbered questions were found');
  });
});
