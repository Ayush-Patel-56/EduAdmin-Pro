import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ImportPreview } from '../academic/import-utils.js';
import { SUBJECTS } from '../academic/academic-options.js';
import { likeEscape } from '../common/like-escape.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Actor, activeFacultyId, actorName, isTeacher } from './actor.js';
import {
  DIFFICULTIES,
  type Difficulty,
  QUESTION_DEFAULTS,
  QUESTION_TYPES,
  type QuestionDto,
  type QuestionImportDto,
  type QuestionKind,
  type QuestionQuery,
} from './assessments.dto.js';
import { parseQuestionPdf } from './question-pdf.js';
import { mcqLetter, numberOf } from './scoring.js';

const PAGE_SIZE = 20;

type QuestionRow = Prisma.QuestionGetPayload<object>;
type Prepared = Omit<Prisma.QuestionUncheckedCreateInput, 'schoolId' | 'facultyId' | 'authorName' | 'createdById'>;

/** Collapses spacing the same way for stored text and for duplicate checks. */
export const normalizeText = (text: string) => text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/**
 * A question's options and answer in their stored form, or the reason they
 * don't fit its type: an MCQ needs four options and an A-D answer; Integer
 * and Numerical need a numeric answer; Subjective needs neither.
 */
export function shapeAnswer(type: QuestionKind, options: string[] | undefined, answer: string | null | undefined): { options: string[]; correctAnswer: string | null } | string {
  const given = answer?.trim() || null;
  if (type === 'MCQ') {
    const opts = (options ?? []).map((o) => o.replace(/\s+/g, ' ').trim());
    if (opts.length !== 4 || opts.some((o) => !o)) return 'An MCQ needs all four options, A to D';
    if (!given) return 'Give the correct option (A, B, C or D)';
    // "Option B", "(B)", "b" or the option's text itself.
    const letter = mcqLetter(given) ?? (() => {
      const at = opts.findIndex((o) => o.toLowerCase() === given.toLowerCase());
      return at === -1 ? null : String.fromCharCode(65 + at);
    })();
    if (!letter) return 'The correct answer must be A, B, C or D';
    return { options: opts, correctAnswer: letter };
  }
  if (type === 'INTEGER' || type === 'NUMERICAL') {
    // "4", "-2" or "9.81 m/s" (the number first, then any unit).
    const m = given ? /^\s*(-?\d+(?:\.\d+)?)/.exec(given) : null;
    const value = m ? numberOf(m[1]) : null;
    if (value === null) return `Give the correct answer as a number`;
    if (type === 'INTEGER' && !Number.isInteger(value)) return 'An integer question needs a whole-number answer';
    return { options: [], correctAnswer: String(value) };
  }
  return { options: [], correctAnswer: given };
}

/**
 * The question bank (PRD 4.10, 5.11). Admins see and manage every question of
 * their school; teachers manage their own and can read the whole bank when
 * building a paper.
 */
