import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assignFaculty,
  pruneFacultyPrograms,
} from '../academic/batches.service.js';
import { istToday, parseDate, toIsoDate } from '../common/dates.js';
import { duplicateAsConflict } from '../common/unique-violation.js';
import { normalizeIndianMobile } from '../common/validators.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FilesService } from '../storage/files.service.js';
import type {
  BatchAssignmentDto,
  FacultyDto,
  OwnProfileDto,
  SubjectsDto,
} from './faculty-profile.dto.js';

type Tx = Prisma.TransactionClient;

const detailInclude = {
  photo: { select: { key: true, originalName: true, contentType: true } },
  programAssignments: {
    include: { program: { select: { id: true, name: true } } },
  },
  batchAssignments: {
    include: {
      batch: {
        select: { id: true, name: true, program: { select: { name: true } } },
      },
    },
  },
  _count: {
    select: { materials: true, assignments: true, counselingSessions: true },
  },
} as const;

type DetailRow = Prisma.FacultyGetPayload<{ include: typeof detailInclude }>;

/** The 409 for a faculty unique index (email or employee ID per school). */
function facultyClash(dto: { email?: string | null; employeeId?: string | null }) {
  return (names: string[]) => {
    const hit = (f: string) => names.some((n) => n === f || n.includes(`_${f}_`));
    if (hit('email')) return `Another faculty profile already uses ${dto.email}`;
    if (hit('employeeId'))
      return `Employee ID ${dto.employeeId} is already used by another faculty member`;
    return 'Someone changed this profile at the same time. Refresh and try again.';
  };
}

