import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import { istToday, parseDate, toIsoDate } from '../common/dates.js';
import { duplicateAsConflict } from '../common/unique-violation.js';
import { normalizeIndianMobile } from '../common/validators.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FilesService } from '../storage/files.service.js';
import type {
  GuardianDto,
  StudentDto,
  StudentListQuery,
} from './students.dto.js';

type Tx = Prisma.TransactionClient;

/** The 409 for a unique index a student write hit (admission no., Aadhaar, roll no.). */
export function studentClash(dto: {
  admissionNumber?: string | null;
  rollNumber?: string | null;
}) {
  return (names: string[]) => {
    const hit = (field: string) =>
      names.some((n) => n === field || n.includes(`_${field}_`));
    if (hit('admissionNumber'))
      return `Admission number ${dto.admissionNumber} is already used by another student`;
    if (hit('aadharNumber'))
      return 'This Aadhaar number is already recorded for another student';
    if (hit('rollNumber'))
      return `Roll number ${dto.rollNumber} is already taken in this batch`;
    return 'Another student already has these details. Refresh and try again.';
  };
}

/** "123456789012" -> "XXXX-XXXX-9012": exports and lists never show the full number. */
export function maskAadhaar(value: string | null) {
  return value ? `XXXX-XXXX-${value.slice(-4)}` : null;
}

const listInclude = {
  program: { select: { id: true, name: true } },
  batch: { select: { id: true, name: true } },
  photo: { select: { key: true, originalName: true, contentType: true } },
} as const;

const detailInclude = {
  ...listInclude,
  guardians: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
  enrollments: {
    orderBy: [{ enrolledOn: 'desc' }, { createdAt: 'desc' }],
    include: {
      batch: {
        select: { id: true, name: true, program: { select: { name: true } } },
      },
    },
  },
} satisfies Prisma.StudentInclude;

type ListRow = Prisma.StudentGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.StudentGetPayload<{ include: typeof detailInclude }>;

