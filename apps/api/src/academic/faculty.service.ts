import { Injectable } from '@nestjs/common';
import { toIsoDate } from '../common/dates.js';
import { normalizeIndianMobile } from '../common/validators.js';
import type { FacultyStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { FacultyImportRow } from './academic.dto.js';
import { assignFaculty } from './batches.service.js';
import {
  type ImportPreview,
  parseImportDate,
  splitList,
} from './import-utils.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENDERS = ['Male', 'Female', 'Other'];
const STATUS_ALIASES: Record<string, FacultyStatus> = {
  ACTIVE: 'ACTIVE',
  ONLEAVE: 'ON_LEAVE',
  LEAVE: 'ON_LEAVE',
  INACTIVE: 'INACTIVE',
};

type FacultyFields = {
  name: string;
  employeeId: string | null;
  email: string | null;
  phone: string | null;
  altPhone: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  subjects: string[];
  specialization: string | null;
  qualification: string | null;
  experienceYears: number | null;
  joiningDate: Date | null;
  status: FacultyStatus | null; // null = not given (new profiles start ACTIVE)
  bio: string | null;
  profileImageUrl: string | null;
};

type PlannedRow = {
  row: number;
  name: string;
  action: 'create' | 'update' | 'error';
  errors: string[];
  existingId?: string;
  linked?: boolean;
  fields?: FacultyFields;
  batches?: { id: string; programId: string }[];
};

@Injectable()
export class FacultyService {
  constructor(private readonly prisma: PrismaService) {}

  async list(schoolId: string) {
    const faculty = await this.prisma.faculty.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
      include: {
        batchAssignments: {
          include: { batch: { select: { id: true, name: true } } },
        },
      },
    });
    return faculty.map((f) => ({
      id: f.id,
      name: f.name,
      email: f.email,
      phone: f.phone,
      employeeId: f.employeeId,
      subjects: f.subjects,
      specialization: f.specialization,
      qualification: f.qualification,
      experienceYears: f.experienceYears,
      joiningDate: toIsoDate(f.joiningDate),
      status: f.status,
      linked: f.userId !== null,
      batches: f.batchAssignments.map((a) => ({ ...a.batch, role: a.role })),
    }));
  }

  /**
   * Removes imported faculty profiles. Profiles linked to a login belong to a
   * member of the school and are left alone (they leave by switching schools).
   */
  async remove(schoolId: string, ids: string[]) {
    const targets = await this.prisma.faculty.findMany({
      where: { schoolId, id: { in: ids } },
      select: { id: true, name: true, userId: true },
    });
    const deletable = targets.filter((f) => !f.userId).map((f) => f.id);
    if (deletable.length > 0)
      await this.prisma.faculty.deleteMany({
        where: { schoolId, id: { in: deletable } },
      });
    return {
      deleted: deletable.length,
      keptLinked: targets.filter((f) => f.userId).map((f) => f.name),
    };
  }

  /**
   * Bulk create/update from a spreadsheet. A row whose email (or else employee
   * ID) matches an existing profile updates it; otherwise a new profile is
   * created. Rows with errors are skipped and reported.
   */
  async import(
    schoolId: string,
    rows: FacultyImportRow[],
    dryRun: boolean,
  ): Promise<ImportPreview> {
    const planned = await this.plan(schoolId, rows);
    if (!dryRun) {
      const valid = planned.filter((p) => p.action !== 'error');
      await this.prisma.$transaction(
        async (tx) => {
          for (const p of valid) {
            const fields = p.fields!;
            const faculty = p.existingId
              ? await tx.faculty.update({
                  where: { id: p.existingId },
                  data: updateData(fields, !!p.linked),
                })
              : await tx.faculty.create({
                  data: {
                    schoolId,
                    ...fields,
                    status: fields.status ?? 'ACTIVE',
                  },
                });
            for (const batch of p.batches ?? []) {
              await assignFaculty(
                tx,
                schoolId,
                faculty.id,
                batch.id,
                batch.programId,
              );
            }
          }
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    }
    return summarize(planned, dryRun);
  }

  private async plan(
    schoolId: string,
    rows: FacultyImportRow[],
  ): Promise<PlannedRow[]> {
    const [existing, batches] = await Promise.all([
      this.prisma.faculty.findMany({
        where: { schoolId },
        select: { id: true, email: true, employeeId: true, userId: true },
      }),
      this.prisma.batch.findMany({
        where: { schoolId },
        select: { id: true, name: true, programId: true },
      }),
    ]);
    const byEmail = new Map(
      existing.filter((f) => f.email).map((f) => [f.email!, f]),
    );
    const byEmployeeId = new Map(
      existing
        .filter((f) => f.employeeId)
        .map((f) => [f.employeeId!.toLowerCase(), f]),
    );
    const seenEmails = new Set<string>();
    const seenEmployeeIds = new Set<string>();

    return rows.map((raw, i) => {
      const errors: string[] = [];
      const text = (v?: string) => v?.trim().replace(/\s+/g, ' ') || null;
      const name = text(raw.name);
      if (!name) errors.push('Name is required');

      const email = text(raw.email)?.toLowerCase() ?? null;
      if (email && !EMAIL.test(email)) errors.push('Email is invalid');
      const employeeId = text(raw.employeeId);
      if (email && seenEmails.has(email))
        errors.push('Email appears twice in this file');
      if (employeeId && seenEmployeeIds.has(employeeId.toLowerCase()))
        errors.push('Employee ID appears twice in this file');
      if (email) seenEmails.add(email);
      if (employeeId) seenEmployeeIds.add(employeeId.toLowerCase());

      const phone = optionalPhone(raw.phone, 'Phone', errors);
      const altPhone = optionalPhone(raw.altPhone, 'Alt phone', errors);
      const dateOfBirth = parseImportDate(
        raw.dateOfBirth,
        'Date of birth',
        errors,
      );
      const joiningDate = parseImportDate(
        raw.joiningDate,
        'Joining date',
        errors,
      );

      const genderText = text(raw.gender);
      const gender = genderText
        ? (GENDERS.find((g) => g.toLowerCase() === genderText.toLowerCase()) ??
          null)
        : null;
      if (genderText && !gender)
        errors.push('Gender must be Male, Female or Other');

      const pincode = text(raw.pincode);
      if (pincode && !/^\d{6}$/.test(pincode))
        errors.push('Pincode must be 6 digits');

      const experienceText = text(raw.experienceYears);
      const experienceYears = experienceText ? Number(experienceText) : null;
      if (
        experienceText &&
        (!Number.isInteger(experienceYears) ||
          experienceYears! < 0 ||
          experienceYears! > 60)
      ) {
        errors.push('Experience must be a whole number of years (0-60)');
      }

      const statusText = text(raw.status);
      const status = statusText
        ? (STATUS_ALIASES[statusText.toUpperCase().replace(/[^A-Z]/g, '')] ??
          null)
        : null;
      if (statusText && !status)
        errors.push('Status must be Active, On Leave or Inactive');

      const imageUrl = text(raw.profileImageUrl);
      if (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl))
        errors.push('Profile image URL must start with http(s)://');

      const matchedBatches: { id: string; programId: string }[] = [];
      for (const batchName of splitList(raw.batches)) {
        const matches = batches.filter(
          (b) => b.name.toLowerCase() === batchName.toLowerCase(),
        );
        if (matches.length === 0)
          errors.push(`No batch named "${batchName}" in this school`);
        else if (matches.length > 1)
          errors.push(`"${batchName}" matches batches in several programs`);
        else matchedBatches.push(matches[0]);
      }

      const match =
        (email && byEmail.get(email)) ||
        (employeeId && byEmployeeId.get(employeeId.toLowerCase())) ||
        null;
      if (
        match &&
        email &&
        match.email &&
        match.email !== email &&
        match.userId
      ) {
        errors.push(
          'Employee ID belongs to a teacher with a different login email',
        );
      }
      if (
        match &&
        email &&
        byEmail.get(email) &&
        byEmail.get(email)!.id !== match.id
      ) {
        errors.push('Email belongs to a different faculty profile');
      }

      const row = i + 2; // spreadsheet row number: 1 is the header
      if (errors.length > 0)
        return { row, name: name ?? '—', action: 'error' as const, errors };
      return {
        row,
        name: name!,
        action: match ? ('update' as const) : ('create' as const),
        errors,
        existingId: match?.id,
        linked: !!match?.userId,
        batches: matchedBatches,
        fields: {
          name: name!,
          employeeId,
          email,
          phone,
          altPhone,
          dateOfBirth,
          gender,
          address: text(raw.address),
          city: text(raw.city),
          state: text(raw.state),
          pincode,
          subjects: splitList(raw.subjects),
          specialization: text(raw.specialization),
          qualification: text(raw.qualification),
          experienceYears,
          joiningDate,
          status,
          bio: text(raw.bio),
          profileImageUrl: imageUrl,
        },
      };
    });
  }
}