/** Subjects without duplicates (any case), keeping the first spelling and order. */
export function cleanSubjects(subjects: string[]) {
  const seen = new Set<string>();
  return subjects.filter((s) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Faculty profiles for the admin Teacher Portal (PRD 4.7) and the teacher's
 * own My Profile. Every lookup is scoped by school; teachers can only change
 * their own contact details and photo.
 */
@Injectable()
export class FacultyProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  /** KPIs and side widgets of the Teacher Portal page. */
  async overview(schoolId: string) {
    const [totalFaculty, covered, materialsUploaded, counselingSessions, materials, sessions] =
      await Promise.all([
        this.prisma.faculty.count({ where: { schoolId } }),
        // Batches with at least one teacher who isn't inactive.
        this.prisma.facultyBatch.findMany({
          where: { schoolId, faculty: { status: { not: 'INACTIVE' } } },
          distinct: ['batchId'],
          select: { batchId: true },
        }),
        this.prisma.studyMaterial.count({ where: { schoolId } }),
        this.prisma.counselingSession.count({ where: { schoolId } }),
        this.prisma.studyMaterial.findMany({
          where: { schoolId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            batch: { select: { name: true } },
            faculty: { select: { name: true } },
            file: { select: { key: true, originalName: true, contentType: true, size: true } },
          },
        }),
        this.prisma.counselingSession.findMany({
          where: { schoolId },
          orderBy: { scheduledAt: 'desc' },
          take: 5,
          include: { student: { select: { fullName: true } } },
        }),
      ]);
    return {
      kpis: {
        totalFaculty,
        activeBatchesCovered: covered.length,
        materialsUploaded,
        counselingSessions,
      },
      recentMaterials: await Promise.all(
        materials.map(async (m) => ({
          id: m.id,
          title: m.title,
          type: m.type,
          subject: m.subject,
          batch: m.batch.name,
          uploadedBy: m.faculty?.name ?? null,
          createdAt: m.createdAt.toISOString(),
          file: {
            name: m.file.originalName,
            contentType: m.file.contentType,
            size: m.file.size,
            url: await this.files.url(m.file),
          },
        })),
      ),
      recentCounseling: sessions.map((c) => ({
        id: c.id,
        student: c.student.fullName,
        counselor: c.counselorName,
        type: c.type,
        status: c.status,
        scheduledAt: c.scheduledAt.toISOString(),
      })),
    };
  }

  /** The Faculty Directory: one row per profile. */
  async directory(schoolId: string) {
    const faculty = await this.prisma.faculty.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
      include: {
        photo: { select: { key: true, originalName: true, contentType: true } },
        _count: { select: { batchAssignments: true } },
      },
    });
    return Promise.all(
      faculty.map(async (f) => ({
        id: f.id,
        name: f.name,
        email: f.email,
        phone: f.phone,
        primarySubject: f.primarySubject ?? f.subjects[0] ?? null,
        joiningDate: toIsoDate(f.joiningDate),
        batchCount: f._count.batchAssignments,
        status: f.status,
        designation: f.designation,
        linked: f.userId !== null,
        photoUrl: f.photo ? await this.files.url(f.photo) : f.profileImageUrl,
      })),
    );
  }

  async get(schoolId: string, facultyId: string) {
    const faculty = await this.prisma.faculty.findFirst({
      where: { id: facultyId, schoolId },
      include: detailInclude,
    });
    if (!faculty) throw new NotFoundException('Faculty member not found');
    return this.toDetail(faculty);
  }

  /** Edit Faculty: every field, plus the batch list (new ones join as Primary). */
  async update(schoolId: string, facultyId: string, dto: FacultyDto) {
    const current = await this.prisma.faculty.findFirst({
      where: { id: facultyId, schoolId },
      select: {
        id: true,
        userId: true,
        email: true,
        subjects: true,
        photoFileId: true,
        photo: { select: { id: true, key: true } },
        batchAssignments: { select: { batchId: true, batch: { select: { programId: true } } } },
      },
    });
    if (!current) throw new NotFoundException('Faculty member not found');
    // A linked profile's email is the teacher's login; it can't be changed here.
    if (current.userId && (dto.email ?? null) !== current.email) {
      throw new BadRequestException(
        "This teacher signs in with their email, so it can't be changed here",
      );
    }
    const batches = await this.prisma.batch.findMany({
      where: { schoolId, id: { in: dto.batchIds } },
      select: { id: true, programId: true },
    });
    if (batches.length !== new Set(dto.batchIds).size) {
      throw new BadRequestException('Select batches from this school');
    }
    await this.checkPhoto(schoolId, dto.photoFileId, current.photoFileId);

    // The edited subject becomes the primary one; other subjects stay.
    const subjects = cleanSubjects([dto.subject, ...current.subjects]);
    const data = {
      name: dto.name,
      employeeId: dto.employeeId ?? null,
      email: dto.email ?? null,
      dateOfBirth: dto.dateOfBirth ? parseDate(dto.dateOfBirth, 'Date of birth') : null,
      gender: dto.gender ?? null,
      bio: dto.bio ?? null,
      subjects,
      primarySubject: subjects[0],
      specialization: dto.specialization,
      qualification: dto.qualification ?? null,
      primaryStream: dto.primaryStream ?? null,
      experienceYears: dto.experienceYears ?? null,
      joiningDate: dto.joiningDate ? parseDate(dto.joiningDate, 'Joining date') : null,
      status: dto.status,
      ...contactData(dto),
    };
    if (data.dateOfBirth && data.dateOfBirth > istToday()) {
      throw new BadRequestException("Date of birth can't be in the future");
    }

    await duplicateAsConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          await tx.faculty.update({ where: { id: facultyId }, data });
          const before = new Set(current.batchAssignments.map((a) => a.batchId));
          const wanted = new Set(dto.batchIds);
          for (const batch of batches) {
            if (!before.has(batch.id)) {
              await assignFaculty(tx, schoolId, facultyId, batch.id, batch.programId);
            }
          }
          const removed = current.batchAssignments.filter((a) => !wanted.has(a.batchId));
          await this.unassign(tx, schoolId, facultyId, removed);
        }),
      facultyClash(dto),
    );
    if (current.photo && current.photoFileId !== data.photoFileId) {
      await this.files.discard([current.photo]);
    }
    return { id: facultyId };
  }

  /** Subjects Taught: the list and which one is primary (starred). */
  async setSubjects(schoolId: string, facultyId: string, dto: SubjectsDto) {
    await this.find(schoolId, facultyId);
    const subjects = cleanSubjects(dto.subjects);
    const primary = dto.primarySubject
      ? subjects.find((s) => s.toLowerCase() === dto.primarySubject!.toLowerCase())
      : undefined;
    if (dto.primarySubject && !primary) {
      throw new BadRequestException('The primary subject must be one of the subjects');
    }
    await this.prisma.faculty.update({
      where: { id: facultyId },
      data: { subjects, primarySubject: primary ?? subjects[0] ?? null },
    });
    return { subjects, primarySubject: primary ?? subjects[0] ?? null };
  }

  /** Batch Assignments: add a batch with a role, or change the role. */
  async assignBatch(schoolId: string, facultyId: string, dto: BatchAssignmentDto) {
    await this.find(schoolId, facultyId);
    const batch = await this.prisma.batch.findFirst({
      where: { id: dto.batchId, schoolId },
      select: { id: true, programId: true },
    });
    if (!batch) throw new BadRequestException('Select a batch from this school');
    await this.prisma.$transaction(async (tx) => {
      await assignFaculty(tx, schoolId, facultyId, batch.id, batch.programId);
      await tx.facultyBatch.update({
        where: { facultyId_batchId: { facultyId, batchId: batch.id } },
        data: { role: dto.role },
      });
    });
    return { ok: true };
  }

  async unassignBatch(schoolId: string, facultyId: string, batchId: string) {
    await this.find(schoolId, facultyId);
    const assignment = await this.prisma.facultyBatch.findFirst({
      where: { facultyId, batchId, schoolId },
      select: { batchId: true, batch: { select: { programId: true } } },
    });
    if (!assignment) throw new NotFoundException('That batch isn’t assigned to this teacher');
    await this.prisma.$transaction((tx) =>
      this.unassign(tx, schoolId, facultyId, [assignment]),
    );
    return { ok: true };
  }

  async setDesignation(schoolId: string, facultyId: string, designation: 'TEACHER' | 'COORDINATOR') {
    await this.find(schoolId, facultyId);
    await this.prisma.faculty.update({ where: { id: facultyId }, data: { designation } });
    return { designation };
  }

  // The teacher's own profile

  async own(schoolId: string, facultyId: string) {
    return this.get(schoolId, facultyId);
  }

  async updateOwn(schoolId: string, facultyId: string, dto: OwnProfileDto) {
    const current = await this.prisma.faculty.findFirst({
      where: { id: facultyId, schoolId },
      select: { photoFileId: true, photo: { select: { id: true, key: true } } },
    });
    if (!current) throw new NotFoundException('Faculty profile not found');
    await this.checkPhoto(schoolId, dto.photoFileId, current.photoFileId);
    const data = contactData(dto);
    await this.prisma.faculty.update({ where: { id: facultyId }, data });
    if (current.photo && current.photoFileId !== data.photoFileId) {
      await this.files.discard([current.photo]);
    }
    return { id: facultyId };
  }

  // Helpers

  private async find(schoolId: string, facultyId: string) {
    const faculty = await this.prisma.faculty.findFirst({
      where: { id: facultyId, schoolId },
      select: { id: true },
    });
    if (!faculty) throw new NotFoundException('Faculty member not found');
    return faculty;
  }

  private async checkPhoto(schoolId: string, next: string | null | undefined, current: string | null) {
    if (next && next !== current) {
      await this.files.findReady(schoolId, next, 'FACULTY_PHOTO');
    }
  }

  private async unassign(
    tx: Tx,
    schoolId: string,
    facultyId: string,
    removed: { batchId: string; batch: { programId: string } }[],
  ) {
    if (removed.length === 0) return;
    await tx.facultyBatch.deleteMany({
      where: { facultyId, batchId: { in: removed.map((r) => r.batchId) } },
    });
    for (const programId of new Set(removed.map((r) => r.batch.programId))) {
      await pruneFacultyPrograms(tx, schoolId, programId, [facultyId]);
    }
  }

  private async toDetail(f: DetailRow) {
    return {
      id: f.id,
      name: f.name,
      email: f.email,
      phone: f.phone,
      altPhone: f.altPhone,
      employeeId: f.employeeId,
      dateOfBirth: toIsoDate(f.dateOfBirth),
      gender: f.gender,
      address: f.address,
      city: f.city,
      state: f.state,
      pincode: f.pincode,
      subjects: f.subjects,
      primarySubject: f.primarySubject ?? f.subjects[0] ?? null,
      primaryStream: f.primaryStream,
      specialization: f.specialization,
      qualification: f.qualification,
      experienceYears: f.experienceYears,
      joiningDate: toIsoDate(f.joiningDate),
      status: f.status,
      designation: f.designation,
      bio: f.bio,
      profileImageUrl: f.profileImageUrl,
      photoFileId: f.photoFileId,
      photoUrl: f.photo ? await this.files.url(f.photo) : f.profileImageUrl,
      linked: f.userId !== null,
      programs: f.programAssignments.map((p) => p.program),
      batches: f.batchAssignments.map((a) => ({
        id: a.batch.id,
        name: a.batch.name,
        program: a.batch.program.name,
        role: a.role,
      })),
      counts: {
        materials: f._count.materials,
        assignments: f._count.assignments,
        counseling: f._count.counselingSessions,
      },
    };
  }
}

function contactData(dto: OwnProfileDto) {
  return {
    phone: dto.phone ? normalizeIndianMobile(dto.phone) : null,
    altPhone: dto.altPhone ? normalizeIndianMobile(dto.altPhone) : null,
    address: dto.address ?? null,
    city: dto.city ?? null,
    state: dto.state ?? null,
    pincode: dto.pincode ?? null,
    profileImageUrl: dto.profileImageUrl ?? null,
    photoFileId: dto.photoFileId ?? null,
  };
}
