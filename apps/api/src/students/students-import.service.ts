import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  type ImportPreview,
  parseImportDate,
} from '../academic/import-utils.js';
import { istToday } from '../common/dates.js';
import { duplicateAsConflict } from '../common/unique-violation.js';
import { normalizeIndianMobile } from '../common/validators.js';
import { normalizeClass } from '../curriculum/curriculum.service.js';
import type { Prisma, StudentStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AADHAAR, ADMISSION_NUMBER, PINCODE } from './students.dto.js';
import type { StudentImportDto, StudentImportRow } from './students.dto.js';
import { BLOOD_GROUPS, GENDERS } from './students-options.js';
import { gradeOf, moveEnrollment } from './students.service.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Fields = {
  fullName: string;
  admissionNumber: string | null;
  aadharNumber: string | null;
  rollNumber: string | null;
  email: string | null;
  phone: string | null;
  parentContact: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  bloodGroup: string | null;
  profileImageUrl: string | null;
  previousSchool: string | null;
  previousPercentage: number | null;
  classLevel: string | null;
  programId: string | null;
  batchId: string | null;
  admissionDate: Date | null;
  status: StudentStatus | null; // null = not given (new students start ACTIVE)
  notes: string | null;
};

type Guardian = {
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
};

type Planned = {
  row: number;
  label: string;
  action: 'create' | 'update' | 'error';
  errors: string[];
  existing?: { id: string; batchId: string | null; rollNumber: string | null };
  leavesBatch?: boolean;
  fields?: Fields;
  guardian?: Guardian | null;
};

/**
 * Student CSV / Excel import (PRD 4.6): every row is validated, a preview is
 * shown, then the valid rows are applied in one transaction. A row updates
 * the student with the same admission number (or Aadhaar); students are
 * never matched by name alone. Default program / batch fill rows that leave
 * those cells blank, and blank cells never overwrite saved values.
 */
@Injectable()
export class StudentImportService {
  constructor(private readonly prisma: PrismaService) {}