/**
 * For an existing profile, only cells the spreadsheet filled in are written,
 * so a sparse file never blanks out data. A linked teacher's email is their
 * login and is never changed by an import.
 */
function updateData(fields: FacultyFields, linked: boolean) {
  const data: Partial<Omit<FacultyFields, 'status'>> & {
    status?: FacultyStatus;
  } = {};
  for (const [key, value] of Object.entries(fields) as [
    keyof FacultyFields,
    FacultyFields[keyof FacultyFields],
  ][]) {
    if (value === null || (Array.isArray(value) && value.length === 0))
      continue;
    if (key === 'email' && linked) continue;
    (data as Record<string, unknown>)[key] = value;
  }
  return data;
}

function optionalPhone(
  value: string | undefined,
  label: string,
  errors: string[],
) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const phone = normalizeIndianMobile(trimmed);
  if (!phone) errors.push(`${label} must be a 10-digit mobile number`);
  return phone;
}

function summarize(planned: PlannedRow[], dryRun: boolean): ImportPreview {
  return {
    applied: !dryRun,
    created: planned.filter((p) => p.action === 'create').length,
    updated: planned.filter((p) => p.action === 'update').length,
    skipped: planned.filter((p) => p.action === 'error').length,
    rows: planned.map(({ row, name, action, errors }) => ({
      row,
      label: name,
      action,
      errors,
    })),
  };
}