/**
 * The student roster (PRD 4.6). Admins create and edit; faculty read a
 * limited view of the students in their programs and batches. Every query is
 * scoped to one school.
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  // Admin

  async list(schoolId: string, query: StudentListQuery) {
    return this.page({ schoolId, ...filtersWhere(query) }, query);
  }

  async get(schoolId: string, studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId },
      include: detailInclude,
    });
    if (!student) throw new NotFoundException('Student not found');
    return this.toDetail(student);
  }

  async create(schoolId: string, userId: string, dto: StudentDto) {
    const data = await this.resolve(schoolId, dto);
    const id = await duplicateAsConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          const student = await tx.student.create({
            data: { schoolId, ...data, createdById: userId },
            select: { id: true },
          });
          if (data.batchId) {
            await tx.studentEnrollment.create({
              data: {
                schoolId,
                studentId: student.id,
                batchId: data.batchId,
                rollNumber: data.rollNumber,
                enrolledOn: istToday(),
              },
            });
          }
          return student.id;
        }),
      studentClash(dto),
    );
    return { id };
  }

  async update(schoolId: string, studentId: string, dto: StudentDto) {
    const current = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId },
      select: {
        id: true,
        classLevel: true,
        batchId: true,
        rollNumber: true,
        photoFileId: true,
        photo: { select: { id: true, key: true } },
      },
    });
    if (!current) throw new NotFoundException('Student not found');
    const data = await this.resolve(schoolId, dto, current);
    await duplicateAsConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          await tx.student.update({ where: { id: studentId }, data });
          await moveEnrollment(tx, schoolId, studentId, current, data);
        }),
      studentClash(dto),
    );
    // The old photo is no longer used once the new one is saved.
    if (current.photo && current.photoFileId !== data.photoFileId) {
      await this.files.discard([current.photo]);
    }
    return { id: studentId };
  }

  /** Removes the student with their guardians and batch history. */
  async remove(schoolId: string, studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId },
      select: { id: true, photo: { select: { id: true, key: true } } },
    });
    if (!student) throw new NotFoundException('Student not found');
    await this.prisma.student.delete({ where: { id: studentId } });
    if (student.photo) await this.files.discard([student.photo]);
    return { ok: true };
  }

  // Guardians

  async addGuardian(schoolId: string, studentId: string, dto: GuardianDto) {
    await this.findStudent(schoolId, studentId);
    return this.prisma.$transaction(async (tx) => {
      const others = await tx.studentGuardian.count({ where: { studentId } });
      // The first guardian is the primary contact until another is chosen.
      const isPrimary = dto.isPrimary || others === 0;
      if (isPrimary) {
        await tx.studentGuardian.updateMany({
          where: { studentId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const guardian = await tx.studentGuardian.create({
        data: { schoolId, studentId, ...guardianData(dto), isPrimary },
        select: { id: true },
      });
      return { id: guardian.id };
    });
  }

  async updateGuardian(
    schoolId: string,
    studentId: string,
    guardianId: string,
    dto: GuardianDto,
  ) {
    const guardian = await this.findGuardian(schoolId, studentId, guardianId);
    await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary && !guardian.isPrimary) {
        await tx.studentGuardian.updateMany({
          where: { studentId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      await tx.studentGuardian.update({
        where: { id: guardianId },
        // Unticking the only primary leaves the student without one; that's allowed.
        data: { ...guardianData(dto), isPrimary: dto.isPrimary },
      });
    });
    return { id: guardianId };
  }

  async removeGuardian(schoolId: string, studentId: string, guardianId: string) {
    await this.findGuardian(schoolId, studentId, guardianId);
    await this.prisma.studentGuardian.delete({ where: { id: guardianId } });
    return { ok: true };
  }

  /** Every matching student with export columns (Aadhaar masked). */
  async exportRows(schoolId: string, query: StudentListQuery) {
    const students = await this.prisma.student.findMany({
      where: { schoolId, ...filtersWhere(query) },
      orderBy: [{ classLevel: 'asc' }, { rollNumber: 'asc' }, { fullName: 'asc' }],
      include: {
        ...listInclude,
        guardians: { where: { isPrimary: true }, take: 1 },
      },
      take: 5000,
    });
    return students.map((s) => {
      const guardian = s.guardians[0];
      return {
        fullName: s.fullName,
        admissionNumber: s.admissionNumber,
        aadharNumber: maskAadhaar(s.aadharNumber),
        rollNumber: s.rollNumber,
        email: s.email,
        phone: s.phone,
        parentContact: s.parentContact,
        address: s.address,
        city: s.city,
        state: s.state,
        pincode: s.pincode,
        dateOfBirth: toIsoDate(s.dateOfBirth),
        gender: s.gender,
        bloodGroup: s.bloodGroup,
        previousSchool: s.previousSchool,
        previousPercentage:
          s.previousPercentage === null ? null : Number(s.previousPercentage),
        classLevel: s.classLevel,
        program: s.program?.name ?? null,
        batch: s.batch?.name ?? null,
        admissionDate: toIsoDate(s.admissionDate),
        status: s.status,
        notes: s.notes,
        guardianName: guardian?.name ?? null,
        guardianRelationship: guardian?.relationship ?? null,
        guardianPhone: guardian?.phone ?? null,
        guardianEmail: guardian?.email ?? null,
      };
    });
  }

  // Faculty (read-only)

  /**
   * Which students a teacher sees (PRD access rules): none for an inactive
   * profile; every student of the school when they have no programs
   * assigned; otherwise students in their programs or batches.
   */
  teacherWhere(scope: TeacherScope): Prisma.StudentWhereInput | null {
    if (!scope.active || !scope.facultyId) return null;
    if (scope.programIds.length === 0) return { schoolId: scope.schoolId };
    return {
      schoolId: scope.schoolId,
      OR: [
        { programId: { in: scope.programIds } },
        { batchId: { in: scope.batchIds } },
      ],
    };
  }

  async teacherList(scope: TeacherScope, query: StudentListQuery) {
    const visible = this.teacherWhere(scope);
    const pageSize = query.pageSize ?? 50;
    if (!visible) return { total: 0, page: 1, pageSize, items: [] };
    const result = await this.page(
      { AND: [visible, filtersWhere(query)] },
      query,
    );
    // Faculty get the roster without contact details.
    return {
      ...result,
      items: result.items.map((s) => ({
        id: s.id,
        fullName: s.fullName,
        rollNumber: s.rollNumber,
        classLevel: s.classLevel,
        program: s.program,
        batch: s.batch,
        status: s.status,
        photoUrl: s.photoUrl,
      })),
    };
  }

  async teacherGet(scope: TeacherScope, studentId: string) {
    const visible = this.teacherWhere(scope);
    const student = visible
      ? await this.prisma.student.findFirst({
          where: { AND: [visible, { id: studentId }] },
          include: detailInclude,
        })
      : null;
    if (!student) throw new NotFoundException('Student not found');
    const detail = await this.toDetail(student);
    // A teacher's view: no identity numbers, contacts, address or guardians.
    return {
      id: detail.id,
      fullName: detail.fullName,
      rollNumber: detail.rollNumber,
      classLevel: detail.classLevel,
      program: detail.program,
      batch: detail.batch,
      photoUrl: detail.photoUrl,
      gender: detail.gender,
      previousSchool: detail.previousSchool,
      previousPercentage: detail.previousPercentage,
      admissionDate: detail.admissionDate,
      status: detail.status,
      enrollments: detail.enrollments,
    };
  }

  // Helpers

  private async page(where: Prisma.StudentWhereInput, query: StudentListQuery) {
    const pageSize = query.pageSize ?? 25;
    const [total, rows] = await Promise.all([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({
        where,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        include: listInclude,
        skip: ((query.page ?? 1) - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page: query.page ?? 1,
      pageSize,
      items: await Promise.all(rows.map((s) => this.toListItem(s))),
    };
  }

  private async toListItem(s: ListRow) {
    return {
      id: s.id,
      fullName: s.fullName,
      rollNumber: s.rollNumber,
      classLevel: s.classLevel,
      program: s.program,
      batch: s.batch,
      phone: s.phone,
      parentContact: s.parentContact,
      email: s.email,
      status: s.status,
      photoUrl: await this.photoUrl(s),
    };
  }

  private async toDetail(s: DetailRow) {
    return {
      id: s.id,
      fullName: s.fullName,
      admissionNumber: s.admissionNumber,
      aadharNumber: s.aadharNumber,
      rollNumber: s.rollNumber,
      email: s.email,
      phone: s.phone,
      parentContact: s.parentContact,
      address: s.address,
      city: s.city,
      state: s.state,
      pincode: s.pincode,
      dateOfBirth: toIsoDate(s.dateOfBirth),
      gender: s.gender,
      bloodGroup: s.bloodGroup,
      profileImageUrl: s.profileImageUrl,
      photoFileId: s.photoFileId,
      photoUrl: await this.photoUrl(s),
      previousSchool: s.previousSchool,
      previousPercentage:
        s.previousPercentage === null ? null : Number(s.previousPercentage),
      classLevel: s.classLevel,
      program: s.program,
      batch: s.batch,
      admissionDate: toIsoDate(s.admissionDate),
      status: s.status,
      notes: s.notes,
      createdAt: s.createdAt.toISOString(),
      guardians: s.guardians.map((g) => ({
        id: g.id,
        name: g.name,
        relationship: g.relationship,
        phone: g.phone,
        altPhone: g.altPhone,
        email: g.email,
        occupation: g.occupation,
        annualIncome: g.annualIncome,
        isPrimary: g.isPrimary,
      })),
      enrollments: s.enrollments.map((e) => ({
        id: e.id,
        batch: e.batch.name,
        program: e.batch.program.name,
        rollNumber: e.rollNumber,
        enrolledOn: toIsoDate(e.enrolledOn),
        endedOn: toIsoDate(e.endedOn),
      })),
    };
  }

  /** An uploaded photo wins over a link; both are optional. */
  private async photoUrl(s: {
    profileImageUrl: string | null;
    photo: { key: string; originalName: string; contentType: string } | null;
  }) {
    return s.photo ? await this.files.url(s.photo) : s.profileImageUrl;
  }

  /** Checks the form against this school's classes, programs and batches; returns the row to save. */
  private async resolve(
    schoolId: string,
    dto: StudentDto,
    current?: { classLevel: string | null; photoFileId: string | null },
  ) {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { classes: true },
    });
    const classLevel = dto.classLevel ?? null;
    // A class the school stopped offering stays valid on students who already have it.
    if (
      classLevel &&
      !school.classes.includes(classLevel) &&
      classLevel !== current?.classLevel
    ) {
      throw new BadRequestException(
        `This school doesn't offer class ${classLevel}`,
      );
    }

    let programId = dto.programId ?? null;
    const batchId = dto.batchId ?? null;
    if (batchId) {
      const batch = await this.prisma.batch.findFirst({
        where: { id: batchId, schoolId },
        select: { programId: true, program: { select: { name: true } } },
      });
      if (!batch) throw new BadRequestException('Select a batch from this school');
      if (programId && programId !== batch.programId) {
        throw new BadRequestException(
          `That batch belongs to ${batch.program.name}; pick it as the program or choose another batch`,
        );
      }
      programId = batch.programId;
    } else if (programId) {
      const program = await this.prisma.program.findFirst({
        where: { id: programId, schoolId },
        select: { id: true },
      });
      if (!program)
        throw new BadRequestException('Select a program from this school');
    }

    const photoFileId = dto.photoFileId ?? null;
    if (photoFileId && photoFileId !== current?.photoFileId) {
      await this.files.findReady(schoolId, photoFileId, 'STUDENT_PHOTO');
    }

    const dateOfBirth = dto.dateOfBirth
      ? parseDate(dto.dateOfBirth, 'Date of birth')
      : null;
    if (dateOfBirth && dateOfBirth > istToday()) {
      throw new BadRequestException("Date of birth can't be in the future");
    }

    return {
      fullName: dto.fullName,
      admissionNumber: dto.admissionNumber ?? null,
      aadharNumber: dto.aadharNumber ?? null,
      rollNumber: dto.rollNumber ?? null,
      email: dto.email ?? null,
      phone: dto.phone ? normalizeIndianMobile(dto.phone) : null,
      parentContact: dto.parentContact
        ? normalizeIndianMobile(dto.parentContact)
        : null,
      address: dto.address ?? null,
      city: dto.city ?? null,
      state: dto.state ?? null,
      pincode: dto.pincode ?? null,
      dateOfBirth,
      gender: dto.gender ?? null,
      bloodGroup: dto.bloodGroup ?? null,
      profileImageUrl: dto.profileImageUrl ?? null,
      photoFileId,
      previousSchool: dto.previousSchool ?? null,
      previousPercentage: dto.previousPercentage ?? null,
      classLevel,
      programId,
      batchId,
      admissionDate: dto.admissionDate
        ? parseDate(dto.admissionDate, 'Admission date')
        : null,
      status: dto.status,
      notes: dto.notes ?? null,
    };
  }

  private async findStudent(schoolId: string, studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  private async findGuardian(
    schoolId: string,
    studentId: string,
    guardianId: string,
  ) {
    const guardian = await this.prisma.studentGuardian.findFirst({
      where: { id: guardianId, studentId, schoolId },
      select: { id: true, isPrimary: true },
    });
    if (!guardian) throw new NotFoundException('Guardian not found');
    return guardian;
  }
}

/** The roster filters as a Prisma where (school scoping is added by callers). */
export function filtersWhere(query: StudentListQuery): Prisma.StudentWhereInput {
  const q = query.q?.trim();
  return {
    ...(query.classLevel && { classLevel: query.classLevel }),
    ...(query.programId && { programId: query.programId }),
    ...(query.batchId && {
      batchId: query.batchId === 'unassigned' ? null : query.batchId,
    }),
    ...(query.status && { status: query.status }),
    ...(q && {
      OR: [
        { fullName: { contains: q, mode: 'insensitive' } },
        { admissionNumber: { contains: q, mode: 'insensitive' } },
        { rollNumber: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    }),
  };
}

/**
 * Keeps the batch history in step with the student's current batch: moving
 * closes the open enrollment and opens a new one; a new roll number in the
 * same batch updates the open one.
 */
export async function moveEnrollment(
  tx: Tx,
  schoolId: string,
  studentId: string,
  before: { batchId: string | null; rollNumber: string | null },
  after: { batchId: string | null; rollNumber: string | null },
) {
  const today = istToday();
  if (before.batchId === after.batchId) {
    if (after.batchId && before.rollNumber !== after.rollNumber) {
      await tx.studentEnrollment.updateMany({
        where: { studentId, batchId: after.batchId, endedOn: null },
        data: { rollNumber: after.rollNumber },
      });
    }
    return;
  }
  await tx.studentEnrollment.updateMany({
    where: { studentId, endedOn: null },
    data: { endedOn: today },
  });
  if (after.batchId) {
    await tx.studentEnrollment.create({
      data: {
        schoolId,
        studentId,
        batchId: after.batchId,
        rollNumber: after.rollNumber,
        enrolledOn: today,
      },
    });
  }
}

function guardianData(dto: GuardianDto) {
  return {
    name: dto.name,
    relationship: dto.relationship ?? null,
    phone: dto.phone ? normalizeIndianMobile(dto.phone) : null,
    altPhone: dto.altPhone ? normalizeIndianMobile(dto.altPhone) : null,
    email: dto.email ?? null,
    occupation: dto.occupation ?? null,
    annualIncome: dto.annualIncome ?? null,
  };
}