  async import(schoolId: string, dto: StudentImportDto): Promise<ImportPreview> {
    const [school, programs, batches, existing] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: { classes: true },
      }),
      this.prisma.program.findMany({
        where: { schoolId },
        select: { id: true, name: true },
      }),
      this.prisma.batch.findMany({
        where: { schoolId },
        select: { id: true, name: true, programId: true, classLevel: true },
      }),
      this.prisma.student.findMany({
        where: { schoolId },
        select: {
          id: true,
          fullName: true,
          admissionNumber: true,
          aadharNumber: true,
          batchId: true,
          rollNumber: true,
          classLevel: true,
          dateOfBirth: true,
          phone: true,
          parentContact: true,
        },
      }),
    ]);

    const defaultBatch = dto.defaults?.batchId
      ? batches.find((b) => b.id === dto.defaults!.batchId)
      : undefined;
    const defaultProgram = dto.defaults?.programId
      ? programs.find((p) => p.id === dto.defaults!.programId)
      : undefined;
    if (dto.defaults?.batchId && !defaultBatch)
      throw new BadRequestException('Select a default batch from this school');
    if (dto.defaults?.programId && !defaultProgram)
      throw new BadRequestException('Select a default program from this school');
    if (defaultBatch && defaultProgram && defaultBatch.programId !== defaultProgram.id)
      throw new BadRequestException(
        'The default batch belongs to another program',
      );

    const byAdmission = new Map(
      existing.filter((s) => s.admissionNumber).map((s) => [s.admissionNumber!, s]),
    );
    const byAadhaar = new Map(
      existing.filter((s) => s.aadharNumber).map((s) => [s.aadharNumber!, s]),
    );
    const rollOwner = new Map(
      existing
        .filter((s) => s.batchId && s.rollNumber)
        .map((s) => [`${s.batchId}|${s.rollNumber!.toUpperCase()}`, s.id]),
    );
    // Students without an admission number or Aadhaar are matched to nobody,
    // so a re-import would duplicate them; spot the likely ones instead.
    const lookalike = (name: string, dob: Date | null, phones: (string | null)[]) =>
      existing.find(
        (s) =>
          s.fullName.toLowerCase() === name.toLowerCase() &&
          ((dob && s.dateOfBirth?.getTime() === dob.getTime()) ||
            phones.some((p) => p && (p === s.phone || p === s.parentContact))),
      );
    const seenPerson = new Map<string, number>();
    const seenAdmission = new Map<string, number>();
    const seenAadhaar = new Map<string, number>();
    const seenRoll = new Map<string, number>();
    const seenStudent = new Map<string, number>();

    const planned = dto.rows.map((raw, i): Planned => {
      const row = i + 2; // the header is row 1
      const errors: string[] = [];
      const text = (v?: string) => v?.trim().replace(/\s+/g, ' ') || null;

      const fullName = text(raw.fullName);
      if (!fullName) errors.push('Name is required');
      const label = fullName ?? '—';

      const admissionNumber = text(raw.admissionNumber)?.toUpperCase() ?? null;
      if (admissionNumber && !ADMISSION_NUMBER.test(admissionNumber))
        errors.push(`Admission number "${admissionNumber}" is invalid`);
      const aadharNumber = raw.aadharNumber?.replace(/[\s-]/g, '') || null;
      if (aadharNumber && !AADHAAR.test(aadharNumber))
        errors.push('Aadhaar number must be 12 digits, not starting with 0 or 1');

      const mobile = (value: string | undefined, name: string) => {
        const t = text(value);
        if (!t) return null;
        const n = normalizeIndianMobile(t);
        if (!n) errors.push(`${name} must be a 10-digit mobile number`);
        return n;
      };
      const phone = mobile(raw.phone, 'Phone');
      const parentContact = mobile(raw.parentContact, 'Parent Contact');

      const email = text(raw.email)?.toLowerCase() ?? null;
      if (email && !EMAIL.test(email)) errors.push('Email is invalid');
      const pincode = text(raw.pincode);
      if (pincode && !PINCODE.test(pincode))
        errors.push('Pincode must be 6 digits');

      const dateOfBirth = parseImportDate(raw.dateOfBirth, 'Date of Birth', errors);
      if (dateOfBirth && dateOfBirth > istToday())
        errors.push("Date of Birth can't be in the future");
      const admissionDate = parseImportDate(
        raw.admissionDate,
        'Admission Date',
        errors,
      );

      const genderText = text(raw.gender);
      const gender = genderText
        ? (GENDERS.find((g) => g.toLowerCase() === genderText.toLowerCase()) ??
          ({ m: 'Male', f: 'Female' } as Record<string, string>)[genderText.toLowerCase()] ??
          null)
        : null;
      if (genderText && !gender) errors.push('Gender must be Male, Female or Other');

      const bloodText = text(raw.bloodGroup)?.toUpperCase().replace(/\s/g, '');
      const bloodGroup = bloodText
        ? (BLOOD_GROUPS.find((b) => b === bloodText) ?? null)
        : null;
      if (bloodText && !bloodGroup)
        errors.push(`Blood Group must be one of ${BLOOD_GROUPS.join(', ')}`);

      const profileImageUrl = text(raw.profileImageUrl);
      if (profileImageUrl && !/^https:\/\/\S+$/i.test(profileImageUrl))
        errors.push('Profile Image URL must be an https:// link');

      const pctText = text(raw.previousPercentage)?.replace(/%$/, '').trim();
      const previousPercentage = pctText ? Number(pctText) : null;
      if (
        pctText &&
        (previousPercentage === null ||
          Number.isNaN(previousPercentage) ||
          previousPercentage < 0 ||
          previousPercentage > 100)
      ) {
        errors.push('Previous Percentage must be between 0 and 100');
      }

      const classText = text(raw.classLevel);
      const classLevel = classText ? normalizeClass(classText, school.classes) : null;
      if (classText && !classLevel)
        errors.push(`This school doesn't offer class "${classText}"`);

      // Program and batch: the row's own cells win over the defaults.
      const programText = text(raw.program);
      const rowProgram = programText
        ? programs.find((p) => p.name.toLowerCase() === programText.toLowerCase())
        : undefined;
      if (programText && !rowProgram)
        errors.push(`No program named "${programText}" in this school`);
      const batchText = text(raw.batch);
      let batch: (typeof batches)[number] | undefined;
      if (batchText) {
        const named = batches.filter(
          (b) => b.name.toLowerCase() === batchText.toLowerCase(),
        );
        const narrowTo = rowProgram ?? (named.length > 1 ? defaultProgram : undefined);
        const fits = narrowTo ? named.filter((b) => b.programId === narrowTo.id) : named;
        if (fits.length === 1) batch = fits[0];
        else if (fits.length > 1)
          errors.push(`More than one batch is named "${batchText}": fill the Program column`);
        else if (!programText || rowProgram)
          errors.push(
            rowProgram
              ? `${rowProgram.name} has no batch named "${batchText}"`
              : `No batch named "${batchText}" in this school`,
          );
      } else if (
        defaultBatch &&
        (!rowProgram || defaultBatch.programId === rowProgram.id)
      ) {
        batch = defaultBatch;
      }
      // A batch decides its program; otherwise the row's program, else the default.
      const program = batch
        ? programs.find((p) => p.id === batch!.programId)
        : (rowProgram ?? defaultProgram);

      const statusText = text(raw.status)?.toUpperCase();
      const status = statusText
        ? ((['ACTIVE', 'INACTIVE', 'TRANSFERRED', 'COMPLETED'] as const).find(
            (s) => s === statusText,
          ) ?? null)
        : null;
      if (statusText && !status)
        errors.push('Status must be Active, Inactive, Transferred or Completed');

      // Upper-cased like the form, so "r5" and "R5" are one roll number.
      const rollNumber = text(raw.rollNumber)?.toUpperCase() ?? null;
      const notes = text(raw.notes);

      const guardianName = text(raw.guardianName);
      const guardianPhoneText = text(raw.guardianPhone);
      const guardianPhone = guardianPhoneText
        ? normalizeIndianMobile(guardianPhoneText)
        : null;
      if (guardianPhoneText && !guardianPhone)
        errors.push('Guardian Phone must be a 10-digit mobile number');
      const guardianEmail = text(raw.guardianEmail)?.toLowerCase() ?? null;
      if (guardianEmail && !EMAIL.test(guardianEmail))
        errors.push('Guardian Email is invalid');
      if (!guardianName && (guardianPhoneText || guardianEmail || text(raw.guardianRelationship)))
        errors.push('Guardian Name is required when other guardian columns are filled');

      // Which saved student this row is: by admission number, else Aadhaar.
      const viaAdmission = admissionNumber ? byAdmission.get(admissionNumber) : undefined;
      const viaAadhaar = aadharNumber ? byAadhaar.get(aadharNumber) : undefined;
      if (viaAdmission && viaAadhaar && viaAdmission.id !== viaAadhaar.id)
        errors.push('Admission number and Aadhaar belong to two different students');
      const match = viaAdmission ?? viaAadhaar;
      // Never change a stored identifier silently.
      if (viaAadhaar && !viaAdmission && admissionNumber && viaAadhaar.admissionNumber) {
        errors.push(
          `This Aadhaar number belongs to ${viaAadhaar.fullName} (admission number ${viaAadhaar.admissionNumber}); fix the admission number or leave it blank`,
        );
      }
      if (viaAdmission && !viaAadhaar && aadharNumber && viaAdmission.aadharNumber) {
        errors.push(
          `Admission number ${admissionNumber} belongs to ${viaAdmission.fullName}, who has a different Aadhaar number`,
        );
      }
      if (!admissionNumber && !aadharNumber && fullName) {
        const twin = lookalike(fullName, dateOfBirth, [phone, parentContact]);
        if (twin) {
          errors.push(
            `Looks like ${twin.fullName}, already on the roster (same name and ${dateOfBirth && twin.dateOfBirth?.getTime() === dateOfBirth.getTime() ? 'date of birth' : 'phone'}). Add their admission number to update them`,
          );
        }
        const person = [fullName.toLowerCase(), dateOfBirth?.toISOString() ?? phone ?? parentContact ?? ''].join('|');
        if (person.split('|')[1]) {
          const first = seenPerson.get(person);
          if (first) errors.push(`Same student as row ${first}`);
          else seenPerson.set(person, row);
        }
      }

      // Duplicates inside the file.
      const once = (seen: Map<string, number>, key: string | null, message: string) => {
        if (!key) return;
        const first = seen.get(key);
        if (first) errors.push(`${message} as row ${first}`);
        else seen.set(key, row);
      };
      once(seenAdmission, admissionNumber, 'Same admission number');
      once(seenAadhaar, aadharNumber, 'Same Aadhaar number');
      if (match) once(seenStudent, match.id, 'Same student');

      // Roll numbers are unique within a batch.
      // Moving a saved student to another program (without naming a batch)
      // takes them out of their old program's batch.
      const leavesBatch =
        !batch &&
        !!program &&
        !!match?.batchId &&
        batches.find((b) => b.id === match.batchId)?.programId !== program.id;
      const finalBatchId = batch?.id ?? (match && !leavesBatch ? match.batchId : null);
      const finalRoll = rollNumber ?? match?.rollNumber ?? null;
      // A batch for one class only takes students of that class.
      const finalBatch = finalBatchId ? batches.find((b) => b.id === finalBatchId) : undefined;
      let finalClass = classLevel ?? match?.classLevel ?? null;
      if (finalBatch?.classLevel != null) {
        if (finalClass && gradeOf(finalClass) !== finalBatch.classLevel) {
          errors.push(`${finalBatch.name} is a class ${finalBatch.classLevel} batch; this student is in ${finalClass}`);
        } else if (!finalClass && school.classes.includes(`${finalBatch.classLevel}th`)) {
          finalClass = `${finalBatch.classLevel}th`;
        }
      }
      if (finalBatchId && finalRoll) {
        const key = `${finalBatchId}|${finalRoll.toUpperCase()}`;
        once(seenRoll, key, `Roll number ${finalRoll} is used in the same batch`);
        const owner = rollOwner.get(key);
        if (owner && owner !== match?.id)
          errors.push(`Roll number ${finalRoll} is already taken in that batch`);
      }

      if (errors.length > 0) return { row, label, action: 'error', errors };
      return {
        row,
        label,
        action: match ? 'update' : 'create',
        errors,
        existing: match
          ? { id: match.id, batchId: match.batchId, rollNumber: match.rollNumber }
          : undefined,
        leavesBatch,
        fields: {
          fullName: fullName!,
          admissionNumber,
          aadharNumber,
          rollNumber,
          email,
          phone,
          parentContact,
          address: text(raw.address),
          city: text(raw.city),
          state: text(raw.state),
          pincode,
          dateOfBirth,
          gender,
          bloodGroup,
          profileImageUrl,
          previousSchool: text(raw.previousSchool),
          previousPercentage,
          classLevel: classLevel ?? (match ? null : finalClass),
          programId: program?.id ?? null,
          batchId: batch?.id ?? null,
          admissionDate,
          status,
          notes,
        },
        guardian: guardianName
          ? {
              name: guardianName,
              relationship: text(raw.guardianRelationship),
              phone: guardianPhone,
              email: guardianEmail,
            }
          : null,
      };
    });

    if (!dto.dryRun) await this.apply(schoolId, planned);

    return {
      applied: !dto.dryRun,
      created: planned.filter((r) => r.action === 'create').length,
      updated: planned.filter((r) => r.action === 'update').length,
      skipped: planned.filter((r) => r.action === 'error').length,
      rows: planned.map(({ row, label, action, errors }) => ({
        row,
        label,
        action,
        errors,
      })),
    };
  }

  private async apply(schoolId: string, planned: Planned[]) {
    const creates = planned.filter((r) => r.action === 'create');
    const updates = planned.filter((r) => r.action === 'update');
    const today = istToday();
    const ids = new Map(creates.map((r) => [r.row, randomUUID()]));

    await duplicateAsConflict(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            if (creates.length > 0) {
              await tx.student.createMany({
                data: creates.map((r) => ({
                  id: ids.get(r.row)!,
                  schoolId,
                  ...r.fields!,
                  status: r.fields!.status ?? 'ACTIVE',
                })),
              });
              const enrollments = creates.filter((r) => r.fields!.batchId);
              if (enrollments.length > 0) {
                const names = await tx.batch.findMany({
                  where: { id: { in: enrollments.map((r) => r.fields!.batchId!) } },
                  select: { id: true, name: true, program: { select: { name: true } } },
                });
                const nameOf = new Map(names.map((b) => [b.id, b]));
                await tx.studentEnrollment.createMany({
                  data: enrollments.map((r) => ({
                    schoolId,
                    studentId: ids.get(r.row)!,
                    batchId: r.fields!.batchId!,
                    batchName: nameOf.get(r.fields!.batchId!)!.name,
                    programName: nameOf.get(r.fields!.batchId!)!.program.name,
                    rollNumber: r.fields!.rollNumber,
                    enrolledOn: today,
                  })),
                });
              }
              const guardians = creates.filter((r) => r.guardian);
              if (guardians.length > 0) {
                await tx.studentGuardian.createMany({
                  data: guardians.map((r) => ({
                    schoolId,
                    studentId: ids.get(r.row)!,
                    ...r.guardian!,
                    isPrimary: true,
                  })),
                });
              }
            }
            for (const r of updates) {
              const studentId = r.existing!.id;
              // Only the cells the file filled in change the saved student.
              const data = Object.fromEntries(
                Object.entries(r.fields!).filter(([, v]) => v !== null),
              ) as Partial<Fields>;
              if (r.leavesBatch) data.batchId = null;
              await tx.student.update({
                where: { id: studentId },
                data: data as Prisma.StudentUncheckedUpdateInput,
              });
              await moveEnrollment(tx, schoolId, studentId, r.existing!, {
                batchId: r.leavesBatch ? null : (data.batchId ?? r.existing!.batchId),
                rollNumber: data.rollNumber ?? r.existing!.rollNumber,
              });
              if (r.guardian) await upsertGuardian(tx, schoolId, studentId, r.guardian);
            }
          },
          { timeout: 60_000, maxWait: 10_000 },
        ),
      'Some of these students were changed while importing (another import or edit). Nothing was imported; preview and try again.',
    );
  }
}

/** Updates the guardian with the same name (any case), or adds them. */
async function upsertGuardian(
  tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  schoolId: string,
  studentId: string,
  guardian: Guardian,
) {
  const existing = await tx.studentGuardian.findFirst({
    where: { studentId, name: { equals: guardian.name, mode: 'insensitive' } },
    select: { id: true },
  });
  const filled = Object.fromEntries(
    Object.entries(guardian).filter(([, v]) => v !== null),
  );
  if (existing) {
    await tx.studentGuardian.update({ where: { id: existing.id }, data: filled });
    return;
  }
  const hasPrimary = await tx.studentGuardian.count({
    where: { studentId, isPrimary: true },
  });
  await tx.studentGuardian.create({
    data: { schoolId, studentId, ...guardian, isPrimary: hasPrimary === 0 },
  });
}

export type { StudentImportRow };