@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: Actor, query: QuestionQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? PAGE_SIZE;
    const where: Prisma.QuestionWhereInput = {
      schoolId: actor.schoolId,
      ...(query.subject && { subject: query.subject }),
      ...(query.difficulty && { difficulty: query.difficulty }),
      ...(query.type && { type: query.type }),
      ...(query.chapterId && { chapterId: query.chapterId }),
      ...authorWhere(actor, query),
      ...searchWhere(query.q),
    };
    const [total, rows] = await Promise.all([
      this.prisma.question.count({ where }),
      this.prisma.question.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { total, page, pageSize, items: rows.map(toQuestion) };
  }

  async create(actor: Actor, dto: QuestionDto) {
    const facultyId = activeFacultyId(actor);
    const data = await this.prepare(actor, dto);
    const row = await this.prisma.question.create({
      data: { schoolId: actor.schoolId, facultyId, authorName: await actorName(this.prisma, actor), createdById: actor.userId, ...data },
      select: { id: true },
    });
    return { id: row.id };
  }

  /** A teacher edits only their own questions; admins any. Papers already built keep their copy. */
  async update(actor: Actor, id: string, dto: QuestionDto) {
    const facultyId = activeFacultyId(actor);
    const data = await this.prepare(actor, dto);
    const { count } = await this.prisma.question.updateMany({ where: { id, schoolId: actor.schoolId, ...(facultyId && { facultyId }) }, data });
    if (!count) throw new NotFoundException('Question not found');
    return { id };
  }

  async remove(actor: Actor, id: string) {
    const facultyId = activeFacultyId(actor);
    const { count } = await this.prisma.question.deleteMany({ where: { id, schoolId: actor.schoolId, ...(facultyId && { facultyId }) } });
    if (!count) throw new NotFoundException('Question not found');
    return { ok: true };
  }

  /** Upload PDF: the file's questions, checked one by one, then added on confirm. */
  async import(actor: Actor, dto: QuestionImportDto): Promise<ImportPreview> {
    const facultyId = activeFacultyId(actor);
    let parsed: ReturnType<typeof parseQuestionPdf>;
    try {
      parsed = parseQuestionPdf(dto.text);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'The PDF is not in the question format');
    }
    const h = parsed.header;
    const headerErrors: string[] = [];
    const subject = SUBJECTS.find((s) => s.toLowerCase() === h.subject.toLowerCase());
    if (!subject) headerErrors.push(`Subject must be one of ${SUBJECTS.join(', ')}`);
    const difficulty = DIFFICULTIES.find((d) => d === h.difficulty.toUpperCase()) as Difficulty | undefined;
    if (!difficulty) headerErrors.push('Difficulty must be Easy, Medium or Hard');
    const type = QUESTION_TYPES.find((t) => t === h.type.toUpperCase()) as QuestionKind | undefined;
    if (!type) headerErrors.push('Type must be MCQ, Numerical, Integer or Subjective');
    const marks = Number(h.marks);
    if (!Number.isInteger(marks) || marks < 1 || marks > 100) headerErrors.push('Marks must be a whole number from 1 to 100');
    const negative = Math.abs(Number(h.negativeMarks));
    if (!Number.isInteger(negative) || negative > 9) headerErrors.push('Negative Marks must be 0 to -9');
    const topic = h.topic.replace(/\s+/g, ' ').trim().slice(0, 120);
    const source = h.source.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (headerErrors.length) throw new BadRequestException(`The header block has problems: ${headerErrors.join('; ')}.`);

    // Already in the bank (same subject and text), or twice in this file.
    const texts = parsed.questions.map((q) => normalizeText(q.text)).filter(Boolean);
    const existing = new Set(
      (await this.prisma.question.findMany({ where: { schoolId: actor.schoolId, subject: subject!, text: { in: texts } }, select: { text: true } })).map((q) => q.text.toLowerCase()),
    );
    const seen = new Map<string, number>();
    const ready: Prepared[] = [];
    const rows: ImportPreview['rows'] = parsed.questions.map((q) => {
      const text = normalizeText(q.text);
      const label = `Q${q.number}. ${text.length > 70 ? `${text.slice(0, 70)}…` : text || '(no text)'}`;
      const errors: string[] = [];
      if (!text) errors.push('The question has no text');
      else if (text.length > 4000) errors.push('The question is over 4000 characters');
      const shaped = shapeAnswer(type!, q.options, q.answer);
      if (typeof shaped === 'string') errors.push(q.answer === null && type !== 'SUBJECTIVE' ? `No answer for question ${q.number} in the ANSWER KEY` : shaped);
      if (type !== 'MCQ' && q.options.length) errors.push('Only MCQ questions have options (A)-(D)');
      const key = text.toLowerCase();
      if (!errors.length && existing.has(key)) errors.push('Already in the question bank');
      else if (!errors.length && seen.has(key)) errors.push(`Same as question ${seen.get(key)} in this file`);
      if (errors.length || typeof shaped === 'string') return { row: q.number, label, action: 'error' as const, errors };
      seen.set(key, q.number);
      ready.push({ subject: subject!, chapterId: null, chapterName: null, topic, difficulty: difficulty!, type: type!, text, ...shaped, marks, negativeMarks: negative, source });
      return { row: q.number, label, action: 'create' as const, errors: [] };
    });
    if (!dto.dryRun && ready.length) {
      const authorName = await actorName(this.prisma, actor);
      await this.prisma.question.createMany({ data: ready.map((r) => ({ ...r, schoolId: actor.schoolId, facultyId, authorName, createdById: actor.userId })) });
    }
    return { applied: !dto.dryRun, created: ready.length, updated: 0, skipped: rows.length - ready.length, rows };
  }

  /** Checks the chapter (of this school and subject) and the answer for the type. */
  private async prepare(actor: Actor, dto: QuestionDto): Promise<Prepared> {
    let chapterName: string | null = null;
    if (dto.chapterId) {
      const chapter = await this.prisma.curriculumChapter.findFirst({ where: { id: dto.chapterId, schoolId: actor.schoolId }, select: { name: true, subject: true } });
      if (!chapter) throw new BadRequestException('Select a chapter of this school');
      if (chapter.subject.toLowerCase() !== dto.subject.toLowerCase()) throw new BadRequestException(`That chapter is a ${chapter.subject} chapter`);
      chapterName = chapter.name;
    }
    const shaped = shapeAnswer(dto.type, dto.options, dto.correctAnswer);
    if (typeof shaped === 'string') throw new BadRequestException(shaped);
    return {
      subject: dto.subject,
      chapterId: dto.chapterId ?? null,
      chapterName,
      topic: dto.topic,
      difficulty: dto.difficulty,
      type: dto.type,
      text: normalizeText(dto.text),
      ...shaped,
      marks: dto.marks,
      negativeMarks: dto.negativeMarks,
      source: dto.source || QUESTION_DEFAULTS.source,
    };
  }
}

/** Teachers: their own bank, or the whole school's to build a paper. Admins: optionally one author. */
function authorWhere(actor: Actor, query: QuestionQuery): Prisma.QuestionWhereInput {
  if (isTeacher(actor)) {
    if (query.bank === 'school') return {};
    return { facultyId: actor.scope.facultyId ?? '00000000-0000-0000-0000-000000000000' };
  }
  if (query.author === 'admin') return { facultyId: null };
  return query.author ? { facultyId: query.author } : {};
}

/** Question text, topic, chapter, source or author, in any letter case. */
function searchWhere(q: string | null | undefined): Prisma.QuestionWhereInput {
  const text = q?.trim();
  if (!text) return {};
  const like = { contains: likeEscape(text), mode: 'insensitive' } as const;
  return { OR: [{ text: like }, { topic: like }, { chapterName: like }, { source: like }, { authorName: like }] };
}

export function toQuestion(q: QuestionRow) {
  return {
    id: q.id,
    subject: q.subject,
    chapter: q.chapterId || q.chapterName ? { id: q.chapterId, name: q.chapterName } : null,
    topic: q.topic,
    difficulty: q.difficulty,
    type: q.type,
    text: q.text,
    options: q.options,
    correctAnswer: q.correctAnswer,
    marks: q.marks,
    negativeMarks: q.negativeMarks,
    source: q.source,
    author: { facultyId: q.facultyId, name: q.authorName },
    createdAt: q.createdAt.toISOString(),
  };
}
